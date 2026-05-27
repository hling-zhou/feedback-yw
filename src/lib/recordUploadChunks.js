/** 单批 JSON 体积上限（需小于服务端 API_BODY_LIMIT_BYTES） */
export const RECORD_UPLOAD_MAX_BYTES = 2 * 1024 * 1024

/** 每批最多条数（咨询单 1000+ 时控制请求次数） */
export const RECORD_UPLOAD_MAX_COUNT = 80

/** 至少凑满条数再按体积切分，避免碎批过多 */
export const RECORD_UPLOAD_MIN_COUNT = 15

/**
 * @param {unknown} record
 */
function recordJsonByteLength(record) {
  return new TextEncoder().encode(JSON.stringify(record)).length
}

/**
 * 按体积与条数切分，适配咨询单/投诉单长文本（1000+ 条）。
 * @template T
 * @param {T[]} records
 * @param {{ maxBytes?: number; maxCount?: number; minCount?: number }} [options]
 * @returns {T[][]}
 */
export function chunkRecordsForUpload(records, options = {}) {
  if (!records.length) return []

  const maxBytes = options.maxBytes ?? RECORD_UPLOAD_MAX_BYTES
  const maxCount = options.maxCount ?? RECORD_UPLOAD_MAX_COUNT
  const minCount = Math.max(1, options.minCount ?? RECORD_UPLOAD_MIN_COUNT)

  /** @type {T[][]} */
  const chunks = []
  /** @type {T[]} */
  let current = []
  let currentBytes = 2

  const flush = () => {
    if (current.length) {
      chunks.push(current)
      current = []
      currentBytes = 2
    }
  }

  for (const record of records) {
    const recordBytes = recordJsonByteLength(record) + 1
    const wouldExceedBytes =
      current.length >= minCount && currentBytes + recordBytes > maxBytes
    const wouldExceedCount = current.length >= maxCount

    if (current.length && (wouldExceedBytes || wouldExceedCount)) {
      flush()
    }

    if (recordBytes + 2 > maxBytes && !current.length) {
      chunks.push([record])
      continue
    }

    current.push(record)
    currentBytes += recordBytes
  }

  flush()
  return chunks
}
