/**
 * 省代表回访信息（人工录入）— meta 存储
 */
import { resolvePostUseRatingProduct } from '../productCatalog/postUseRatingProducts.js'
import { normalizePostUseActionIds } from '../../domain/postUseActions.js'

export const META_KEY_POST_USE_VISITS = 'post_use_visit_records_v1'

/**
 * @typedef {Object} PostUseVisitRecord
 * @property {string} id
 * @property {string} [importContentId] 最近一次导入行的内容标识，用于多行同身份时重导匹配
 * @property {string} visitMonth YYYY-MM（实际回访月，业务信息）
 * @property {string} [importMonth] YYYY-MM（数据导入月份，控制线上分析范围）
 * @property {string} productName
 * @property {string} [customerName]
 * @property {string} [customerCode]
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
 * @property {string} [remark]
 * @property {boolean} [evaluationSubmitted] 2026-11-05 评估完结标记：提交=true / 暂存=false（状态派生用）
 * @property {string} [assigneeName]
 * @property {string[]} [manualEditedFields] 在线人工修改过的字段域，空值修改也计入
 * @property {Record<string, { userId: string, username: string, displayName?: string, editedAt: string }>} [fieldEditMeta]
 * @property {string} [actionId]
 * @property {string[]} [actionIds] 有序且去重的举措关联；显式空数组代表已清空
 * @property {string} [jiraId]
 * @property {string} [groupName] 集团名称（客户名称真源）
 * @property {string} [loginAccountName] 登录账号名称
 * @property {string} [originalTicketId] 原工单编号/相应投诉工单
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
    customerName: String(item?.customerName || item?.userInfoDetail || item?.userInfo || ''),
    customerCode: String(item?.customerCode || ''),
    groupName: String(item?.groupName || ''),
    loginAccountName: String(item?.loginAccountName || ''),
    originalTicketId: String(item?.originalTicketId || ''),
    scoreSource: String(item?.scoreSource || ''),
    userFeedbackText: String(item?.userFeedbackText || ''),
    assigneeName: String(item?.assigneeName || ''),
    actionIds: normalizePostUseActionIds(item?.actionIds, item?.actionId),
    actionId: normalizePostUseActionIds(item?.actionIds, item?.actionId)[0] || '',
    // 2026-11-05 评估状态派生：提交=已评估 / 暂存=评估中 / 空=待评估（Boolean 归一，旧数据 undefined=false 不影响）
    evaluationSubmitted: Boolean(item?.evaluationSubmitted),
    userInfoDetail: String(
      item?.userInfoDetail
      || [item?.customerName, item?.customerCode].filter(Boolean).join(' / ')
      || item?.userInfo
      || '',
    ),
    visitFeedbackDetail: String(item?.visitFeedbackDetail || item?.visitResult || ''),
    internalEvaluationDetail: String(
      item?.internalEvaluationDetail || item?.internalConclusion || '',
    ),
    remark: String(item?.remark || ''),
  }))
}

/**
 * @param {PostUseVisitRecord[]} records
 * @param {string} visitMonth
 */
export function filterVisitsByMonth(records, visitMonth) {
  return records.filter((r) => (r.importMonth || r.visitMonth) === visitMonth)
}

export function filterVisitsByMonths(records, months) {
  const monthSet = new Set(months || [])
  if (!monthSet.size) return []
  return (records || []).filter((record) => monthSet.has(record.importMonth || record.visitMonth))
}

/** 反馈库筛选与综合视图使用同一父产品口径；未归入目录的产品保留原始名称。 */
export function customerVisitProductName(record, catalog) {
  return resolvePostUseRatingProduct(record, catalog)?.name
    || String(record.product || record.productName || '').trim()
}

/**
 * 反馈库省代表回访视图的产品、客户筛选；周期由调用方先筛。
 * @template {{ id?: string, product?: string, productName?: string, customerName?: string }} T
 * @param {T[]} records
 * @param {{ product?: string, customerNames?: string[], catalog?: import('../productCatalogLoader.js').CatalogProduct[] }} [filters]
 * @returns {T[]}
 */
export function filterCustomerVisitRecords(records, { product = '', customerNames = [], catalog } = {}) {
  const needles = customerNames.map((name) => String(name || '').trim().toLowerCase()).filter(Boolean)
  return (records || []).filter((record) => {
    if (product && customerVisitProductName(record, catalog) !== product) return false
    if (!needles.length) return true
    const name = String(record.customerName || '').trim().toLowerCase()
    return needles.some((needle) => name.includes(needle))
  })
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
