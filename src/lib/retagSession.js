/** @typedef {'period_all' | 'unknown_journey' | 'needs_ticket_llm' | 'needs_journey_llm' | 'filtered'} BulkRetagScope */

/** @type {Record<BulkRetagScope, string>} */
export const BULK_RETAG_SCOPE_LABELS = {
  period_all: '当前洞察周期内全部工单',
  unknown_journey: '仅用户旅程为「未识别环节」的工单',
  needs_ticket_llm: '仅未完成 LLM 增强的工单（客户请求/痛点/优化建议）',
  needs_journey_llm: '仅未完成旅程 LLM 增强的工单',
  filtered: '仅当前筛选结果范围内的工单',
}

/**
 * @typedef {Object} RetagFinishedPayload
 * @property {number} total
 * @property {number} beforeUnknown
 * @property {number} afterUnknown
 * @property {BulkRetagScope} [scope]
 * @property {import('./journeyRetagSummary.js').summarizeUnknownJourneyRecords extends (...args: infer A) => infer R ? R : never} summary
 */

export const RETAG_REBUILD_DISABLED_TIP =
  '批量重新打标进行中，请待打标完成后再刷新洞察'

export const RETAG_IMPORT_BLOCKED_TIP =
  '批量重新打标进行中，请待打标完成后再导入'

export const RETAG_BLOCKED_BY_IMPORT_TIP =
  '数据导入进行中，请待导入完成后再批量重新打标'

export const RETAG_IN_PROGRESS_TIP = '打标进行中'

/** 工单详情等入口：批量打标进行中时禁用单条重新打标 */
export const RETAG_DETAIL_IN_PROGRESS_TIP = '批量重新打标进行中，请待完成后再试。'

/** 批量打标后台执行说明（确认框 / 进度条） */
export const RETAG_BACKGROUND_RUN_HINT = '任务在后台执行，可切换至其他页面，完成后将通知您'

export const RETAG_SESSION_STORAGE_KEY = 'feedback-insights-retag-in-progress'

/**
 * @param {BulkRetagScope | 'all' | undefined} scope
 */
export function formatBulkRetagScopeLabel(scope) {
  if (!scope || scope === 'all') return '批量重新打标'
  return BULK_RETAG_SCOPE_LABELS[scope] || '批量重新打标'
}

/** 超过此时间的未完成标记视为过期并自动清除 */
const RETAG_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * @typedef {Object} PersistedRetagSession
 * @property {string} startedAt ISO 8601
 * @property {number} total
 * @property {string} [progress]
 * @property {BulkRetagScope | 'all'} [scope]
 */

/**
 * @param {PersistedRetagSession} session
 */
export function persistRetagSessionMarker(session) {
  try {
    sessionStorage.setItem(RETAG_SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* quota / private mode */
  }
}

export function clearRetagSessionMarker() {
  try {
    sessionStorage.removeItem(RETAG_SESSION_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * @returns {PersistedRetagSession | null}
 */
export function readRetagSessionMarker() {
  try {
    const raw = sessionStorage.getItem(RETAG_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = /** @type {PersistedRetagSession} */ (JSON.parse(raw))
    if (!parsed?.startedAt || !parsed?.total) {
      clearRetagSessionMarker()
      return null
    }
    const age = Date.now() - new Date(parsed.startedAt).getTime()
    if (!Number.isFinite(age) || age < 0 || age > RETAG_SESSION_MAX_AGE_MS) {
      clearRetagSessionMarker()
      return null
    }
    return parsed
  } catch {
    clearRetagSessionMarker()
    return null
  }
}

/**
 * @param {string} progress
 */
export function updateRetagSessionMarkerProgress(progress) {
  const existing = readRetagSessionMarker()
  if (!existing) return
  persistRetagSessionMarker({ ...existing, progress })
}

/**
 * @param {PersistedRetagSession} marker
 */
export function formatInterruptedRetagMessage(marker) {
  const parts = [formatBulkRetagScopeLabel(marker.scope), `共 ${marker.total} 条`]
  if (marker.progress) parts.push(`中断于：${marker.progress}`)
  return parts.join(' · ')
}

