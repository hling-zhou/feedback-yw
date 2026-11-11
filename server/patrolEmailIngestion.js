/**
 * Plan B 邮件拉取导入（docs/DESIGN-API巡检.md §9，2026-11-09 设计定稿）。
 *
 * 职责：每日 09:15 定时/手动 → IMAP 拉取巡检邮件 → 发件人白名单（P0-1）→
 * MIME 解析 → HTML 统计表双路解析（P1-5a）→ ZIP 附件双兜底（P1-6）→
 * 附件×正文产品交叉验证（P1-5b）→ HTML-vs-CSV 交叉校验（P0-2）→
 * 进程内直调写入（P0-4：patrolIngestion.js 共享函数，不经 HTTP 层）→
 * 审计 + 状态 meta 更新（P2-8）。
 *
 * IMAP 传输层通过 setImapClientFactory 注入（测试 mock；生产 imapflow）——
 * 先例对齐 mail/smtp.js 的 setMailTransportFactory。
 */
import { simpleParser } from 'mailparser'
import JSZip from 'jszip'
import Papa from 'papaparse'
import { logAudit } from './audit.js'
import { storageRepository } from './storageRepository.js'
import { resolvePatrolProductKey } from './patrolDomain.js'
import {
  ingestPatrolStats,
  ingestPatrolRequests,
  loadPatrolCatalogShared,
} from './patrolIngestion.js'

/** §9.5 配置与状态 meta 键。 */
export const META_KEY_EMAIL_INGESTION_CONFIG = 'api_patrol_email_ingestion_config_v1'
export const META_KEY_EMAIL_INGESTION_STATE = 'api_patrol_email_ingestion_state_v1'

/** @typedef {{
 *   enabled: boolean, imapHost: string, imapPort: number, imapUser: string,
 *   imapTls: boolean, senderWhitelist: string[], autoProcessOnFetch: boolean,
 *   imapAuthCode: string,
 * }} EmailIngestionConfig */

/** 默认配置（§9.2 契约值）。 */
export const DEFAULT_EMAIL_INGESTION_CONFIG = /** @type {EmailIngestionConfig} */ ({
  enabled: false,
  imapHost: 'imap.cmss.chinamobile.com',
  imapPort: 993,
  imapUser: 'zhouhuiling@cmss.chinamobile.com',
  imapTls: true,
  senderWhitelist: ['service@cmecloud.cn', 'service2@cmecloud.cn', 'service3@cmecloud.cn', 'service4@cmecloud.cn', 'service5@cmecloud.cn', 'service6@cmecloud.cn', 'service7@cmecloud.cn', 'service8@cmecloud.cn', 'service9@cmecloud.cn', 'service10@cmecloud.cn'],
  autoProcessOnFetch: true,
  imapAuthCode: '',
})

/**
 * @returns {EmailIngestionConfig}
 */
export function readEmailIngestionConfig() {
  try {
    const parsed = storageRepository.getMeta(META_KEY_EMAIL_INGESTION_CONFIG)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_EMAIL_INGESTION_CONFIG }
    const c = /** @type {Record<string, unknown>} */ (parsed)
    return {
      enabled: c.enabled === true,
      imapHost: typeof c.imapHost === 'string' && c.imapHost ? c.imapHost : DEFAULT_EMAIL_INGESTION_CONFIG.imapHost,
      imapPort: Number(c.imapPort) > 0 ? Number(c.imapPort) : 993,
      imapUser: typeof c.imapUser === 'string' && c.imapUser ? c.imapUser : DEFAULT_EMAIL_INGESTION_CONFIG.imapUser,
      imapTls: c.imapTls !== false,
      senderWhitelist: Array.isArray(c.senderWhitelist) && c.senderWhitelist.length > 0
        ? c.senderWhitelist.map(String)
        : DEFAULT_EMAIL_INGESTION_CONFIG.senderWhitelist,
      autoProcessOnFetch: c.autoProcessOnFetch !== false,
      imapAuthCode: typeof c.imapAuthCode === 'string' ? c.imapAuthCode : '',
    }
  } catch {
    return { ...DEFAULT_EMAIL_INGESTION_CONFIG }
  }
}

/**
 * @param {EmailIngestionConfig} config
 */
export function saveEmailIngestionConfig(config) {
  storageRepository.putMeta(META_KEY_EMAIL_INGESTION_CONFIG, {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...config,
  })
}

/**
 * 读拉取状态（§9.5）。
 * @returns {{ lastFetchAt?: string, lastFetchDate?: string, lastResult?: string,
 *   lastStats?: { products?: number, statsRows?: number, requestRows?: number, dataDate?: string },
 *   lastError?: string } | null}
 */
export function readEmailIngestionState() {
  try {
    const parsed = storageRepository.getMeta(META_KEY_EMAIL_INGESTION_STATE)
    if (!parsed || typeof parsed !== 'object') return null
    return /** @type {any} */ (parsed)
  } catch {
    return null
  }
}

/**
 * @param {Record<string, unknown>} state
 */
function writeEmailIngestionState(state) {
  storageRepository.putMeta(META_KEY_EMAIL_INGESTION_STATE, { version: 1, ...state })
}

/** 本地日期 YYYY-MM-DD。 @param {Date} d */
function localDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ================================================================ IMAP 层

/**
 * IMAP 客户端工厂（生产=imapflow；测试经 setImapClientFactory 注入 mock）。
 * 契约：client.connect() / client.searchAndFetch() → [{ raw, receivedAt }] / client.disconnect()。
 * @type {(() => any) | null}
 */
let imapClientFactory = null

/**
 * 注入 IMAP 客户端工厂（测试 mock 用；先例 setMailTransportFactory）。
 * @param {(() => any) | null} factory
 */
export function setImapClientFactory(factory) {
  imapClientFactory = factory
}

/**
 * 默认 imapflow 实现契约形态。
 * @param {EmailIngestionConfig} config
 */
async function fetchViaImapflow(config) {
  const { ImapFlow } = await import('imapflow')
  // 前端配置优先，部署环境变量兜底（对齐 SMTP 通道密码模式）
  const authCode = config.imapAuthCode || process.env.PATROL_EMAIL_AUTH_CODE || ''
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapTls,
    auth: { user: config.imapUser, pass: authCode },
    logger: false,
  })
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      const uids = await client.search({ since })
      const whitelistLower = config.senderWhitelist.map((s) => s.toLowerCase())
      /** @type {Array<{ raw: string, receivedAt: Date }>} */
      const messages = []
      for (const uid of uids || []) {
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true })
        if (!msg?.source) continue
        const fromAddr = String(msg.envelope?.from?.[0]?.address || '').toLowerCase()
        if (fromAddr && !whitelistLower.includes(fromAddr)) continue
        messages.push({
          raw: msg.source.toString('utf-8'),
          receivedAt: msg.envelope?.date ? new Date(msg.envelope.date) : new Date(),
        })
      }
      return messages
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => client.disconnect())
  }
}

/**
 * 拉取当日邮件（工厂优先→imapflow）。
 * @param {EmailIngestionConfig} config
 * @returns {Promise<Array<{ raw: string, receivedAt: Date }>>}
 */
async function fetchTodayEmails(config) {
  if (imapClientFactory) {
    const client = imapClientFactory()
    await client.connect()
    try {
      return await client.searchAndFetch()
    } finally {
      await client.disconnect?.()
    }
  }
  return fetchViaImapflow(config)
}

// ================================================================ 解析层

/** 从 From 头提取发件地址（剥离显示名）。 */
function extractEmailAddress(fromHeader) {
  if (!fromHeader) return ''
  const s = String(fromHeader)
  // "显示名" <addr@x.com> 形态
  const angle = /<([^<>]+)>/.exec(s)
  if (angle) return angle[1].trim().toLowerCase()
  return s.trim().toLowerCase()
}

/** 主题正则：报告月日 + 产品数 + 接口数。 */
const SUBJECT_RE = /【API巡检报告】【(\d{1,2})月(\d{1,2})日】发现\s*(\d+)\s*款产品[，,]\s*共\s*(\d+)\s*条/

/**
 * 从正文提取"数据日期"（§9.2：优先正文标注；无则返回 null 由调用方 T-1 兜底）。
 * @param {string} html
 * @returns {string | null}
 */
function extractDataDateFromHtml(html) {
  const text = stripHtmlTags(html)
  const m = /数据日期[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(text)
  return m ? m[1] : null
}

/** 粗剥 HTML 标签（日期等短字段提取用；表格解析走专用函数）。 */
function stripHtmlTags(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/**
 * HTML 正文 → 产品统计段数组（P1-5a 双路）。
 * 主力：📦 产品：标记切分；兜底：表头定位 + 产品名回溯。
 * @param {string} html
 * @returns {Array<{ productName: string, rows: Record<string, string>[] }>} 解析失败段跳过（告警由调用方记）
 */
export function parseStatsHtml(html) {
  if (!html) return []
  /** @type {Array<{ productName: string, rows: Record<string, string>[] }>} */
  const segments = []

  // 主力：📦 产品：标记切分
  const markerRe = /📦\s*产品[：:]\s*([^<\n]+)/g
  /** @type {Array<{ name: string, start: number }>} */
  const markers = []
  let m
  while ((m = markerRe.exec(html)) !== null) {
    markers.push({ name: m[1].trim(), start: m.index })
  }

  if (markers.length > 0) {
    for (let i = 0; i < markers.length; i++) {
      const end = i + 1 < markers.length ? markers[i + 1].start : html.length
      const block = html.slice(markers[i].start, end)
      const rows = parseHtmlTableRows(block)
      if (rows.length > 0) {
        segments.push({ productName: markers[i].name, rows })
      } else {
        segments.push({ productName: markers[i].name, rows: [] }) // 空段保留（双路失败告警判定用）
      }
    }
    return segments
  }

  // 兜底：表头定位 + 向前回溯产品名（最近一个 h2/h3 或非表格文本行）
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi
  /** @type {Array<{ table: string, end: number }>} */
  const tables = []
  let t
  while ((t = tableRe.exec(html)) !== null) {
    if (!/<th[^>]*>\s*资源池\s*<\/th>/i.test(t[0])) continue
    tables.push({ table: t[0], end: t.index + t[0].length })
  }
  for (const { table } of tables) {
    const rows = parseHtmlTableRows(table)
    if (rows.length === 0) continue
    const name = backtrackProductName(html, table) || '未知产品'
    segments.push({ productName: name, rows })
  }
  return segments
}

/** 表格 → 行对象数组（列头映射 §9.2 七列）。 */
function parseHtmlTableRows(blockHtml) {
  const tableMatch = /<table[^>]*>([\s\S]*?)<\/table>/i.exec(blockHtml)
  if (!tableMatch) return []
  const inner = tableMatch[1]
  /** @type {string[][]} */
  const trCells = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let tr
  while ((tr = trRe.exec(inner)) !== null) {
    const cells = []
    const cellRe = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi
    let c
    while ((c = cellRe.exec(tr[1])) !== null) {
      cells.push(stripHtmlTags(c[1]))
    }
    if (cells.length > 0) trCells.push(cells)
  }
  if (trCells.length < 2) return []
  const headers = trCells[0]
  /** @type {Record<string, string>[]} */
  const rows = []
  for (let i = 1; i < trCells.length; i++) {
    /** @type {Record<string, string>} */
    const row = {}
    for (let j = 0; j < headers.length && j < trCells[i].length; j++) {
      row[headers[j]] = trCells[i][j]
    }
    rows.push(row)
  }
  return rows
}

/** 从表头位置向前回溯产品名（h2/h3 标题或含"产品"文本）。 */
function backtrackProductName(html, table) {
  const tableIdx = html.indexOf(table)
  if (tableIdx < 0) return null
  const before = html.slice(0, Math.max(0, tableIdx))
  // 最近的 h2/h3 标题
  const headingRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi
  let last = null
  let h
  while ((h = headingRe.exec(before)) !== null) {
    const text = stripHtmlTags(h[1]).trim()
    if (text) last = text
  }
  if (last) return last
  // 兜底：最近一个非空白文本行
  const lines = stripHtmlTags(before).split('\n').map((s) => s.trim()).filter(Boolean)
  return lines.length > 0 ? lines[lines.length - 1] : null
}

/**
 * ZIP 包类型判定（P1-6 主：文件名关键词；兜底：CSV 列头）。
 * @param {string} zipFilename
 * @param {Array<{ filename: string, content: string }>} csvs
 * @returns {'eip_vpc' | 'elb' | null}
 */
export function detectPackageType(zipFilename, csvs) {
  const lower = zipFilename.toLowerCase()
  if (/eip|vpc/.test(lower)) return 'eip_vpc'
  if (/elb|slb/.test(lower)) return 'elb'
  // 兜底：CSV 列头形态判定
  for (const c of csvs) {
    if (/requestMapping/.test(c.content.slice(0, 500))) return 'eip_vpc'
    if (/resourceType/.test(c.content.slice(0, 500))) return 'elb'
  }
  return null
}

/**
 * 池名提取（P1-6 主：文件名日期前段；兜底：eip_vpc CSV 资源池列 / ELB 文件名大写段）。
 * @param {string} csvFilename
 * @param {string} csvContent
 * @param {'eip_vpc' | 'elb'} pkg
 * @returns {string | null}
 */
export function extractPoolName(csvFilename, csvContent, pkg) {
  const base = csvFilename.replace(/\.csv$/i, '')
  // 主：文件名含日期格式 → 截取日期前部分
  const dateMatch = /^(.+?)[\-_ ]?\d{4}-\d{2}-\d{2}/.exec(base)
  if (dateMatch && dateMatch[1].trim()) return dateMatch[1].trim()
  // 兜底 a：文件名直接是池名（无日期后缀）
  if (/^(华北|华东|华南|西南|西北|东北|华中)-/.test(base)) return base
  // 兜底 b：eip_vpc CSV 内无资源池列（列头在明细 CSV 中不存在）→ 尝试 ELB 文件名大写段/中文段
  if (pkg === 'elb') {
    // ELB 文件名形态：ELB_华北-北京3.csv / ELB_华南-广州3.csv → 取池段
    const poolMatch = /((?:华北|华东|华南|西南|西北|东北|华中)-[^\-_]+)/.exec(base)
    if (poolMatch) return poolMatch[1]
    // 文件名大写英文段兜底
    const upper = /[A-Z]{2,}/.exec(base.replace(/ELB|EIP|VPC/gi, ''))
    if (upper) return upper[0]
    return base
  }
  // eip_vpc：池名即文件名（样例形态 华南-广州3.csv）
  return base || null
}

/** ZIP 附件 → { pkg, csvs } 解析。 */
async function unzipAttachment(attachment) {
  const buf = Buffer.from(attachment.content, 'base64')
  const zip = await JSZip.loadAsync(buf)
  /** @type {Array<{ filename: string, content: string }>} */
  const csvs = []
  const names = Object.keys(zip.files)
  for (const name of names) {
    if (zip.files[name].dir) continue
    if (!/\.csv$/i.test(name)) continue
    const content = await zip.files[name].async('string')
    // BOM 剥离（样例 CSV 有 BOM）
    csvs.push({ filename: name.split('/').pop() || name, content: content.replace(/^\uFEFF/, '') })
  }
  return { csvs }
}

/**
 * CSV 文本 → 行对象数组（papaparse，header 模式，中文列名原样作 key——与推送 JSON 契约同构）。
 * @param {string} csvContent
 * @returns {Record<string, string>[]}
 */
export function parseCsvRows(csvContent) {
  const result = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  })
  if (!result.data || !Array.isArray(result.data)) return []
  return result.data.filter((r) => r && typeof r === 'object')
}

// ================================================================ 交叉校验

/** §9.4 P0-2：交叉校验阈值。 */
const CROSS_VALIDATE_PP = 0.05

/**
 * HTML-vs-CSV 交叉校验（P0-2）。
 * 口径：接口数差百分比 + 成功率绝对差，> 0.05pp 告警。
 * @param {{ productName: string, rows: Record<string, string>[] }[]} htmlSegments
 * @param {Array<{ pkg: 'eip_vpc' | 'elb', csvs: Array<{ filename: string, content: string, rows: Record<string, string>[] }> }>} zipParts
 * @param {{ key: string, name: string }[]} catalog
 * @returns {Array<{ product: string, issue: string, htmlCount: number, csvCount: number }>} 告警数组
 */
export function crossValidateHtmlVsCsv(htmlSegments, zipParts, catalog) {
  /** @type {Array<{ product: string, issue: string, htmlCount: number, csvCount: number }>} */
  const warnings = []

  // HTML 侧：每产品接口数（api_path 去重）+ 平均成功率
  /** @type {Map<string, { count: number, sumRate: number }>} */
  const htmlByProduct = new Map()
  for (const seg of htmlSegments) {
    const key = resolvePatrolProductKey(seg.productName, catalog)
    if (!key) continue
    const prev = htmlByProduct.get(key) || { count: 0, sumRate: 0 }
    const apiPaths = new Set(seg.rows.map((r) => String(r['接口名称'] || '').trim()).filter(Boolean))
    prev.count += apiPaths.size
    for (const r of seg.rows) {
      const rate = parseFloat(String(r['成功率'] || ''))
      if (!Number.isNaN(rate)) prev.sumRate += rate
    }
    htmlByProduct.set(key, prev)
  }

  // CSV 侧：每产品（eip_vpc→eip+vvc 两桶并算；elb→slb）接口数 + 成功率重算
  /** @type {Map<string, { count: Set<string>, success: number, total: number }>} */
  const csvByProduct = new Map()
  for (const part of zipParts) {
    for (const csv of part.csvs) {
      for (const row of csv.rows) {
        if (part.pkg === 'elb') {
          const bucket = csvByProduct.get('slb') || { count: new Set(), success: 0, total: 0 }
          const api = String(row.resourceType || '').trim()
          if (api) bucket.count.add(`${csv.filename}\u0000${api}`)
          const ok = String(row.resultStatus || '') === 'SUCCESS' ? 1 : 0
          bucket.success += ok
          bucket.total += 1
          csvByProduct.set('slb', bucket)
        } else {
          // eip_vpc：逐行按接口路径前缀启发式分桶（/customer/v3/network→vpc；其余 eip 简化）
          const apiPath = String(row.requestMapping || '').trim()
          const lower = apiPath.toLowerCase()
          const isVpc = lower.startsWith('/acl/v3/havip') || lower.startsWith('/customer/v3/network')
            || /\/(port|havip|subnet|router|vpc)(\/|$)/.test(lower)
          const key = isVpc ? 'vpc' : 'eip'
          const bucket = csvByProduct.get(key) || { count: new Set(), success: 0, total: 0 }
          if (apiPath) bucket.count.add(`${csv.filename}\u0000${apiPath}`)
          const ok = String(row.result || '') === '1' ? 1 : 0
          bucket.success += ok
          bucket.total += 1
          csvByProduct.set(key, bucket)
        }
      }
    }
  }

  // 比对（HTML 有产品的才校验——CSV 超集不反向告警）
  for (const [productKey, html] of htmlByProduct) {
    const csv = csvByProduct.get(productKey)
    const csvCount = csv ? csv.count.size : 0
    if (!csv || csv.total === 0) {
      warnings.push({ product: productKey, issue: 'CSV 无对应明细数据', htmlCount: html.count, csvCount: 0 })
      continue
    }
    // 接口数差百分比
    const countDiffPct = html.count > 0 ? Math.abs(html.count - csvCount) / html.count * 100 : 0
    // 成功率差（HTML 平均 vs CSV 重算）
    const htmlAvg = html.count > 0 ? html.sumRate / Math.max(1, segRateCount(htmlSegments, productKey, catalog)) : 0
    const csvRate = csv.total > 0 ? (csv.success / csv.total) * 100 : 0
    const rateDiff = Math.abs(htmlAvg - csvRate)
    if (countDiffPct > CROSS_VALIDATE_PP || rateDiff > CROSS_VALIDATE_PP) {
      warnings.push({
        product: productKey,
        issue: `接口数 ${html.count} vs ${csvCount}（差 ${countDiffPct.toFixed(2)}%）；成功率 ${htmlAvg.toFixed(2)}% vs ${csvRate.toFixed(2)}%（差 ${rateDiff.toFixed(2)}pp）`,
        htmlCount: html.count,
        csvCount,
      })
    }
  }
  return warnings
}

/** 某产品 HTML 行数（成功率均值分母）。 */
function segRateCount(segments, productKey, catalog) {
  let n = 0
  for (const seg of segments) {
    if (resolvePatrolProductKey(seg.productName, catalog) === productKey) n += seg.rows.length
  }
  return Math.max(1, n)
}

/**
 * 附件×正文产品交叉验证（P1-5b）。
 * @param {{ productName: string }[]} htmlSegments
 * @param {Array<{ pkg: 'eip_vpc' | 'elb' }>} zipParts
 * @param {{ key: string, name: string }[]} catalog
 * @returns {string[]} 告警消息数组
 */
export function crossValidateAttachmentProducts(htmlSegments, zipParts, catalog) {
  const htmlProducts = new Set()
  for (const seg of htmlSegments) {
    const key = resolvePatrolProductKey(seg.productName, catalog)
    if (key) htmlProducts.add(key)
  }
  const zipProducts = new Set()
  for (const z of zipParts) {
    if (z.pkg === 'elb') zipProducts.add('slb')
    else { zipProducts.add('eip'); zipProducts.add('vpc') }
  }
  /** @type {string[]} */
  const warnings = []
  for (const p of htmlProducts) {
    if (!zipProducts.has(p)) {
      warnings.push(`正文声明产品 ${p}，附件缺少对应 ZIP`)
    }
  }
  for (const p of zipProducts) {
    if (!htmlProducts.has(p) && p !== 'eip' && p !== 'vpc') {
      // eip+vpc 常为混装 ZIP；正文只要声明其一即视为覆盖，反向告警只对 slb
      warnings.push(`附件含产品 ${p}，正文未声明`)
    }
  }
  return warnings
}

// ================================================================ 主流程

/**
 * 拉取-解析-写入主流程（§9.3）。
 * @param {{ trigger?: 'schedule' | 'catch-up' | 'manual', force?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, lastResult: string, lastStats?: any, lastError?: string, skipped?: string }>}
 */
export async function runPatrolEmailIngestion(options = {}) {
  const trigger = options.trigger || 'manual'
  const force = trigger === 'manual' || options.force === true
  const config = readEmailIngestionConfig()
  const state = readEmailIngestionState()
  const today = localDateStr(new Date())

  const writeState = (result, extra = {}) => {
    writeEmailIngestionState({
      lastFetchAt: new Date().toISOString(),
      lastFetchDate: today,
      lastResult: result,
      ...extra,
    })
    return { ok: result === 'success', lastResult: result, ...extra }
  }

  // 幂等（§9.5）：非 force 且当日已拉 → skip
  if (!force && state?.lastFetchDate === today) {
    return { ok: true, lastResult: 'skipped', skipped: 'already-fetched' }
  }

  // P2-8：拉取失败可观测——fetch_error 路径
  /** @type {Array<{ raw: string, receivedAt: Date }>} */
  let emails = []
  try {
    emails = await fetchTodayEmails(config)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logAudit({
      username: 'system-scheduler',
      action: 'api_patrol.email_ingestion_fetch_error',
      detail: { trigger, error },
    })
    return writeState('fetch_error', { lastError: `IMAP: ${error}` })
  }

  // P0-3：无邮件 → no_email（info 级，非 error）
  if (emails.length === 0) {
    logAudit({
      username: 'system-scheduler',
      action: 'api_patrol.email_ingestion_no_email',
      detail: { trigger },
    })
    return writeState('no_email')
  }

  // P0-3：同日多封 → 取 Received 最新
  emails.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
  const email = emails[0]

  // MIME 解析（真实链路：simpleParser）
  /** @type {import('mailparser').ParsedMail} */
  let parsed
  try {
    parsed = await simpleParser(email.raw)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logAudit({
      username: 'system-scheduler',
      action: 'api_patrol.email_ingestion_parse_error',
      detail: { trigger, stage: 'mime', error },
    })
    return writeState('parse_error', { lastError: `MIME 解析失败: ${error}` })
  }

  // P0-1：发件人白名单（From 头精确匹配，剥离显示名防伪装）
  const fromAddr = extractEmailAddress(parsed.from?.text)
  if (!config.senderWhitelist.map((s) => s.toLowerCase()).includes(fromAddr)) {
    logAudit({
      username: 'system-scheduler',
      action: 'api_patrol.email_ingestion_sender_rejected',
      detail: { trigger, from: fromAddr, whitelist: config.senderWhitelist },
    })
    return writeState('sender_rejected', { lastError: `发件人不在白名单: ${fromAddr}` })
  }

  // 主题提取（三数交叉校验用；正则不匹配不阻断——日期走正文/T-1）
  const subjectMatch = SUBJECT_RE.exec(String(parsed.subject || ''))
  const subjectProducts = subjectMatch ? Number(subjectMatch[3]) : null

  // HTML 正文（multipart 取 html part）
  const html = typeof parsed.html === 'string' ? parsed.html : ''
  if (!html) {
    logAudit({
      username: 'system-scheduler',
      action: 'api_patrol.email_ingestion_parse_error',
      detail: { trigger, stage: 'html-body', error: '正文非 HTML 或为空' },
    })
    return writeState('parse_error', { lastError: '邮件正文非 HTML 或为空' })
  }

  // 数据日期（§9.2：正文标注优先；无标注按发送日期 T-1）
  const now = new Date()
  const fallbackDate = localDateStr(new Date(now.getTime() - 24 * 3600 * 1000))
  const dataDate = extractDataDateFromHtml(html) || fallbackDate

  // P1-5a：HTML 统计表双路解析
  const segments = parseStatsHtml(html)
  // 双路失败段（识别到产品标记但表格 0 行）→ 告警（P1-5a：单产品段失败不阻断）
  for (const seg of segments) {
    if (seg.rows.length === 0) {
      logAudit({
        username: 'system-scheduler',
        action: 'api_patrol.email_ingestion_html_segment_failed',
        detail: { trigger, product: seg.productName },
      })
    }
  }

  // P1-6：ZIP 附件解析（包类型 + 池名双兜底）
  /** @type {Array<{ pkg: 'eip_vpc' | 'elb', csvs: Array<{ filename: string, content: string, rows: Record<string, string>[] }> }>} */
  const zipParts = []
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : []
  for (const att of attachments) {
    try {
      const { csvs } = await unzipAttachment(att)
      if (csvs.length === 0) continue
      const pkg = detectPackageType(att.filename || '', csvs)
      if (!pkg) {
        logAudit({
          username: 'system-scheduler',
          action: 'api_patrol.email_ingestion_package_unknown',
          detail: { trigger, filename: att.filename },
        })
        continue
      }
      zipParts.push({
        pkg,
        csvs: csvs.map((c) => ({ ...c, rows: parseCsvRows(c.content) })),
      })
    } catch (err) {
      logAudit({
        username: 'system-scheduler',
        action: 'api_patrol.email_ingestion_parse_error',
        detail: { trigger, stage: 'zip', filename: att.filename, error: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  const catalog = await loadPatrolCatalogShared()

  // P1-5b：附件×正文产品交叉验证
  const productWarnings = crossValidateAttachmentProducts(segments, zipParts, catalog)
  for (const w of productWarnings) {
    logAudit({
      username: 'system-scheduler',
      action: 'api_patrol.email_ingestion_attachment_product_mismatch',
      detail: { trigger, warning: w },
    })
  }

  // P0-2：HTML-vs-CSV 交叉校验（不阻断写入，以 CSV 为准）
  const crossWarnings = crossValidateHtmlVsCsv(segments, zipParts, catalog)
  for (const w of crossWarnings) {
    logAudit({
      username: 'system-scheduler',
      action: 'api_patrol.email_ingestion_cross_validation_mismatch',
      detail: { trigger, product: w.product, issue: w.issue, htmlCount: w.htmlCount, csvCount: w.csvCount },
    })
  }

  // 写入（P0-4：进程内直调共享写入函数）
  let statsRows = 0
  let requestRows = 0
  const productsWritten = new Set()

  for (const seg of segments) {
    if (seg.rows.length === 0) continue
    const productKey = resolvePatrolProductKey(seg.productName, catalog)
    if (!productKey) {
      logAudit({
        username: 'system-scheduler',
        action: 'api_patrol.email_ingestion_product_unknown',
        detail: { trigger, product: seg.productName },
      })
      continue
    }
    const r = ingestPatrolStats({ date: dataDate, productKey, rows: seg.rows })
    statsRows += r.inserted + r.overwritten
    productsWritten.add(productKey)
  }

  for (const part of zipParts) {
    for (const csv of part.csvs) {
      if (csv.rows.length === 0) continue
      const pool = extractPoolName(csv.filename, csv.content, part.pkg)
      if (!pool) {
        logAudit({
          username: 'system-scheduler',
          action: 'api_patrol.email_ingestion_pool_unknown',
          detail: { trigger, filename: csv.filename },
        })
        continue
      }
      const r = ingestPatrolRequests({ date: dataDate, pool, pkg: part.pkg, rows: csv.rows })
      requestRows += r.inserted + r.overwritten
    }
  }

  const lastStats = {
    products: productsWritten.size,
    statsRows,
    requestRows,
    dataDate,
  }

  logAudit({
    username: 'system-scheduler',
    action: 'api_patrol.email_ingestion_fetch',
    detail: {
      trigger, result: 'success', dataDate,
      products: productsWritten.size, statsRows, requestRows,
      emailsFound: emails.length,
      subjectProducts,
    },
  })

  return writeState('success', { lastStats })
}

// ================================================================ 调度器

let ingestionTimer = null

/**
 * 启动 09:15 定时拉取（§9.7：与日报调度器同模式 setTimeout + 自愈 + 10 分钟轮询配置）。
 * @param {() => Date} [nowFn] 测试可注入时钟
 * @returns {() => void} stop
 */
export function startPatrolEmailIngestionScheduler(nowFn = () => new Date()) {
  const FETCH_TIME = '09:15'

  const nextFetchAt = () => {
    const now = nowFn()
    const [h, m] = FETCH_TIME.split(':').map(Number)
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0)
    if (candidate.getTime() > now.getTime()) return candidate
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h, m, 0, 0)
  }

  const arm = () => {
    const config = readEmailIngestionConfig()
    if (!config.enabled) {
      ingestionTimer = setTimeout(arm, 10 * 60 * 1000)
      return
    }
    const delay = nextFetchAt().getTime() - nowFn().getTime() + 1000
    ingestionTimer = setTimeout(async () => {
      try {
        await runPatrolEmailIngestion({ trigger: 'schedule' })
      } catch (err) {
        console.error('[patrol-email] 定时拉取异常：', err)
      }
      arm()
    }, delay)
  }

  // 启动自愈：当日未拉且已过 09:15 → 立即补拉
  const catchUp = async () => {
    const config = readEmailIngestionConfig()
    const state = readEmailIngestionState()
    const today = localDateStr(nowFn())
    const due = nextFetchAt().getTime() <= nowFn().getTime() + 60 * 1000
    if (config.enabled && state?.lastFetchDate !== today && due) {
      try {
        await runPatrolEmailIngestion({ trigger: 'catch-up' })
      } catch (err) {
        console.error('[patrol-email] 启动补拉异常：', err)
      }
    }
    arm()
  }
  catchUp()
  return () => {
    if (ingestionTimer) clearTimeout(ingestionTimer)
    ingestionTimer = null
  }
}
