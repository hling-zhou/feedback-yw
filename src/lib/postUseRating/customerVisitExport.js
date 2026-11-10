import * as XLSX from 'xlsx'
import { getActionItem } from '../actionItemClient.js'

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

function normalizedKey(customerName, customerCode, productName) {
  const code = String(customerCode || '').trim()
  const name = String(customerName || '').trim()
  const product = String(productName || '').trim()
  return `${code ? `code:${code}` : `name:${name}`}\u0000${product}`
}

/**
 * @typedef {Object} VisitRecord
 * @property {string} [id]
 * @property {string} [importMonth]
 * @property {string} [visitMonth]
 * @property {string} [customerName]
 * @property {string} [customerCode]
 * @property {string} [loginAccountName]
 * @property {string} [productName]
 * @property {string} [assigneeName]
 * @property {string} [scoreSource]
 * @property {string} [originalTicketId]
 * @property {string} [userFeedbackText] 客户反馈（导入列「客户反馈」，2026-11-10 导出列对齐补声明）
 * @property {string} [visitResult]
 * @property {string} [internalConclusion]
 * @property {string} [internalEvaluationDetail]
 * @property {string} [remark]
 * @property {string} [actionId]
 */

/**
 * @typedef {Object} ActionItemInfo
 * @property {string} [content]
 * @property {string} [detail]
 * @property {string} [scheduleAt]
 */

/**
 * @param {VisitRecord[]} visitRecords
 * @param {Array<Record<string, *>>} [recommendations]
 * @param {Map<string, ActionItemInfo>} [actionItemMap]
 */
export function buildPostUseCustomerVisitRows(visitRecords, recommendations = [], actionItemMap = new Map()) {
  const list = visitRecords || []
  const recMap = new Map(
    (recommendations || []).map((item) => [
      normalizedKey(item.customerName, item.customerCode, item.productName),
      item,
    ]),
  )

  return list.map((visit) => {
    const matched = recMap.get(
      normalizedKey(visit.customerName, visit.customerCode, visit.productName),
    )
    const actionItem = visit.actionId ? actionItemMap.get(visit.actionId) : undefined
    // 2026-11-10 用户拍板：导出列按《省代表回访-导出字段.xlsx》21 列序对齐——
    // 模板段（数据月份→备注）+ 抽屉人工段（确立举措/举措详情/排期）+ 推荐分析段（建议触发类型→涉及渠道）。
    // 客户反馈列内容 = 导入列表中的「客户反馈」列（userFeedbackText）。
    // 移除列：集团名称（模板可选列非导出列）、建议回访原因、动态 客户原话N/低分原因N（需求文件无）。
    /** @type {Record<string, string | number>} */
    const row = {
      数据月份: visit.importMonth || visit.visitMonth || '',
      客户名称: visit.customerName || '',
      客户编码: visit.customerCode || '',
      登录账号名称: visit.loginAccountName || '',
      产品名称: visit.productName || '',
      相应投诉工单: visit.scoreSource === '投诉回访' ? (visit.originalTicketId || '') : '',
      客户反馈: visit.userFeedbackText || '',
      回访结果: visit.visitResult || '',
      内部评估: visit.internalEvaluationDetail || visit.internalConclusion || '',
      经办人: visit.assigneeName || '',
      备注: visit.remark || '',
      确立举措: String(actionItem?.content || ''),
      举措详情: String(actionItem?.detail || ''),
      排期: String(actionItem?.scheduleAt || ''),
      建议触发类型: matched?.triggerType || '',
      '7分以下总次数': matched?.lowScoreLt7Count || 0,
      '7分以下分布': matched?.scoreBreakdown || '',
      原话命中条数: matched?.quoteCount || 0,
      低分原因命中条数: matched?.reasonCount || 0,
      最近反馈时间: matched?.latestFeedbackAt || '',
      涉及渠道: (matched?.channels || []).filter(Boolean).join('；'),
    }
    return row
  })
}

/**
 * 批量拉取 action items（对 actionId 非空的行并发拉取）。
 *
 * @param {VisitRecord[]} visitRecords
 * @returns {Promise<Map<string, ActionItemInfo>>}
 */
export async function fetchActionItemsForVisitExport(visitRecords = []) {
  const actionIds = visitRecords
    .map((v) => v.actionId)
    .filter(Boolean)
    .filter((id, index, arr) => arr.indexOf(id) === index)

  if (!actionIds.length) return new Map()

  const results = await Promise.allSettled(
    actionIds.map((id) => getActionItem(id)),
  )

  const map = new Map()
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      map.set(actionIds[index], result.value)
    }
  })
  return map
}

/**
 * 下载省代表回访 Excel（含抽屉人工输入结果：确立举措/举措详情/排期）。
 * 异步拉取 action_item 后生成 Excel。
 *
 * @param {VisitRecord[]} visitRecords
 * @param {Array<Record<string, *>>} [recommendations]
 * @param {string} [scopeLabel]
 */
export async function downloadPostUseCustomerVisitExcel(
  visitRecords,
  recommendations,
  scopeLabel = '当前范围',
) {
  const actionItemMap = await fetchActionItemsForVisitExport(visitRecords || [])
  const rows = buildPostUseCustomerVisitRows(visitRecords, recommendations, actionItemMap)
  const sheet = XLSX.utils.json_to_sheet(
    rows.length ? rows : [{ 提示: '当前范围内暂无省代表回访原单' }],
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, '省代表回访')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const datePart = new Date().toISOString().slice(0, 10)
  const safeScope = String(scopeLabel || '当前范围').replace(/[\\/:*?"<>|]+/g, '-')
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `省代表回访-${safeScope}-${datePart}.xlsx`,
  )
}
