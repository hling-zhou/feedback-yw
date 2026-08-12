/**
 * 客服回访信息（人工录入）— meta 存储
 */
export const META_KEY_POST_USE_VISITS = 'post_use_visit_records_v1'

/**
 * @typedef {Object} PostUseVisitRecord
 * @property {string} id
 * @property {string} visitMonth YYYY-MM（N-1 月）
 * @property {string} productName
 * @property {string} feedbackSummary
 * @property {'控制台评分' | '短信评分' | '投诉回访' | string} scoreSource
 * @property {string} ratingText
 * @property {string} userInfo
 * @property {string} visitResult
 * @property {string} internalConclusion
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
  return Array.isArray(list) ? list : []
}

/**
 * @param {PostUseVisitRecord[]} records
 * @param {string} visitMonth
 */
export function filterVisitsByMonth(records, visitMonth) {
  return records.filter((r) => r.visitMonth === visitMonth)
}

/**
 * N 月月报使用 N-1 月回访
 * @param {string} reportMonth YYYY-MM
 */
export function visitMonthForReport(reportMonth) {
  const [y, m] = reportMonth.split('-').map(Number)
  if (!y || !m) return ''
  if (m === 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
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
