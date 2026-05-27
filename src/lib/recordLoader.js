/** @typedef {import('../storage/adapter.js').StorageAdapter} StorageAdapter */
/** @typedef {import('../storage/adapter.js').RecordQuery} RecordQuery */

export const DEFAULT_RECORD_PAGE_SIZE = 1000

/**
 * 分页拉取直至取完
 * @param {StorageAdapter} adapter
 * @param {RecordQuery} [query]
 */
export async function fetchAllRecordPages(adapter, query = {}) {
  await adapter.init()
  const all = []
  let offset = 0
  const pageSize = query.limit ?? DEFAULT_RECORD_PAGE_SIZE
  let total = 0

  while (true) {
    const page = await adapter.listRecords({
      ...query,
      limit: pageSize,
      offset,
    })
    total = page.total
    if (!page.records.length) break
    all.push(...page.records)
    offset += page.records.length
    if (offset >= total) break
  }

  return { records: all, total }
}

/**
 * @param {StorageAdapter} adapter
 * @param {string} insightPeriodId
 */
export async function fetchRecordPagesForPeriod(adapter, insightPeriodId) {
  return fetchAllRecordPages(adapter, { insightPeriodId })
}
