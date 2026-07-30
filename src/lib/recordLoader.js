/** @typedef {import('../storage/adapter.js').StorageAdapter} StorageAdapter */
/** @typedef {import('../storage/adapter.js').RecordQuery} RecordQuery */

export const DEFAULT_RECORD_PAGE_SIZE = 1000

/** 分页并行拉取的并发上限：首屏/全量同步在网络高延迟环境下避免逐页串行累加 RTT */
const RECORD_PAGE_CONCURRENCY = 4

/**
 * 分页拉取直至取完：先取第 1 页获得 total，剩余页并发拉取后按页序归并
 * @param {StorageAdapter} adapter
 * @param {RecordQuery} [query]
 */
export async function fetchAllRecordPages(adapter, query = {}) {
  await adapter.init()
  const pageSize = query.limit ?? DEFAULT_RECORD_PAGE_SIZE

  const first = await adapter.listRecords({ ...query, limit: pageSize, offset: 0 })
  const total = first.total ?? first.records.length
  if (!first.records.length || first.records.length >= total) {
    return { records: first.records, total }
  }

  /** @type {number[]} */
  const offsets = []
  for (let offset = first.records.length; offset < total; offset += pageSize) {
    offsets.push(offset)
  }

  /** @type {Array<import('../domain/records.js').InsightRecord[] | undefined>} */
  const pages = new Array(offsets.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < offsets.length) {
      const index = cursor
      cursor += 1
      const page = await adapter.listRecords({
        ...query,
        limit: pageSize,
        offset: offsets[index],
      })
      pages[index] = page.records
    }
  }
  const workerCount = Math.min(RECORD_PAGE_CONCURRENCY, offsets.length)
  await Promise.all(Array.from({ length: workerCount }, worker))

  const all = [...first.records]
  for (const records of pages) {
    if (records?.length) all.push(...records)
  }
  return { records: all, total }
}

/**
 * @param {StorageAdapter} adapter
 * @param {string} insightPeriodId
 * @param {{ fields?: 'list' | 'full' }} [options]
 */
export async function fetchRecordPagesForPeriod(adapter, insightPeriodId, options = {}) {
  return fetchAllRecordPages(adapter, {
    insightPeriodId,
    ...(options.fields ? { fields: options.fields } : {}),
  })
}
