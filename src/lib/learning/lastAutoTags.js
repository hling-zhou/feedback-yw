/**
 * @typedef {Object} LastAutoTags
 * @property {string} requestScene
 * @property {string} problemType
 * @property {string} journeyL1
 * @property {string} journeyL2
 * @property {string} [taggedAt]
 * @property {string[]} [overlayHits]
 */

/**
 * @param {Partial<import('../types.js').FeedbackRecord> | null | undefined} record
 * @param {Partial<LastAutoTags>} [dims]
 * @returns {LastAutoTags}
 */
export function snapshotLastAutoTags(record, dims = {}) {
  const prev = record?.lastAutoTags && typeof record.lastAutoTags === 'object' ? record.lastAutoTags : {}
  return {
    requestScene: String(dims.requestScene ?? record?.requestScene ?? prev.requestScene ?? '').trim(),
    problemType: String(dims.problemType ?? record?.problemType ?? prev.problemType ?? '').trim(),
    journeyL1: String(dims.journeyL1 ?? record?.journeyL1 ?? prev.journeyL1 ?? '').trim(),
    journeyL2: String(dims.journeyL2 ?? record?.journeyL2 ?? prev.journeyL2 ?? '').trim(),
    taggedAt: new Date().toISOString(),
    overlayHits: Array.isArray(dims.overlayHits)
      ? dims.overlayHits
      : Array.isArray(prev.overlayHits)
        ? prev.overlayHits
        : [],
  }
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 * @param {Partial<LastAutoTags>} [dims]
 */
export function attachLastAutoTags(record, dims) {
  return {
    ...record,
    lastAutoTags: snapshotLastAutoTags(record, dims),
  }
}

/**
 * @param {unknown} raw
 * @returns {LastAutoTags | null}
 */
export function normalizeLastAutoTags(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  return {
    requestScene: String(o.requestScene ?? '').trim(),
    problemType: String(o.problemType ?? '').trim(),
    journeyL1: String(o.journeyL1 ?? '').trim(),
    journeyL2: String(o.journeyL2 ?? '').trim(),
    taggedAt: typeof o.taggedAt === 'string' ? o.taggedAt : undefined,
    overlayHits: Array.isArray(o.overlayHits) ? o.overlayHits.map(String) : [],
  }
}
