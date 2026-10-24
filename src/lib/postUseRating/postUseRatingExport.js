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
 * 渠道 + sourceSubType → 中文标签映射。
 * @param {{ channel?: string; sourceSubType?: string }} record
 * @returns {string}
 */
function channelLabel(record) {
  const ch = String(record?.channel || '').trim()
  const sub = String(record?.sourceSubType || '').trim()
  const CHANNEL_MAP = {
    sms: '短信',
    web: '官网',
    app: 'APP',
    email: '邮件',
    phone: '电话',
  }
  const chLabel = CHANNEL_MAP[ch] || ch
  if (sub && sub !== ch) return `${chLabel}（${sub}）`
  return chLabel || ''
}

/**
 * 用后即评原始数据导出行构建（8 列专用列集，不走 Field Registry 通用列）。
 *
 * @param {Array<Record<string, *>>} records
 * @returns {Record<string, string | number>[]}
 */
export function buildPostUseRatingExportRows(records = []) {
  return records.map((record) => ({
    数据月份: String(record.importMonth || ''),
    产品名称: String(record.product || record.productName || ''),
    评价时间: String(record.createdAt || ''),
    渠道: channelLabel(record),
    评分: record.ratingScore != null ? record.ratingScore : '',
    客户名称: String(record.customerName || ''),
    客户编码: String(record.customerCode || ''),
    评价原文: String(record.commentText || record.rawText || ''),
  }))
}

/**
 * 下载用后即评原始数据 Excel（单 sheet）。
 *
 * @param {Array<Record<string, *>>} records
 * @param {string} [scopeLabel]
 */
export function downloadPostUseRatingExcel(records, scopeLabel = '当前范围') {
  const rows = buildPostUseRatingExportRows(records)
  const sheet = XLSX.utils.json_to_sheet(
    rows.length ? rows : [{ 提示: '当前范围内暂无用后即评数据' }],
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, '用后即评')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const datePart = new Date().toISOString().slice(0, 10)
  const safeScope = String(scopeLabel || '当前范围').replace(/[\\/:*?"<>|]+/g, '-')
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `用后即评-${safeScope}-${datePart}.xlsx`,
  )
}
