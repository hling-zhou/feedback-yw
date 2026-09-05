import { buildDimensionTaggingText } from '../ticketAnalysis/dimensionTaggingText.js'
import { getTaxonomyForRecord } from '../taxonomyLoader.js'
import { tagTicketDimensions } from '../ticketAnalysis/ticketDimensionTagging.js'
import { TAG_CORRECTION_DIMENSIONS } from './constants.js'
import { createTagCorrectionEvent, journeyLabelFromRecord, journeyLabelFromTags } from './tagCorrectionEvent.js'
import { normalizeLastAutoTags } from './lastAutoTags.js'
import { labelsEqual } from './journeyLabel.js'

/**
 * @param {import('../types.js').FeedbackRecord} record
 * @param {{ skipCorrectionOverlay?: boolean }} [opts]
 */
export function classifyRecordAutoTags(record, opts = {}) {
  const taxonomy = getTaxonomyForRecord(record)
  const text =
    buildDimensionTaggingText(record) ||
    record.handlingText ||
    record.rawText ||
    ''
  return tagTicketDimensions({
    text,
    input: record,
    taxonomy,
    taxonomyKey: taxonomy.key,
    settings: { skipCorrectionOverlay: opts.skipCorrectionOverlay !== false },
  })
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function resolveSystemLabels(record) {
  const stored = normalizeLastAutoTags(record.lastAutoTags)
  if (stored && (stored.requestScene || stored.problemType || stored.journeyL1)) {
    return {
      requestScene: stored.requestScene,
      problemType: stored.problemType,
      journeyL1: stored.journeyL1,
      journeyL2: stored.journeyL2,
    }
  }
  const dims = classifyRecordAutoTags(record)
  return {
    requestScene: dims.requestScene || '',
    problemType: dims.problemType || '',
    journeyL1: dims.journeyL1 || '',
    journeyL2: dims.journeyL2 || '',
  }
}

/**
 * @param {import('../types.js').FeedbackRecord} existing
 * @param {Partial<import('../types.js').FeedbackRecord>} patch
 * @param {{ actor?: { username?: string }; origin?: 'edit' | 'replay' }} [opts]
 * @returns {import('./tagCorrectionEvent.js').TagCorrectionEvent[]}
 */
export function buildCorrectionEventsFromEdit(existing, patch, opts = {}) {
  if (!existing?.id || !patch) return []
  const system = resolveSystemLabels(existing)
  const taggingText = buildDimensionTaggingText({ ...existing, ...patch }) || existing.rawText || ''
  const createdBy = opts.actor?.username
  const origin = opts.origin || 'edit'
  const productKey = String(patch.productKey || existing.productKey || '').trim()

  /** @type {import('./tagCorrectionEvent.js').TagCorrectionEvent[]} */
  const events = []

  const nextScene = 'requestScene' in patch ? String(patch.requestScene ?? '').trim() : existing.requestScene
  if ('requestScene' in patch && !labelsEqual(existing.requestScene, nextScene) && !labelsEqual(system.requestScene, nextScene)) {
    const event = createTagCorrectionEvent({
      recordId: existing.id,
      productKey,
      dimension: 'requestScene',
      systemLabel: system.requestScene,
      userLabel: nextScene,
      taggingText,
      createdBy,
      origin,
    })
    if (event) events.push(event)
  }

  const nextType = 'problemType' in patch ? String(patch.problemType ?? '').trim() : existing.problemType
  if ('problemType' in patch && !labelsEqual(existing.problemType, nextType) && !labelsEqual(system.problemType, nextType)) {
    const event = createTagCorrectionEvent({
      recordId: existing.id,
      productKey,
      dimension: 'problemType',
      systemLabel: system.problemType,
      userLabel: nextType,
      taggingText,
      createdBy,
      origin,
    })
    if (event) events.push(event)
  }

  const nextL1 = 'journeyL1' in patch ? String(patch.journeyL1 ?? '').trim() : existing.journeyL1
  const nextL2 = 'journeyL2' in patch ? String(patch.journeyL2 ?? '').trim() : existing.journeyL2
  const journeyChanged =
    ('journeyL1' in patch && !labelsEqual(existing.journeyL1, nextL1)) ||
    ('journeyL2' in patch && !labelsEqual(existing.journeyL2, nextL2))
  if (journeyChanged) {
    const userLabel = journeyLabelFromRecord({ journeyL1: nextL1, journeyL2: nextL2 })
    const systemLabel = journeyLabelFromTags(system)
    if (!labelsEqual(systemLabel, userLabel)) {
      const event = createTagCorrectionEvent({
        recordId: existing.id,
        productKey,
        dimension: 'journey',
        systemLabel,
        userLabel,
        taggingText,
        createdBy,
        origin,
      })
      if (event) events.push(event)
    }
  }

  return events
}

export { TAG_CORRECTION_DIMENSIONS }
