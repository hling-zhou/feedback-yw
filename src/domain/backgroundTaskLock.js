import { DATA_SOURCE_LABELS } from './enums.js'

/** @typedef {'import' | 'retag' | 'post_use_journey'} BackgroundTaskType */

/**
 * @typedef {Object} BackgroundTaskLock
 * @property {string} id
 * @property {BackgroundTaskType} type
 * @property {string} userId
 * @property {string} username
 * @property {string} startedAt ISO 8601
 * @property {string} updatedAt ISO 8601
 * @property {string} [progress]
 * @property {Record<string, unknown>} [meta]
 */

export const META_KEY_BACKGROUND_TASK_LOCK = 'background_task_lock'

/** 进行中任务列表（可并行，按数据月份 + 数据源互斥） */
export const META_KEY_BACKGROUND_TASKS = 'background_tasks'

/** 已完成、待前端读取的结果，按任务 id */
export const META_KEY_BACKGROUND_TASK_RESULTS = 'background_task_results'

/** 任务历史 meta key */
export const META_KEY_BACKGROUND_TASK_HISTORY = 'background_task_history'

/** 任务完成结果 meta key（独立于 lock，前端读取后清除） */
export const META_KEY_BACKGROUND_TASK_RESULT = 'background_task_result'

/** 取消标志 meta key（前端设 true，enrichRunner 循环检查） */
export const META_KEY_BACKGROUND_TASK_CANCEL = 'background_task_cancel'

/** 前端本地阶段（规则打标等）；刷新会中断 */
export const BACKGROUND_TASK_PHASE_CLIENT = 'client'

/** 服务端 enrich 阶段；刷新后任务仍继续 */
export const BACKGROUND_TASK_PHASE_ENRICH = 'enrich'

/** 历史记录最大条数，超出淘汰最老的 */
export const BACKGROUND_TASK_HISTORY_LIMIT = 50

/** 无心跳超过此时间视为进程已退出、锁可释放。服务端任务自行续期，不依赖单次打标进度。 */
export const BACKGROUND_TASK_STALE_MS = 10 * 60 * 1000

/** 最长占用时间，防止异常退出后永久占锁 */
export const BACKGROUND_TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 * @param {number} [nowMs]
 */
export function isBackgroundTaskLockExpired(lock, nowMs = Date.now()) {
  if (!lock?.startedAt) return true
  const started = Date.parse(lock.startedAt)
  if (!Number.isFinite(started)) return true
  return nowMs - started > BACKGROUND_TASK_MAX_AGE_MS
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 * @param {number} [nowMs]
 */
export function isBackgroundTaskLockStale(lock, nowMs = Date.now()) {
  if (!lock) return true
  if (isBackgroundTaskLockExpired(lock, nowMs)) return true
  const updated = Date.parse(lock.updatedAt || lock.startedAt)
  if (!Number.isFinite(updated)) return true
  return nowMs - updated > BACKGROUND_TASK_STALE_MS
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 * @param {number} [nowMs]
 */
export function isBackgroundTaskLockActive(lock, nowMs = Date.now()) {
  return Boolean(lock?.id && !isBackgroundTaskLockStale(lock, nowMs))
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 * @param {string | null | undefined} userId
 */
export function isBackgroundTaskLockHeldByUser(lock, userId) {
  return Boolean(lock?.userId && userId && lock.userId === userId)
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 */
export function formatBackgroundTaskBlockedTip(lock) {
  if (!lock) return '其他用户正在执行后台任务，请稍后再试'
  const who = lock.username?.trim() || '其他用户'
  if (lock.type === 'import') {
    return `${who} 正在进行数据导入，请待完成后再试`
  }
  if (lock.type === 'retag') {
    return `${who} 正在进行批量重新打标，请待完成后再试`
  }
  if (lock.type === 'post_use_journey') {
    return `${who} 正在补全用户旅程，请待完成后再试`
  }
  return `${who} 正在执行后台任务，请稍后再试`
}

/**
 * 任务自己的数据月份。优先 dataMonth，否则从周期起日或周期 id 取 YYYY-MM；
 * 用后即评导入（importKind）锁的月份字段是 importMonth，作最终回退。
 * 注意：周期粒度显示（季度/年度/多月份聚合）用 backgroundTaskPeriodLabel，本函数是月粒度兜底。
 * @param {Record<string, unknown> | null | undefined} meta
 */
export function backgroundTaskMonth(meta) {
  const month = String(meta?.dataMonth || '').trim()
  if (/^\d{4}-\d{2}/.test(month)) return month.slice(0, 7)
  const start = String(meta?.periodStart || '').trim()
  if (/^\d{4}-\d{2}/.test(start)) return start.slice(0, 7)
  const periodId = String(meta?.periodId || '').trim()
  if (/^\d{4}-\d{2}$/.test(periodId)) return periodId
  const importMonth = String(meta?.importMonth || '').trim()
  if (/^\d{4}-\d{2}/.test(importMonth)) return importMonth.slice(0, 7)
  return ''
}

/**
 * 周期 id（稳定格式）→ 粒度化显示标签。解析失败返回 ''。
 * 与 insightPeriod.js 的 periodIdFromSpec 格式同源（period:month:2026-08 /
 * period:quarter:2026-Q3 / period:year:2026 / period:custom:2026-05_2026-07）。
 * @param {string} periodId
 */
function periodLabelFromStableId(periodId) {
  const id = String(periodId || '').trim()
  let m = /^period:month:(\d{4})-(\d{2})$/.exec(id)
  if (m) return `${m[1]}年${Number(m[2])}月`
  m = /^period:quarter:(\d{4})-Q([1-4])$/.exec(id)
  if (m) return `${m[1]}年Q${m[2]}`
  m = /^period:year:(\d{4})$/.exec(id)
  if (m) return `${m[1]}年`
  m = /^period:custom:(\d{4})-(\d{2})_(\d{4})-(\d{2})$/.exec(id)
  if (m) {
    return m[1] === m[3] && m[2] === m[4]
      ? `${m[1]}年${Number(m[2])}月`
      : `${m[1]}年${Number(m[2])}月–${Number(m[4])}月`
  }
  // 兼容：旧数据/旧约定可能存纯 YYYY-MM（backgroundTaskMonth 同分支语义）
  m = /^(\d{4})-(\d{2})$/.exec(id)
  if (m) return `${m[1]}年${Number(m[2])}月`
  return ''
}

/**
 * 多月份串（优化建议等传 importMonth/dataMonth="2026-07、2026-08、2026-09"）→ 聚合显示。
 * 单月返回「2026年7月」；连续多月返回「2026年7月–9月」；跨年返回首末月。解析失败返回 ''。
 * @param {string} joined
 */
function periodLabelFromMonthList(joined) {
  const months = String(joined || '')
    .split(/[、,，;；|]/)
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}$/.test(s))
  if (!months.length) return ''
  const first = months[0]
  const last = months[months.length - 1]
  const [fy, fm] = first.split('-').map(Number)
  const [ly] = last.split('-').map(Number)
  if (fy !== ly) return `${first}–${last}`
  if (months.length === 1) return `${fy}年${fm}月`
  const [, lm] = last.split('-').map(Number)
  return `${fy}年${fm}月–${lm}月`
}

/**
 * 任务的周期显示标签（粒度感知）。优先级：
 * ① periodId 稳定 id（period:month:/quarter:/year:/custom:）→ 按粒度显示；
 * ② dataMonth / importMonth 多月份串 → 聚合显示（7月–9月）；
 * ③ 单值 dataMonth / importMonth → 「2026年8月」；
 * ④ periodStart 兜底 → 「2026年7月」（旧条目/仅起日）。
 * 返回 '' 时消费方不渲染周期段。
 * @param {Record<string, unknown> | null | undefined} meta
 */
export function backgroundTaskPeriodLabel(meta) {
  const periodIdLabel = periodLabelFromStableId(String(meta?.periodId || ''))
  if (periodIdLabel) return periodIdLabel
  const joined = String(meta?.importMonth || meta?.dataMonth || '').trim()
  if (joined) {
    const listLabel = periodLabelFromMonthList(joined)
    if (listLabel) return listLabel
    const single = /^\d{4}-\d{2}/.test(joined) ? joined.slice(0, 7) : ''
    if (single) {
      const [y, m] = single.split('-').map(Number)
      return `${y}年${m}月`
    }
  }
  const start = String(meta?.periodStart || '').trim()
  if (/^\d{4}-\d{2}/.test(start)) {
    const [y, m] = start.slice(0, 7).split('-').map(Number)
    return `${y}年${m}月`
  }
  return ''
}

/**
 * 任务自己的数据类型，不跟当前页签走。
 * @param {BackgroundTaskLock | { type?: string, meta?: Record<string, unknown> } | null | undefined} lock
 */
export function backgroundTaskSourceLabel(lock) {
  const source = String(lock?.meta?.dataSourceType || '')
  if (source && DATA_SOURCE_LABELS[/** @type {keyof typeof DATA_SOURCE_LABELS} */ (source)]) {
    return DATA_SOURCE_LABELS[/** @type {keyof typeof DATA_SOURCE_LABELS} */ (source)]
  }
  if (lock?.type === 'post_use_journey') return DATA_SOURCE_LABELS.post_use_rating
  if (lock?.type === 'retag') return '投诉咨询工单'
  return ''
}

/**
 * 任务对象行（数据月份 · 数据类型），与页面提示条同源同格式。
 * 进行中条目传 lock（meta 在顶层），历史条目传 TaskHistoryEntry（meta 字段平铺）。
 * 无月份且无显式数据源时返回空串（旧历史条目不渲染对象行）。
 * @param {{ type?: string, meta?: Record<string, unknown> } | { type?: string, dataMonth?: string, dataSourceType?: string, periodId?: string, periodStart?: string } | null | undefined} task
 * @returns {string}
 */
export function formatTaskTargetLine(task) {
  if (!task) return ''
  const raw = /** @type {Record<string, unknown>} */ (task)
  const hasMeta = Boolean(raw.meta && typeof raw.meta === 'object')
  const metaView = /** @type {Record<string, unknown>} */ (hasMeta ? raw.meta : raw)
  const periodLabel = backgroundTaskPeriodLabel(metaView)
  if (!periodLabel && !String(metaView.dataSourceType || '').trim()) return ''
  const source = backgroundTaskSourceLabel({
    type: /** @type {string} */ (raw.type),
    meta: metaView,
  })
  return [periodLabel, source].filter(Boolean).join(' · ')
}

/**
 * 月份 · 数据类型 · 任务进度。进度里已含任务名时不再重复。
 * @param {BackgroundTaskLock | { type?: BackgroundTaskType, progress?: string, meta?: Record<string, unknown> } | null | undefined} lock
 */
export function formatBackgroundTaskProgressLine(lock) {
  if (!lock) return ''
  const action = backgroundTaskTypeLabel(/** @type {BackgroundTaskType} */ (lock.type))
  const progress = String(lock.progress || '').trim()
  const detail = progress
    ? progress.includes(action)
      ? progress
      : `${action} · ${progress}`
    : action
  return [backgroundTaskPeriodLabel(lock.meta), backgroundTaskSourceLabel(lock), detail].filter(Boolean).join(' · ')
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 */
export function formatBackgroundTaskRemoteBanner(lock) {
  if (!lock) return ''
  const who = lock.username?.trim() || '其他用户'
  const line = formatBackgroundTaskProgressLine(lock)
  return line ? `${who} · ${line}` : `${who} 正在执行后台任务`
}

/**
 * 当前用户持有的锁：刷新后用于恢复反馈库进度条。
 * @param {BackgroundTaskLock | null | undefined} lock
 */
export function formatOwnedBackgroundTaskBanner(lock) {
  if (!lock) return ''
  return formatBackgroundTaskProgressLine(lock)
}

/**
 * 服务端 enrich 已接管（协作式取消，刷新不中断）。
 * @param {BackgroundTaskLock | null | undefined} lock
 */
export function isBackgroundTaskEnrichPhase(lock) {
  if (!lock) return false
  if (lock.meta?.phase === BACKGROUND_TASK_PHASE_ENRICH) return true
  if (lock.meta?.phase === BACKGROUND_TASK_PHASE_CLIENT) return false
  return /增强打标|刷新标签库|刷新产品目录|注入 LLM|加载 LLM|开始导入打标|开始规则重打标|开始 LLM|正在规则重打标|正在LLM/.test(
    lock.progress || '',
  )
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 */
export function isBackgroundTaskCancelRequested(lock) {
  return Boolean(lock?.meta?.cancelled)
}

/**
 * @param {BackgroundTaskType} type
 */
export function backgroundTaskTypeLabel(type) {
  if (type === 'import') return '数据导入'
  if (type === 'retag') return '批量重新打标'
  if (type === 'post_use_journey') return '补全用户旅程'
  return '后台任务'
}

const TICKET_IMPORT_SOURCES = new Set(['complaint_ticket', 'consultation_ticket'])

/**
 * @param {string | undefined} dataSourceType
 */
export function isTicketImportSource(dataSourceType) {
  return TICKET_IMPORT_SOURCES.has(dataSourceType || '')
}

/**
 * @param {string | undefined} importMonth YYYY-MM
 * @param {string | undefined} periodStart
 * @param {string | undefined} periodEnd
 */
export function importMonthOverlapsPeriod(importMonth, periodStart, periodEnd) {
  if (!importMonth || !periodStart || !periodEnd) return false
  const day = `${importMonth}-01`
  return day >= periodStart && day <= periodEnd
}

/**
 * 两条任务是否会写到同一批对象。
 * @param {BackgroundTaskLock} existing
 * @param {{ type: BackgroundTaskType, meta?: Record<string, unknown> }} incoming
 */
export function backgroundTasksConflict(existing, incoming) {
  const a = existing
  const b = incoming
  if (a.type === 'import' && b.type === 'import') {
    return Boolean(
      a.meta?.dataSourceType &&
        a.meta.dataSourceType === b.meta?.dataSourceType &&
        a.meta?.dataMonth &&
        a.meta.dataMonth === b.meta?.dataMonth,
    )
  }
  if (
    (a.type === 'retag' || a.type === 'post_use_journey') &&
    (b.type === 'retag' || b.type === 'post_use_journey')
  ) {
    return Boolean(a.meta?.periodId && a.meta.periodId === b.meta?.periodId)
  }
  if (a.type === 'post_use_journey' || b.type === 'post_use_journey') {
    const journeyTask = a.type === 'post_use_journey' ? a : b
    const other = journeyTask === a ? b : a
    if (other.type !== 'import' || other.meta?.dataSourceType !== 'post_use_rating') return false
    return importMonthOverlapsPeriod(
      /** @type {string} */ (other.meta?.dataMonth),
      /** @type {string} */ (journeyTask.meta?.periodStart),
      /** @type {string} */ (journeyTask.meta?.periodEnd),
    )
  }
  const importTask = a.type === 'import' ? a : b
  const retagTask = a.type === 'retag' ? a : b
  if (importTask.type !== 'import' || retagTask.type !== 'retag') return false
  if (!isTicketImportSource(/** @type {string} */ (importTask.meta?.dataSourceType))) return false
  return importMonthOverlapsPeriod(
    /** @type {string} */ (importTask.meta?.dataMonth),
    /** @type {string} */ (retagTask.meta?.periodStart),
    /** @type {string} */ (retagTask.meta?.periodEnd),
  )
}

/**
 * @param {BackgroundTaskLock[]} tasks
 * @param {{ type: BackgroundTaskType, meta?: Record<string, unknown> }} incoming
 */
export function findConflictingBackgroundTask(tasks, incoming) {
  return tasks.find((task) => backgroundTasksConflict(task, incoming)) || null
}

/**
 * 本机导入会话是否挡住下一次导入。
 * 月份不同，或两边都有数据源且不相同，则不挡住。
 * 会话缺少月份或数据源、无法证明是另一批时，仍挡住。
 * @param {{ active?: boolean, dataMonth?: string, dataSourceType?: string } | null | undefined} session
 * @param {{ dataMonth?: string, dataSourceType?: string }} [incoming]
 */
export function importSessionConflicts(session, incoming = {}) {
  if (!session?.active) return false
  const month = incoming.dataMonth
  const source = incoming.dataSourceType
  if (session.dataMonth && month && session.dataMonth !== month) return false
  if (session.dataSourceType && source && session.dataSourceType !== source) return false
  return true
}

/**
 * 本机导入/重打标会话是否挡住这一次重打标。
 * 只在投诉/咨询导入的数据月份落在该周期内，或已有同一周期的重打标时挡住。
 * @param {{ active?: boolean, dataMonth?: string, dataSourceType?: string } | null | undefined} importSession
 * @param {{ active?: boolean, periodId?: string, runs?: { periodId?: string }[] } | null | undefined} retagSession
 * @param {{ periodId?: string, periodStart?: string, periodEnd?: string }} incoming
 * @returns {'import' | 'retag' | null}
 */
export function retagStartConflict(importSession, retagSession, incoming = {}) {
  const retagIncoming = {
    type: /** @type {BackgroundTaskType} */ ('retag'),
    meta: {
      periodId: incoming.periodId,
      periodStart: incoming.periodStart,
      periodEnd: incoming.periodEnd,
    },
  }
  if (
    importSession?.active &&
    backgroundTasksConflict(
      {
        type: 'import',
        meta: {
          dataMonth: importSession.dataMonth,
          dataSourceType: importSession.dataSourceType,
        },
      },
      retagIncoming,
    )
  ) {
    return 'import'
  }
  const runs =
    Array.isArray(retagSession?.runs) && retagSession.runs.length
      ? retagSession.runs
      : retagSession?.active
        ? [retagSession]
        : []
  if (runs.some((run) => incoming.periodId && run.periodId === incoming.periodId)) {
    return 'retag'
  }
  return null
}
