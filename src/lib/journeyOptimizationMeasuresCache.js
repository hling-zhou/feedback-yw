import { segmentCacheKey } from './journeyOptimizationLLM.js'
import {
  computeJourneyMeasuresFingerprint,
  computeJourneyMeasuresFingerprintFromRecords,
} from './ticketAnalysis/ticketAnalysisVersion.js'

export { computeJourneyMeasuresFingerprint, computeJourneyMeasuresFingerprintFromRecords }

/**
 * @deprecated Phase 1C 起旅程 Tab 不再缓存 LLM 旅程举措；保留供 legacy 路径。
 * 预计 1~2 个稳定周期后评估移除。
 */
const BUNDLE_PREFIX = 'feedback-insights:journey-measures:'

/** @typedef {{ text: string; source: string }[]} JourneyMeasureList */
/** @typedef {{ fingerprint: string; segments: Record<string, JourneyMeasureList> }} JourneyMeasuresBundle */

/**
 * @param {string} periodId
 * @param {string} [productName]
 */
export function buildJourneyMeasuresScopeKey(periodId, productName) {
  const period = (periodId || '').trim()
  const product = (productName || '').trim() || '_'
  return `${period}::${product}`
}

/**
 * @param {string} scopeKey
 * @returns {JourneyMeasuresBundle}
 */
export function loadJourneyMeasuresBundle(scopeKey) {
  if (!scopeKey || typeof sessionStorage === 'undefined') {
    return { fingerprint: '', segments: {} }
  }
  try {
    const raw = sessionStorage.getItem(BUNDLE_PREFIX + scopeKey)
    if (!raw) return { fingerprint: '', segments: {} }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { fingerprint: '', segments: {} }
    return {
      fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : '',
      segments:
        parsed.segments && typeof parsed.segments === 'object' ? parsed.segments : {},
    }
  } catch {
    return { fingerprint: '', segments: {} }
  }
}

/**
 * @param {string} scopeKey
 * @param {JourneyMeasuresBundle} bundle
 */
export function saveJourneyMeasuresBundle(scopeKey, bundle) {
  if (!scopeKey || typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(BUNDLE_PREFIX + scopeKey, JSON.stringify(bundle))
}

/**
 * @param {string} scopeKey
 * @param {string} fingerprint
 */
export function isJourneyMeasuresScopeReady(scopeKey, fingerprint) {
  if (!scopeKey || !fingerprint) return false
  const bundle = loadJourneyMeasuresBundle(scopeKey)
  return bundle.fingerprint === fingerprint && Object.keys(bundle.segments).length > 0
}

/**
 * @param {string} scopeKey
 * @param {string} l1
 * @param {string} l2
 * @param {string[]} itemIds
 * @returns {JourneyMeasureList | null}
 */
export function getSegmentMeasuresFromBundle(scopeKey, l1, l2, itemIds) {
  const bundle = loadJourneyMeasuresBundle(scopeKey)
  const sk = segmentCacheKey(l1, l2, itemIds)
  const list = bundle.segments[sk]
  return Array.isArray(list) && list.length ? list : null
}

/**
 * @param {string} scopeKey
 * @param {string} fingerprint
 * @param {string} l1
 * @param {string} l2
 * @param {string[]} itemIds
 * @param {JourneyMeasureList} measures
 */
export function setSegmentMeasuresInBundle(scopeKey, fingerprint, l1, l2, itemIds, measures) {
  const bundle = loadJourneyMeasuresBundle(scopeKey)
  bundle.fingerprint = fingerprint || bundle.fingerprint
  bundle.segments[segmentCacheKey(l1, l2, itemIds)] = measures
  saveJourneyMeasuresBundle(scopeKey, bundle)
}
