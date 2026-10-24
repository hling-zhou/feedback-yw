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

/**
 * 产品部溯源导出行构建（14 列：列表基础信息 + 抽屉人工输入结果）。
 *
 * @typedef {Object} PostUseJiraItem
 * @property {string} [id]
 * @property {string} [importMonth]
 * @property {string} [customerName]
 * @property {string} [customerCode]
 * @property {string} [loginAccountName]
 * @property {string} [productName]
 * @property {string} [customerFeedback]
 * @property {string} [recommendedReason]
 * @property {string} [originalTicketId]
 * @property {string} [scoreSource]
 * @property {string} [assigneeName]
 * @property {string} [status]
 * @property {string} [progress]
 * @property {string} [actionId]
 *
 * @typedef {Object} ActionItemInfo
 * @property {string} [content]
 * @property {string} [detail]
 * @property {string} [scheduleAt]
 *
 * @param {PostUseJiraItem[]} items
 * @param {Map<string, ActionItemInfo>} [actionItemMap]
 * @returns {Record<string, string>[]}
 */
export function buildPostUseJiraExportRows(items = [], actionItemMap = new Map()) {
  return items.map((item) => {
    const actionItem = item.actionId ? actionItemMap.get(item.actionId) : undefined
    return {
      数据月份: String(item.importMonth || ''),
      客户名称: String(item.customerName || ''),
      客户编码: String(item.customerCode || ''),
      登录账号名称: String(item.loginAccountName || ''),
      产品名称: String(item.productName || ''),
      客户反馈: String(item.customerFeedback || ''),
      建议回访原因: String(item.recommendedReason || ''),
      相应投诉工单: item.scoreSource === '投诉回访' ? String(item.originalTicketId || '') : '',
      经办人: String(item.assigneeName || ''),
      状态: String(item.status || ''),
      进展: String(item.progress || ''),
      确立举措: String(actionItem?.content || ''),
      举措详情: String(actionItem?.detail || ''),
      排期: String(actionItem?.scheduleAt || ''),
    }
  })
}

/**
 * 批量拉取 action items（对 actionId 非空的行并发拉取）。
 *
 * @param {PostUseJiraItem[]} items
 * @returns {Promise<Map<string, ActionItemInfo>>}
 */
export async function fetchActionItemsForExport(items = []) {
  const actionIds = items
    .map((item) => item.actionId)
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
 * 下载产品部溯源 Excel（单 sheet，14 列）。
 * 自动拉取 action_item 信息填入抽屉字段。
 *
 * @param {PostUseJiraItem[]} items
 * @param {string} [scopeLabel]
 * @param {Map<string, ActionItemInfo>} [actionItemMap] - 可预传入，避免重复拉取
 */
export async function downloadPostUseJiraExcel(items, scopeLabel = '当前范围', actionItemMap) {
  const map = actionItemMap || (await fetchActionItemsForExport(items))
  const rows = buildPostUseJiraExportRows(items, map)
  const sheet = XLSX.utils.json_to_sheet(
    rows.length ? rows : [{ 提示: '当前范围内暂无产品部溯源记录' }],
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, '产品部溯源')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const datePart = new Date().toISOString().slice(0, 10)
  const safeScope = String(scopeLabel || '当前范围').replace(/[\\/:*?"<>|]+/g, '-')
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `产品部溯源-${safeScope}-${datePart}.xlsx`,
  )
}
