/** @param {object[]} records */
function isOptionScoreRecord(record) {
  const channel = String(record?.channel || '').trim()
  const sourceSubType = String(record?.sourceSubType || '').trim()
  return channel === 'option' || sourceSubType === 'web_option'
}

/** 用后即评可计分明细：排除官网选项题，并归一渠道。 */
export function postUseRecordsToScoredRows(records) {
  return (records || [])
    .filter((record) => record.dataSourceType === 'post_use_rating' && record.ratingScore != null)
    .filter((record) => !isOptionScoreRecord(record))
    .map((record) => ({
      id: record.id,
      channel: record.channel || (record.sourceSubType === 'sms_survey' ? 'sms' : record.sourceSubType === 'satisfaction_callback' ? 'callback' : 'console'),
      productName: record.productName || record.product || '',
      score: Number(record.ratingScore),
      customerName: record.customerName || '',
      customerCode: record.customerCode || '',
      answeredAt: record.createdAt || '',
      originalTicketId: record.originalTicketId || '',
      lowScoreReason: record.lowScoreReason || '',
    }))
    .filter((row) => Number.isFinite(row.score) && row.productName)
}
