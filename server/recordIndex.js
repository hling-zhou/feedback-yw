import { normalizeInsightPeriod } from '../src/domain/insightPeriod.js'

/**
 * @param {import('../src/domain/records.js').InsightRecord} record
 */
export function recordIndexFields(record) {
  const importMonth =
    record?.importMonth && /^\d{4}-\d{2}/.test(String(record.importMonth))
      ? String(record.importMonth).slice(0, 7)
      : record?.createdAt?.slice(0, 7) || ''
  const ticketId = typeof record?.ticketId === 'string' ? record.ticketId.trim() : ''
  return {
    importMonth,
    dataSourceType: record?.dataSourceType || 'complaint_ticket',
    tenantId: record?.tenantId || 'local',
    importBatchId: record?.importBatchId || '',
    /** 空工单号存 NULL：唯一索引下多行 NULL 互不冲突 */
    ticketId: ticketId || null,
  }
}

/**
 * @param {import('../domain/insightPeriod.js').InsightPeriod} period
 */
export function importMonthRangeForPeriod(period) {
  const p = normalizeInsightPeriod(period)
  return {
    startMonth: p.startDate.slice(0, 7),
    endMonth: p.endDate.slice(0, 7),
  }
}

/**
 * @param {import('./storageRepository.js').RecordQuery} query
 * @param {import('../src/domain/insightPeriod.js').InsightPeriod | null} period
 */
export function buildRecordsWhereClause(query, period) {
  /** @type {string[]} */
  const parts = ['1=1']
  /** @type {unknown[]} */
  const params = []

  if (query.tenantId) {
    parts.push('tenant_id = ?')
    params.push(query.tenantId)
  }
  if (query.dataSourceType) {
    parts.push('data_source_type = ?')
    params.push(query.dataSourceType)
  }
  if (query.importBatchId) {
    parts.push('import_batch_id = ?')
    params.push(query.importBatchId)
  }
  if (period) {
    const { startMonth, endMonth } = importMonthRangeForPeriod(period)
    parts.push('import_month >= ? AND import_month <= ?')
    params.push(startMonth, endMonth)
  }

  return { where: parts.join(' AND '), params }
}

/**
 * @param {Record<string, string>} query
 */
export function parseRecordPagination(query) {
  const MAX = 5000
  const DEFAULT = 1000
  if (query.limit == null || query.limit === '') {
    return { limit: null, offset: 0 }
  }
  let limit = Number(query.limit)
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT
  limit = Math.min(Math.floor(limit), MAX)
  let offset = Number(query.offset ?? 0)
  if (!Number.isFinite(offset) || offset < 0) offset = 0
  return { limit, offset: Math.floor(offset) }
}
