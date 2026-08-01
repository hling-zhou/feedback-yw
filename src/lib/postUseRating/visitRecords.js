/**
 * 客服回访信息（人工录入）— meta 存储
 */
export const META_KEY_POST_USE_VISITS = 'post_use_visit_records_v1'

/**
 * @typedef {Object} PostUseVisitRecord
 * @property {string} id
 * @property {string} visitMonth YYYY-MM（实际回访月，业务信息）
 * @property {string} [importMonth] YYYY-MM（数据导入月份，控制线上分析范围）
 * @property {string} productName
 * @property {string} feedbackSummary
 * @property {'控制台评分' | '短信评分' | '投诉回访' | string} scoreSource
 * @property {string} ratingText
 * @property {string} userInfo
 * @property {string} visitResult
 * @property {string} internalConclusion
 * @property {string} [userFeedbackText]
 * @property {string} [userInfoDetail]
 * @property {string} [visitFeedbackDetail]
 * @property {string} [internalEvaluationDetail]
 * @property {string} [jiraId]
 * @property {string} updatedAt
 */

/**
 * @param {unknown} raw
 * @returns {PostUseVisitRecord[]}
 */
export function normalizeVisitRecords(raw) {
  if (!raw || typeof raw !== 'object') return []
  const list = /** @type {{ records?: PostUseVisitRecord[] }} */ (raw).records
  if (!Array.isArray(list)) return []
  return list.map((item) => ({
    ...item,
    userFeedbackText: String(item?.userFeedbackText || ''),
    userInfoDetail: String(item?.userInfoDetail || item?.userInfo || ''),
    visitFeedbackDetail: String(item?.visitFeedbackDetail || item?.visitResult || ''),
    internalEvaluationDetail: String(
      item?.internalEvaluationDetail || item?.internalConclusion || '',
    ),
  }))
}

/**
 * @param {PostUseVisitRecord[]} records
 * @param {string} visitMonth
 */
export function filterVisitsByMonth(records, visitMonth) {
  return records.filter((r) => (r.importMonth || r.visitMonth) === visitMonth)
}

/**
 * 月报与线上当前月份使用同一数据范围。
 * @param {string} reportMonth YYYY-MM
 */
export function visitMonthForReport(reportMonth) {
  return /^\d{4}-\d{2}$/.test(String(reportMonth || '')) ? reportMonth : ''
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function loadVisitRecords(adapter) {
  return normalizeVisitRecords(await adapter.getMeta(META_KEY_POST_USE_VISITS))
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {PostUseVisitRecord[]} records
 */
export async function saveVisitRecords(adapter, records) {
  await adapter.putMeta(META_KEY_POST_USE_VISITS, {
    version: 1,
    updatedAt: new Date().toISOString(),
    records,
  })
}

/**
 * @param {PostUseVisitRecord[]} records
 * @param {PostUseVisitRecord} item
 */
export function upsertVisitRecord(records, item) {
  const idx = records.findIndex((r) => r.id === item.id)
  if (idx >= 0) {
    const next = [...records]
    next[idx] = item
    return next
  }
  return [...records, item]
}
