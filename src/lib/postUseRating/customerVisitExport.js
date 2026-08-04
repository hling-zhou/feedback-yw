import * as XLSX from 'xlsx'

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
 * @param {Array<{
 *   id?: string
 *   importMonth?: string
 *   visitMonth?: string
 *   customerName?: string
 *   customerCode?: string
 *   productName?: string
 *   visitResult?: string
 *   internalConclusion?: string
 *   internalEvaluationDetail?: string
 * }>} visitRecords
 * @param {Array<{
 *   customerName?: string
 *   customerCode?: string
 *   productName?: string
 *   triggerType?: string
 *   lowScoreLt7Count?: number
 *   scoreBreakdown?: string
 *   quoteCount?: number
 *   reasonCount?: number
 *   latestFeedbackAt?: string
 *   channels?: string[]
 *   recommendedReason?: string
 *   quotes?: string[]
 *   reasons?: string[]
 * }>} recommendations
 */
export function buildPostUseCustomerVisitRows(visitRecords, recommendations = []) {
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
    /** @type {Record<string, string | number>} */
    const row = {
      数据月份: visit.importMonth || visit.visitMonth || '',
      客户名称: visit.customerName || '',
      客户编码: visit.customerCode || '',
      产品名称: visit.productName || '',
      建议触发类型: matched?.triggerType || '',
      '7分以下总次数': matched?.lowScoreLt7Count || 0,
      '7分以下分布': matched?.scoreBreakdown || '',
      原话命中条数: matched?.quoteCount || 0,
      低分原因命中条数: matched?.reasonCount || 0,
      最近反馈时间: matched?.latestFeedbackAt || '',
      涉及渠道: (matched?.channels || []).filter(Boolean).join('；'),
      建议回访原因: matched?.recommendedReason || '',
      回访结果: visit.visitResult || '',
      内部评估: visit.internalEvaluationDetail || visit.internalConclusion || '',
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
 * @param {Parameters<typeof buildPostUseCustomerVisitRows>[0]} visitRecords
 * @param {Parameters<typeof buildPostUseCustomerVisitRows>[1]} recommendations
 * @param {string} [scopeLabel]
 */
export function downloadPostUseCustomerVisitExcel(
  visitRecords,
  recommendations,
  scopeLabel = '当前范围',
) {
  const rows = buildPostUseCustomerVisitRows(visitRecords, recommendations)
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
