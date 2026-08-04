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
 *   latestFeedbackAt?: string
 *   channels?: string[]
 *   recommendedReason?: string
 *   quotes?: string[]
 *   reasons?: string[]
 *   feedbackReasons?: string[]
 *   feedbackReasonSummary?: string
 * }>} recommendations
 */
export function buildPostUseCallbackRecommendationRows(recommendations) {
  const list = recommendations || []

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
      最近反馈时间: item.latestFeedbackAt || '',
      涉及渠道: (item.channels || []).filter(Boolean).join('；'),
      反馈原因: item.feedbackReasonSummary || '',
    }
    row.建议回访原因 = item.recommendedReason || ''
    return row
  })
}

/**
 * @param {Array<{
 *   productName?: string
 *   originalTicketId?: string
 *   score?: number
 *   customerName?: string
 *   customerCode?: string
 *   dissatisfactionReason?: string
 * }>} rows
 */
export function buildPostUseCallbackNonTenRows(rows) {
  return (rows || []).map((item) => ({
    具体投诉产品: item.productName || '',
    原工单编号: item.originalTicketId || '',
    投诉整体服务评价: item.score ?? '',
    客户名称: item.customerName || '',
    集团客户编码: item.customerCode || '',
    不满原因: item.dissatisfactionReason || '',
  }))
}

/**
 * @param {Parameters<typeof buildPostUseCallbackRecommendationRows>[0]} recommendations
 * @param {Parameters<typeof buildPostUseCallbackNonTenRows>[0]} callbackNonTenRows
 */
export function buildPostUseCallbackWorkbook(recommendations, callbackNonTenRows) {
  const recommendationRows = buildPostUseCallbackRecommendationRows(recommendations)
  const callbackRows = buildPostUseCallbackNonTenRows(callbackNonTenRows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      recommendationRows.length ? recommendationRows : [{ 提示: '当前范围内暂无官网评分类建议回访记录' }],
    ),
    '官网评分类建议回访',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      callbackRows.length ? callbackRows : [{ 提示: '当前范围内暂无投诉回访非10分记录' }],
    ),
    '投诉回访非10分',
  )
  return wb
}

/**
 * @param {Parameters<typeof buildPostUseCallbackRecommendationRows>[0]} recommendations
 * @param {Parameters<typeof buildPostUseCallbackNonTenRows>[0]} callbackNonTenRows
 * @param {string} [scopeLabel]
 */
export function downloadPostUseCallbackRecommendationsExcel(
  recommendations,
  callbackNonTenRows,
  scopeLabel = '当前范围',
) {
  const wb = buildPostUseCallbackWorkbook(recommendations, callbackNonTenRows)
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const datePart = new Date().toISOString().slice(0, 10)
  const safeScope = String(scopeLabel || '当前范围').replace(/[\\/:*?"<>|]+/g, '-')
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `建议回访-溯源清单-${safeScope}-${datePart}.xlsx`,
  )
}
