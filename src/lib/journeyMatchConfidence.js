import { DEFAULT_THEME_MATCH_MODE, DEFAULT_JOURNEY_LLM_SKIP_SCORE_THRESHOLD } from './storage.js'
import { matchJourneyByDescription, matchJourneyFromTextWithScore, JOURNEY_UNKNOWN_L1 } from './ticketTagging.js'
import { catalogHasJourneyOptions, isValidJourneyPair, journeysForKey } from './journeySemantic.js'

/**
 * @typedef {'high_confidence' | 'unknown' | 'invalid_catalog' | 'empty_catalog' | 'forced_semantic' | 'gating_disabled' | 'low_confidence' | 'manual_override'} JourneyGatingReason
 */

/**
 * @typedef {Object} JourneyGatingDecision
 * @property {{ journeyL1: string; journeyL2: string }} local
 * @property {number} score
 * @property {boolean} skipLlm
 * @property {JourneyGatingReason} reason
 */

/**
 * @param {import('./storage.js').AppSettings} [settings]
 */
export function journeyMatchOpts(settings) {
  return { useRequestNode: settings?.useRequestNodeForJourney === true }
}

/**
 * @param {import('./storage.js').AppSettings} [settings]
 */
export function resolveJourneyLlmSkipScoreThreshold(settings) {
  const n = Number(settings?.journeyLlmSkipScoreThreshold)
  if (Number.isFinite(n) && n >= 1) return Math.floor(n)
  return DEFAULT_JOURNEY_LLM_SKIP_SCORE_THRESHOLD
}

/**
 * @param {import('./storage.js').AppSettings} [settings]
 */
export function isJourneyLlmGatingEnabled(settings) {
  if (settings?.journeyLlmGating === false) return false
  const mode = settings?.themeMatchMode || DEFAULT_THEME_MATCH_MODE
  if (mode === 'semantic') return false
  return true
}

/**
 * @param {{ journeyL1?: string; journeyL2?: string }} local
 */
function isUnknownJourneyLocal(local) {
  const l1 = (local?.journeyL1 || '').trim()
  return !l1 || l1 === JOURNEY_UNKNOWN_L1
}

/**
 * @param {string} text
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {string} taxonomyKey
 * @param {import('./storage.js').AppSettings} [settings]
 * @param {{ journeyL1: string; journeyL2: string }} [localHint]
 * @param {{ manualTagDimensions?: string[] }} [record]
 * @returns {JourneyGatingDecision}
 */
export function evaluateJourneyGating(
  text,
  journeys,
  taxonomyKey,
  settings,
  localHint,
  record,
) {
  const local =
    localHint ??
    matchJourneyByDescription(text, journeys, taxonomyKey, journeyMatchOpts(settings))
  const { score } = matchJourneyFromTextWithScore(text, journeys, taxonomyKey)

  if (record?.manualTagDimensions?.includes('journey')) {
    return { local, score, skipLlm: true, reason: 'manual_override' }
  }

  if (!isJourneyLlmGatingEnabled(settings)) {
    return {
      local,
      score,
      skipLlm: false,
      reason: settings?.themeMatchMode === 'semantic' ? 'forced_semantic' : 'gating_disabled',
    }
  }

  if (!catalogHasJourneyOptions(journeys)) {
    return { local, score, skipLlm: false, reason: 'empty_catalog' }
  }

  if (isUnknownJourneyLocal(local) || !isValidJourneyPair(local.journeyL1, local.journeyL2, journeys)) {
    return {
      local,
      score,
      skipLlm: false,
      reason: isUnknownJourneyLocal(local) ? 'unknown' : 'invalid_catalog',
    }
  }

  const threshold = resolveJourneyLlmSkipScoreThreshold(settings)
  if (score >= threshold) {
    return { local, score, skipLlm: true, reason: 'high_confidence' }
  }

  return { local, score, skipLlm: false, reason: 'low_confidence' }
}

/**
 * @param {string[]} texts
 * @param {string[]} taxonomyKeys
 * @param {import('./storage.js').AppSettings} settings
 * @param {{ journeyL1: string; journeyL2: string }[]} [localResults]
 * @param {import('./types.js').FeedbackRecord[]} [records]
 * @returns {number[]}
 */
export function filterIndicesNeedingJourneyLlm(
  texts,
  taxonomyKeys,
  settings,
  localResults,
  records,
) {
  /** @type {number[]} */
  const indices = []
  for (let i = 0; i < texts.length; i++) {
    const key = taxonomyKeys[i] || 'generic'
    const journeys = journeysForKey(key)
    const decision = evaluateJourneyGating(
      texts[i],
      journeys,
      key,
      settings,
      localResults?.[i],
      records?.[i],
    )
    if (!decision.skipLlm) indices.push(i)
  }
  return indices
}

/**
 * @param {string[]} texts
 * @param {string[]} taxonomyKeys
 * @param {import('./storage.js').AppSettings} settings
 * @param {{ journeyL1: string; journeyL2: string }[]} localResults
 * @param {import('./types.js').FeedbackRecord[]} [records]
 * @returns {JourneyGatingDecision[]}
 */
export function evaluateJourneyGatingBatch(texts, taxonomyKeys, settings, localResults, records) {
  return texts.map((text, i) => {
    const key = taxonomyKeys[i] || 'generic'
    return evaluateJourneyGating(
      text,
      journeysForKey(key),
      key,
      settings,
      localResults[i],
      records?.[i],
    )
  })
}
