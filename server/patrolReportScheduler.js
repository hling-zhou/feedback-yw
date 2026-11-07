import { logAudit } from './audit.js'
import { sendSmtpMail } from './mail/smtp.js'
import { getMailChannelById, listMailGroups } from './mailRepository.js'
import { buildPatrolDailyReport, renderPatrolDailyReportHtml, renderPatrolQuietReportHtml } from './patrolReportBuilder.js'
import { storageRepository } from './storageRepository.js'

/** 日报配置与状态 meta（docs/DESIGN-API巡检.md §8.2） */
export const META_KEY_PATROL_REPORT_CONFIG = 'api_patrol_daily_report_v1'
export const META_KEY_PATROL_REPORT_STATE = 'api_patrol_daily_report_state_v1'

/** @typedef {{ enabled: boolean, groupIds: string[], channelId: string, sendTime: string, includeQuiet: boolean, excludeSimTagged: boolean, maxInterfacesPerProduct: number }} PatrolReportConfig */

/** 默认配置（含 §8.2 拍板口径：默认不排除仿真、无异常发平静简报；通道按 channelId 选择——不动全局数据源枚举）。 */
export const DEFAULT_PATROL_REPORT_CONFIG = /** @type {PatrolReportConfig} */ ({
  enabled: false,
  groupIds: [],
  channelId: '',
  sendTime: '09:00',
  includeQuiet: true,
  excludeSimTagged: false,
  maxInterfacesPerProduct: 20,
})

/**
 * @returns {PatrolReportConfig}
 */
export function readPatrolReportConfig() {
  try {
    const parsed = storageRepository.getMeta(META_KEY_PATROL_REPORT_CONFIG)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PATROL_REPORT_CONFIG }
    const c = /** @type {Record<string, unknown>} */ (parsed)
    return {
      enabled: c.enabled === true,
      groupIds: Array.isArray(c.groupIds) ? c.groupIds.map(String) : [],
      channelId: typeof c.channelId === 'string' ? c.channelId : '',
      sendTime: typeof c.sendTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.sendTime) ? c.sendTime : '09:00',
      includeQuiet: c.includeQuiet !== false,
      excludeSimTagged: c.excludeSimTagged === true,
      maxInterfacesPerProduct: Number(c.maxInterfacesPerProduct) >= 5 && Number(c.maxInterfacesPerProduct) <= 100
        ? Number(c.maxInterfacesPerProduct) : 20,
    }
  } catch {
    return { ...DEFAULT_PATROL_REPORT_CONFIG }
  }
}

/**
 * @param {PatrolReportConfig} config
 */
export function savePatrolReportConfig(config) {
  storageRepository.putMeta(META_KEY_PATROL_REPORT_CONFIG, {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...config,
  })
}

/**
 * @returns {{ lastSentDate?: string, lastSentAt?: string, lastResult?: string, lastError?: string } | null}
 */
export function readPatrolReportState() {
  try {
    const parsed = storageRepository.getMeta(META_KEY_PATROL_REPORT_STATE)
    if (!parsed || typeof parsed !== 'object') return null
    const s = /** @type {Record<string, unknown>} */ (parsed)
    return {
      lastSentDate: typeof s.lastSentDate === 'string' ? s.lastSentDate : undefined,
      lastSentAt: typeof s.lastSentAt === 'string' ? s.lastSentAt : undefined,
      lastResult: typeof s.lastResult === 'string' ? s.lastResult : undefined,
      lastError: typeof s.lastError === 'string' ? s.lastError : undefined,
    }
  } catch {
    return null
  }
}

/**
 * @param {{ lastSentDate?: string, lastSentAt?: string, lastResult?: string, lastError?: string }} state
 */
function writePatrolReportState(state) {
  storageRepository.putMeta(META_KEY_PATROL_REPORT_STATE, { version: 1, ...state })
}

/** 本地日期 YYYY-MM-DD（服务器本地时区=北京时间）。 @param {Date} d */
export function localDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 昨日（本地）。 @param {Date} now */
export function yesterdayStr(now) {
  const d = new Date(now.getTime() - 24 * 3600 * 1000)
  return localDateStr(d)
}

/**
 * 下一次发送时刻（本地时区）：今日 sendTime 未到则今日，否则明日。
 * @param {Date} now
 * @param {string} sendTime 'HH:mm'
 * @returns {Date}
 */
export function nextSendAt(now, sendTime) {
  const [h, m] = sendTime.split(':').map(Number)
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0)
  if (candidate.getTime() > now.getTime()) return candidate
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h, m, 0, 0)
}

/**
 * 汇总收件人（多群组合并去重）。
 * @param {string[]} groupIds
 * @returns {string[]}
 */
export function resolveReportRecipients(groupIds) {
  const groups = listMailGroups()
  const set = new Set()
  for (const g of groups) {
    if (!groupIds.includes(g.id)) continue
    for (const e of g.emails) set.add(e)
  }
  return [...set]
}

/**
 * 发送一次日报（核心链路）。
 * - schedule/catch-up：未启用或当日已发 → skip（幂等）
 * - manual：忽略 enabled 与幂等（立即发送=测试/补发）
 * - 无数据日：includeQuiet=true 发平静简报；false 记 quiet_skipped（同样占当日一次）
 * @param {{ trigger?: 'schedule' | 'catch-up' | 'manual', force?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, skipped?: string, error?: string, recipients?: number, products?: number, date?: string }>}
 */
export async function sendPatrolDailyReport(options = {}) {
  const trigger = options.trigger || 'manual'
  const force = trigger === 'manual' || options.force === true
  const config = readPatrolReportConfig()
  const state = readPatrolReportState()
  const today = localDateStr(new Date())

  if (!force) {
    if (!config.enabled) return { ok: true, skipped: 'disabled' }
    if (state?.lastSentDate === today) return { ok: true, skipped: 'already-sent' }
  }

  const recipients = resolveReportRecipients(config.groupIds)
  if (recipients.length === 0) {
    const error = '收件人群组为空或群组内无邮箱'
    writePatrolReportState({ lastSentDate: today, lastSentAt: new Date().toISOString(), lastResult: 'error', lastError: error })
    logAudit({ username: 'system-scheduler', action: 'api_patrol.daily_report_send', detail: { trigger, result: 'error', error } })
    return { ok: false, error }
  }

  const channel = getMailChannelById(config.channelId)
  if (!channel) {
    const error = '未在日报配置中选择发信通道（通道可在 Settings → 邮件 tab 维护）'
    writePatrolReportState({ lastSentDate: today, lastSentAt: new Date().toISOString(), lastResult: 'error', lastError: error })
    logAudit({ username: 'system-scheduler', action: 'api_patrol.daily_report_send', detail: { trigger, result: 'error', error } })
    return { ok: false, error }
  }

  const date = yesterdayStr(new Date())
  const report = buildPatrolDailyReport(date, {
    maxInterfacesPerProduct: config.maxInterfacesPerProduct,
    excludeSimTagged: config.excludeSimTagged,
  })

  if (!report.hasData && !config.includeQuiet) {
    writePatrolReportState({ lastSentDate: today, lastSentAt: new Date().toISOString(), lastResult: 'quiet_skipped' })
    logAudit({ username: 'system-scheduler', action: 'api_patrol.daily_report_send', detail: { trigger, result: 'quiet_skipped', date } })
    return { ok: true, skipped: 'quiet', date }
  }

  const subject = `【AI巡检日报】${date}`
  const html = report.hasData
    ? renderPatrolDailyReportHtml(report)
    : renderPatrolQuietReportHtml(date)
  const text = report.hasData
    ? `AI 巡检日报 ${date}：${report.products.map((p) => `${p.productName} 待处理 ${p.pendingGroups} 组`).join('；') || '无异常'}`
    : `AI 巡检日报 ${date}：昨日无异常接口与失败请求。`

  try {
    await sendSmtpMail(channel, { to: recipients, subject, html, text })
    writePatrolReportState({ lastSentDate: today, lastSentAt: new Date().toISOString(), lastResult: 'sent' })
    logAudit({
      username: 'system-scheduler',
      action: 'api_patrol.daily_report_send',
      detail: {
        trigger, result: 'sent', date, recipients: recipients.length,
        products: report.products.length, groups: report.products.reduce((a, p) => a + p.groups, 0),
        pendingGroups: report.products.reduce((a, p) => a + p.pendingGroups, 0),
      },
    })
    return { ok: true, recipients: recipients.length, products: report.products.length, date }
  } catch (err) {
    const error = err instanceof Error ? err.message : '邮件发送失败'
    writePatrolReportState({ lastSentDate: today, lastSentAt: new Date().toISOString(), lastResult: 'error', lastError: error })
    logAudit({ username: 'system-scheduler', action: 'api_patrol.daily_report_send', detail: { trigger, result: 'error', error } })
    return { ok: false, error }
  }
}

let schedulerTimer = null

/**
 * 启动每日定时器（docs §8.1：进程内 setTimeout+自愈）。
 * - 启动自愈：当日未发且已过 sendTime → 立即补发
 * - 未启用：每 10 分钟轮询配置（前端开开关即时生效，无需重启）
 * - 触发失败不抛出（记录 state，等待次日或手动补发）
 * @returns {() => void} stop
 */
export function startPatrolReportScheduler() {
  const arm = () => {
    const config = readPatrolReportConfig()
    if (!config.enabled) {
      schedulerTimer = setTimeout(arm, 10 * 60 * 1000)
      return
    }
    const delay = nextSendAt(new Date(), config.sendTime).getTime() - Date.now() + 1000
    schedulerTimer = setTimeout(async () => {
      try {
        await sendPatrolDailyReport({ trigger: 'schedule' })
      } catch (err) {
        console.error('[patrol-report] 定时发送异常：', err)
      }
      arm()
    }, delay)
  }

  const catchUp = async () => {
    const config = readPatrolReportConfig()
    const state = readPatrolReportState()
    const today = localDateStr(new Date())
    const due = nextSendAt(new Date(), config.sendTime).getTime() <= Date.now() + 60 * 1000
    if (config.enabled && state?.lastSentDate !== today && due) {
      try {
        await sendPatrolDailyReport({ trigger: 'catch-up' })
      } catch (err) {
        console.error('[patrol-report] 启动补发异常：', err)
      }
    }
    arm()
  }
  catchUp()
  return () => {
    if (schedulerTimer) clearTimeout(schedulerTimer)
    schedulerTimer = null
  }
}
