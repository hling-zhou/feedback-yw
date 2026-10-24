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
  const maxQuotes = Math.max(0, ...((recommendations || []).map((item) => item.quotes?.length || 0)))
  const maxReasons = Math.max(0, ...((recommendations || []).map((item) => item.reasons?.length || 0)))

  return list.map((visit) => {
    const matched = recMap.get(
      normalizedKey(visit.customerName, visit.customerCode, visit.productName),
    )
    const actionItem = visit.actionId ? actionItemMap.get(visit.actionId) : undefined
    /** @type {Record<string, string | number>} */
    const row = {
      数据月份: visit.importMonth || visit.visitMonth || '',
      客户名称: visit.customerName || '',
      客户编码: visit.customerCode || '',
      登录账号名称: visit.loginAccountName || '',
      产品名称: visit.productName || '',
      经办人: visit.assigneeName || '',
      建议触发类型: matched?.triggerType || '',
      '7分以下总次数': matched?.lowScoreLt7Count || 0,
      '7分以下分布': matched?.scoreBreakdown || '',
      原话命中条数: matched?.quoteCount || 0,
      低分原因命中条数: matched?.reasonCount || 0,
      最近反馈时间: matched?.latestFeedbackAt || '',
      涉及渠道: (matched?.channels || []).filter(Boolean).join('；'),
      建议回访原因: matched?.recommendedReason || '',
      相应投诉工单: visit.scoreSource === '投诉回访' ? (visit.originalTicketId || '') : '',
      回访结果: visit.visitResult || '',
      内部评估: visit.internalEvaluationDetail || visit.internalConclusion || '',
      备注: visit.remark || '',
      确立举措: String(actionItem?.content || ''),
      举措详情: String(actionItem?.detail || ''),
      排期: String(actionItem?.scheduleAt || ''),
    }
    for (let i = 0; i < maxQuotes; i += 1) {
      row[`客户原话${i + 1}`] = matched?.quotes?.[i] || ''
    }
    for (let i = 0; i < maxReasons; i += 1) {
      row[`低分原因${i + 1}`] = matched?.reasons?.[i] || ''
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
 * 下载客服部回访 Excel（含抽屉人工输入结果：确立举措/举措详情/排期）。
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
    rows.length ? rows : [{ 提示: '当前范围内暂无客服部回访原单' }],
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, '客服部回访')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const datePart = new Date().toISOString().slice(0, 10)
  const safeScope = String(scopeLabel || '当前范围').replace(/[\\/:*?"<>|]+/g, '-')
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `客服部回访-${safeScope}-${datePart}.xlsx`,
  )
}
