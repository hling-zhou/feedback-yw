import { apiFetch } from './apiClient.js'
import { isImportMonthInPeriod, recordMatchesPeriod } from '../domain/insightPeriod.js'

const CHANGE_PAGE_SIZE = 1000
const RECORD_PAGE_SIZE = 500
const TICKET_TYPES = new Set(['complaint_ticket', 'consultation_ticket'])

/** Include changes that remove an already cached record or enter a loaded source and period. */
export function changeTouchesLoadedCache(change, cachedIds, ticketPeriods, postUsePeriods) {
  if (cachedIds.has(change.id)) return true
  const inLoadedPeriod = (type, month) => {
    const periods = type === 'post_use_rating'
      ? postUsePeriods
      : TICKET_TYPES.has(type) ? ticketPeriods : []
    return periods.some((period) => isImportMonthInPeriod(month, period))
  }
  return inLoadedPeriod(change.oldSourceType, change.oldImportMonth)
    || inLoadedPeriod(change.newSourceType, change.newImportMonth)
}

/** Keep the API cache limited to sources and periods the user has loaded. */
export function shouldCacheChangedRecord(record, ticketPeriods, postUsePeriods) {
  const type = record.dataSourceType || 'complaint_ticket'
  const periods = type === 'post_use_rating'
    ? postUsePeriods
    : TICKET_TYPES.has(type) ? ticketPeriods : []
  return periods.some((period) => recordMatchesPeriod(record, period))
}

/**
 * Read only compact change IDs, then fetch each changed record's latest list projection once.
 * A missing record is a deletion. The cursor is applied by the caller only after the merge succeeds.
 * @param {{ after: number; through: number; includeChange: (change: any) => boolean }} options
 */
export async function fetchRecordDelta({ after, through, includeChange }) {
  const ids = new Set()
  let cursor = after
  while (cursor < through) {
    const params = new URLSearchParams({
      after: String(cursor),
      through: String(through),
      limit: String(CHANGE_PAGE_SIZE),
    })
    const page = await apiFetch(`/api/storage/records/changes?${params}`)
    if (page.resetRequired) return { resetRequired: true, ids: [], records: [], cursor: after }
    for (const change of page.changes || []) {
      if (includeChange(change)) ids.add(change.id)
    }
    if (!Number.isSafeInteger(page.cursor) || page.cursor <= cursor) {
      throw new Error('记录变更游标未前进')
    }
    cursor = page.cursor
  }

  const selectedIds = [...ids]
  const records = []
  for (let i = 0; i < selectedIds.length; i += RECORD_PAGE_SIZE) {
    const batch = selectedIds.slice(i, i + RECORD_PAGE_SIZE)
    const result = await apiFetch('/api/storage/records/by-ids', {
      method: 'POST',
      body: JSON.stringify({ ids: batch, fields: 'list' }),
    })
    records.push(...(result.records || []))
  }
  return { resetRequired: false, ids: selectedIds, records, cursor }
}

/**
 * @template {{ id: string }} T
 * @param {T[]} current
 * @param {string[]} changedIds
 * @param {T[]} fresh
 * @param {(record: T) => boolean} shouldCache
 */
export function mergeRecordDelta(current, changedIds, fresh, shouldCache) {
  if (!changedIds.length) return current
  const changed = new Set(changedIds)
  /** @type {Map<string, T>} */
  const replacements = new Map()
  for (const record of fresh) {
    if (shouldCache(record)) replacements.set(record.id, record)
  }
  /** @type {T[]} */
  const merged = []
  for (const record of current) {
    if (!changed.has(record.id)) {
      merged.push(record)
      continue
    }
    const replacement = replacements.get(record.id)
    if (replacement) {
      merged.push(replacement)
      replacements.delete(record.id)
    }
  }
  return [...merged, ...replacements.values()]
}
