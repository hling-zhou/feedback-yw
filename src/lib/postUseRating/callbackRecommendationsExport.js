import * as XLSX from 'xlsx'

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {Array<{
 *   importMonths?: string[]
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
export function buildPostUseCallbackRecommendationRows(recommendations) {
  const list = recommendations || []
  const maxQuotes = Math.max(0, ...list.map((item) => item.quotes?.length || 0))
  const maxReasons = Math.max(0, ...list.map((item) => item.reasons?.length || 0))

  return list.map((item) => {
    /** @type {Record<string, string | number>} */
    const row = {
      数据月份: (item.importMonths || []).filter(Boolean).join('、'),
      客户名称: item.customerName || '',
      客户编码: item.customerCode || '',
      产品名称: item.productName || '',
      建议触发类型: item.triggerType || '',
      '7分以下总次数': item.lowScoreLt7Count || 0,
      '7分以下分布': item.scoreBreakdown || '',
      原话命中条数: item.quoteCount || 0,
      低分原因命中条数: item.reasonCount || 0,
      最近反馈时间: item.latestFeedbackAt || '',
      涉及渠道: (item.channels || []).filter(Boolean).join('；'),
      建议回访原因: item.recommendedReason || '',
    }
    for (let i = 0; i < maxQuotes; i += 1) {
      row[`客户原话${i + 1}`] = item.quotes?.[i] || ''
    }
    for (let i = 0; i < maxReasons; i += 1) {
      row[`低分原因${i + 1}`] = item.reasons?.[i] || ''
    }
    return row
  })
}

/**
 * @param {Parameters<typeof buildPostUseCallbackRecommendationRows>[0]} recommendations
 * @param {string} [scopeLabel]
 */
export function downloadPostUseCallbackRecommendationsExcel(
  recommendations,
  scopeLabel = '当前范围',
) {
  const rows = buildPostUseCallbackRecommendationRows(recommendations)
  const sheet = XLSX.utils.json_to_sheet(
    rows.length ? rows : [{ 提示: '当前范围内暂无建议客服部回访客户' }],
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, '建议客服部回访客户清单')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const datePart = new Date().toISOString().slice(0, 10)
  const safeScope = String(scopeLabel || '当前范围').replace(/[\\/:*?"<>|]+/g, '-')
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `建议客服部回访客户清单-${safeScope}-${datePart}.xlsx`,
  )
}
