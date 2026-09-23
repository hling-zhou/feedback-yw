/** @typedef {'import' | 'retag'} BackgroundTaskType */

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

/** 无心跳超过此时间视为可抢占。需大于单次 LLM 批次最慢耗时，避免任务进行中被误释放。 */
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
  return `${who} 正在执行后台任务，请稍后再试`
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 */
export function formatBackgroundTaskRemoteBanner(lock) {
  if (!lock) return ''
  const who = lock.username?.trim() || '其他用户'
  const progress = lock.progress?.trim()
  if (lock.type === 'import') {
    const month = lock.meta?.dataMonth
    const parts = [`${who} 正在导入数据`]
    if (month) parts.push(`数据月份 ${month}`)
    if (progress) parts.push(progress)
    return parts.join(' · ')
  }
  if (lock.type === 'retag') {
    const total = lock.meta?.total
    const parts = [`${who} 正在批量重新打标`]
    if (total) parts.push(`共 ${total} 条`)
    if (progress) parts.push(progress)
    return parts.join(' · ')
  }
  return progress ? `${who} · ${progress}` : `${who} 正在执行后台任务`
}

/**
 * 当前用户持有的锁：刷新后用于恢复反馈库进度条。
 * @param {BackgroundTaskLock | null | undefined} lock
 */
export function formatOwnedBackgroundTaskBanner(lock) {
  if (!lock) return ''
  const progress = lock.progress?.trim() || '进行中…'
  if (lock.type === 'import') {
    const month = lock.meta?.dataMonth
    return month ? `${progress} · 数据月份 ${month}` : progress
  }
  if (lock.type === 'retag') {
    const total = lock.meta?.total
    return total ? `${progress} · 共 ${total} 条` : progress
  }
  return progress
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
  if (a.type === 'retag' && b.type === 'retag') {
    return Boolean(a.meta?.periodId && a.meta.periodId === b.meta?.periodId)
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
