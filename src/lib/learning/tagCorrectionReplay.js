import { getManualTagFields } from '../manualTagFields.js'
import { buildCorrectionEventsFromEdit } from './tagCorrectionCapture.js'

const REPLAY_DIMENSIONS = new Set(['requestScene', 'problemType', 'journey'])

/**
 * 用当前规则重打标对照人工标签，补采历史改标事件（不改工单）。
 *
 * @param {import('../types.js').FeedbackRecord[]} records
 * @returns {import('./tagCorrectionEvent.js').TagCorrectionEvent[]}
 */
export function replayManualTagCorrections(records) {
  /** @type {import('./tagCorrectionEvent.js').TagCorrectionEvent[]} */
  const events = []
  for (const record of records || []) {
    const manual = getManualTagFields(record)
    const dims = manual.filter((d) => REPLAY_DIMENSIONS.has(d))
    if (!dims.length) continue

    /** @type {Partial<import('../types.js').FeedbackRecord>} */
    const patch = {}
    if (dims.includes('requestScene')) patch.requestScene = record.requestScene
    if (dims.includes('problemType')) patch.problemType = record.problemType
    if (dims.includes('journey')) {
      patch.journeyL1 = record.journeyL1
      patch.journeyL2 = record.journeyL2
    }

    const synthesized = {
      ...record,
      requestScene: dims.includes('requestScene') ? record.lastAutoTags?.requestScene || '' : record.requestScene,
      problemType: dims.includes('problemType') ? record.lastAutoTags?.problemType || '' : record.problemType,
      journeyL1: dims.includes('journey') ? record.lastAutoTags?.journeyL1 || '' : record.journeyL1,
      journeyL2: dims.includes('journey') ? record.lastAutoTags?.journeyL2 || '' : record.journeyL2,
    }

    events.push(...buildCorrectionEventsFromEdit(synthesized, patch, { origin: 'replay' }))
  }
  return events
}
