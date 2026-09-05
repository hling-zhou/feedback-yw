import { randomId } from '../randomId.js'
import { TAG_CORRECTION_DIMENSIONS } from './constants.js'
import { formatJourneyPair } from './journeyLabel.js'

/**
 * @typedef {Object} TagCorrectionEvent
 * @property {string} id
 * @property {string} recordId
 * @property {string} [productKey]
 * @property {import('./constants.js').TagCorrectionDimension} dimension
 * @property {string} systemLabel
 * @property {string} userLabel
 * @property {string} taggingText
 * @property {string} createdAt
 * @property {string} [createdBy]
 * @property {'edit' | 'replay'} origin
 */

/**
 * @param {Partial<TagCorrectionEvent> & Pick<TagCorrectionEvent, 'recordId' | 'dimension' | 'systemLabel' | 'userLabel'>} input
 * @returns {TagCorrectionEvent | null}
 */
export function createTagCorrectionEvent(input) {
  const dimension = TAG_CORRECTION_DIMENSIONS.includes(input.dimension) ? input.dimension : null
  const systemLabel = String(input.systemLabel ?? '').trim()
  const userLabel = String(input.userLabel ?? '').trim()
  if (!dimension || !input.recordId || !userLabel || systemLabel === userLabel) return null
  return {
    id: input.id || randomId(),
    recordId: String(input.recordId),
    productKey: String(input.productKey || '').trim(),
    dimension,
    systemLabel,
    userLabel,
    taggingText: String(input.taggingText || '').slice(0, 800),
    createdAt: input.createdAt || new Date().toISOString(),
    createdBy: input.createdBy,
    origin: input.origin === 'replay' ? 'replay' : 'edit',
  }
}

/**
 * @param {unknown} raw
 * @returns {TagCorrectionEvent | null}
 */
export function normalizeTagCorrectionEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Partial<TagCorrectionEvent>} */ (raw)
  return createTagCorrectionEvent({
    id: typeof o.id === 'string' ? o.id : undefined,
    recordId: o.recordId,
    productKey: o.productKey,
    dimension: o.dimension,
    systemLabel: o.systemLabel,
    userLabel: o.userLabel,
    taggingText: o.taggingText,
    createdAt: o.createdAt,
    createdBy: o.createdBy,
    origin: o.origin,
  })
}

/**
 * @param {TagCorrectionEvent} event
 */
export function correctionEventDedupeKey(event) {
  return `${event.recordId}::${event.dimension}::${event.systemLabel}::${event.userLabel}`
}

/**
 * @param {TagCorrectionEvent} event
 */
export function correctionPairKey(event) {
  const product =
    event.dimension === 'journey' ? event.productKey || '*' : '*'
  return `${event.dimension}::${product}::${event.systemLabel}::${event.userLabel}`
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function journeyLabelFromRecord(record) {
  return formatJourneyPair(record.journeyL1, record.journeyL2)
}

/**
 * @param {{ journeyL1?: string; journeyL2?: string } | null | undefined} tags
 */
export function journeyLabelFromTags(tags) {
  return formatJourneyPair(tags?.journeyL1, tags?.journeyL2)
}
