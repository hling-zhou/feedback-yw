import * as XLSX from 'xlsx'
import {
  callbackNonTenItemKey,
  questionnaireCallbackItemKey,
} from './callbackRecommendations.js'

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

function downloadWorkbook(wb, filename) {
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  )
}

function joinLabeledParts(parts) {
  return (parts || []).filter((part) => part && String(part).trim()).join('；')
}

export function buildQuestionnaireFollowupFeedback(item) {
  return joinLabeledParts([
    item?.scoreBreakdown ? `7分以下分布：${item.scoreBreakdown}` : '',
    item?.feedbackReasonSummary ? `反馈原因：${item.feedbackReasonSummary}` : '',
  ])
}

export function buildCallbackNonTenFollowupFeedback(item) {
  return joinLabeledParts([
    `原工单编号：${item?.originalTicketId || ''}`,
    `投诉整体服务评价：${item?.score ?? ''}`,
    `不满原因：${item?.dissatisfactionReason || ''}`,
    `客户请求内容：${item?.customerRequest || ''}`,
    `问题原因：${item?.problemCause || ''}`,
  ])
}

export function toQuestionnaireFollowupRow(item) {
  return {
    itemKey: item?.itemKey || questionnaireCallbackItemKey(item),
    sourceType: 'questionnaire',
    数据月份: (item?.importMonths || []).filter(Boolean).join('、'),
    客户名称: item?.customerName || '',
    客户编码: item?.customerCode || '',
    产品名称: item?.productName || '',
    客户反馈: buildQuestionnaireFollowupFeedback(item),
  }
}

export function toCallbackNonTenFollowupRow(item) {
  return {
    itemKey: item?.itemKey || callbackNonTenItemKey(item),
    sourceType: 'callback_non_ten',
    数据月份: item?.importMonth || '',
    客户名称: item?.customerName || '',
    客户编码: item?.customerCode || '',
    产品名称: item?.productName || '',
    客户反馈: buildCallbackNonTenFollowupFeedback(item),
  }
}

export function buildFollowupTableExportRows(rows) {
  return (rows || []).map((item) => ({
    数据月份: item.数据月份 || '',
    客户名称: item.客户名称 || '',
    客户编码: item.客户编码 || '',
    产品名称: item.产品名称 || '',
    客户反馈: item.客户反馈 || '',
  }))
}

/**
 * @param {object[]} questionnaireItems
 * @param {object[]} callbackItems
 * @param {Map<string, { needCustomerVisit?: boolean; needInternalTrace?: boolean }>} decisions
 */
export function collectFollowupExportRows(questionnaireItems, callbackItems, decisions, flag) {
  const map = decisions instanceof Map ? decisions : new Map()
  const selected = []
  for (const item of questionnaireItems || []) {
    const row = toQuestionnaireFollowupRow(item)
    if (map.get(row.itemKey)?.[flag]) selected.push(row)
  }
  for (const item of callbackItems || []) {
    const row = toCallbackNonTenFollowupRow(item)
    if (map.get(row.itemKey)?.[flag]) selected.push(row)
  }
  return selected
}

export function downloadFollowupTableExcel(rows, filenamePrefix, scopeLabel = '当前范围') {
  const exportRows = buildFollowupTableExportRows(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      exportRows.length ? exportRows : [{ 提示: `当前范围内暂无${filenamePrefix}记录` }],
    ),
    filenamePrefix,
  )
  const datePart = new Date().toISOString().slice(0, 10)
  const safeScope = String(scopeLabel || '当前范围').replace(/[\\/:*?"<>|]+/g, '-')
  downloadWorkbook(wb, `${filenamePrefix}-${safeScope}-${datePart}.xlsx`)
}

export function toJiraArchivePayload(row) {
  return {
    itemKey: row.itemKey,
    sourceType: row.sourceType,
    importMonth: row.数据月份 || '',
    customerName: row.客户名称 || '',
    customerCode: row.客户编码 || '',
    productName: row.产品名称 || '',
    customerFeedback: row.客户反馈 || '',
  }
}
