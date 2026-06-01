/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/**
 * @typedef {Object} ImportFinishedPayload
 * @property {string} dataMonth YYYY-MM
 * @property {DataSourceType} [dataSourceType]
 * @property {number} added 新写入条数
 * @property {number} [skippedDuplicates]
 * @property {number} [failures] 分析失败行数
 * @property {number} [skippedProducts] 产品范围外跳过
 * @property {string} [batchName]
 */

export const IMPORT_LEAVE_CONFIRM_MESSAGE =
  '数据导入正在进行中。离开本页不会中断导入，但无法看到进度；完成后将弹出通知。确定离开？'

export const IMPORT_BEFOREUNLOAD_MESSAGE =
  '数据导入正在进行中，关闭或刷新页面可能中断写入。确定离开？'

export const IMPORT_REBUILD_DISABLED_TIP =
  '数据导入进行中，请待导入完成后再刷新洞察'

/** 工单 Excel / 分析结果导入互斥 */
export const IMPORT_ALREADY_IN_PROGRESS_TIP =
  '数据导入进行中，请待当前导入完成后再试'

/** 工单详情保存：导入进行中 */
export const DETAIL_SAVE_BLOCKED_BY_IMPORT_TIP =
  '数据导入进行中，请待导入完成后再保存工单'

export const IMPORT_ANALYSIS_SESSION_LABEL = '分析结果导入'

export const IMPORT_ANALYSIS_BLOCKED_BY_RETAG_TIP =
  '批量重新打标进行中，请待打标完成后再导入分析结果'

export const IMPORT_SESSION_STORAGE_KEY = 'feedback-insights-import-in-progress'

/** 超过此时间的未完成标记视为过期并自动清除 */
const IMPORT_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * @typedef {Object} PersistedImportSession
 * @property {string} startedAt ISO 8601
 * @property {string} dataMonth YYYY-MM
 * @property {string} [batchName]
 * @property {string} [progress]
 * @property {DataSourceType} [dataSourceType]
 */

/**
 * @param {PersistedImportSession} session
 */
export function persistImportSessionMarker(session) {
  try {
    sessionStorage.setItem(IMPORT_SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* quota / private mode */
  }
}

export function clearImportSessionMarker() {
  try {
    sessionStorage.removeItem(IMPORT_SESSION_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * @returns {PersistedImportSession | null}
 */
export function readImportSessionMarker() {
  try {
    const raw = sessionStorage.getItem(IMPORT_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = /** @type {PersistedImportSession} */ (JSON.parse(raw))
    if (!parsed?.startedAt || !parsed?.dataMonth) {
      clearImportSessionMarker()
      return null
    }
    const age = Date.now() - new Date(parsed.startedAt).getTime()
    if (!Number.isFinite(age) || age < 0 || age > IMPORT_SESSION_MAX_AGE_MS) {
      clearImportSessionMarker()
      return null
    }
    return parsed
  } catch {
    clearImportSessionMarker()
    return null
  }
}

/**
 * @param {string} progress
 */
export function updateImportSessionMarkerProgress(progress) {
  const existing = readImportSessionMarker()
  if (!existing) return
  persistImportSessionMarker({ ...existing, progress })
}

/**
 * @param {PersistedImportSession} marker
 */
export function formatInterruptedImportMessage(marker) {
  const parts = [`数据月份 ${marker.dataMonth}`]
  if (marker.batchName) parts.push(`批次「${marker.batchName}」`)
  if (marker.progress) parts.push(`中断于：${marker.progress}`)
  return parts.join(' · ')
}

/**
 * 是否应在离开数据导入页时弹出确认（仅首次离开 /import，且导入进行中）
 * @param {{
 *   importActive: boolean
 *   leaveAcknowledged: boolean
 *   currentPath: string
 *   nextPath: string
 * }} params
 */
export function shouldConfirmLeaveImportPage({
  importActive,
  leaveAcknowledged,
  currentPath,
  nextPath,
}) {
  if (!importActive || leaveAcknowledged) return false
  return currentPath.startsWith('/import') && !nextPath.startsWith('/import')
}

/**
 * @param {ImportFinishedPayload} payload
 */
export function formatImportFinishedToast(payload) {
  const parts = [`${payload.dataMonth} 新增 ${payload.added} 条`]
  if (payload.skippedDuplicates) {
    parts.push(`去重跳过 ${payload.skippedDuplicates} 条`)
  }
  if (payload.failures) {
    parts.push(`分析失败 ${payload.failures} 行`)
  }
  if (payload.skippedProducts) {
    parts.push(`范围外跳过 ${payload.skippedProducts} 行`)
  }
  return parts.join('，')
}
