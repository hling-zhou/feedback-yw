import { META_KEY_TAG_CORRECTION_RULES } from './constants.js'
import { parseJourneyPair } from './journeyLabel.js'

/**
 * @typedef {Object} TagCorrectionRule
 * @property {string} id
 * @property {import('./constants.js').TagCorrectionDimension} dimension
 * @property {string} [productKey]
 * @property {string} fromLabel
 * @property {string} toLabel
 * @property {string[]} keywords
 * @property {number} evidenceCount
 * @property {number} [distinctMonths]
 * @property {{ recordId: string; taggingText: string }[]} [samples]
 * @property {import('./constants.js').TagCorrectionRuleStatus} status
 * @property {string} [reviewNote]
 * @property {string} [reviewedAt]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

/** @type {TagCorrectionRule[]} */
let rulesCache = []

export function setCorrectionRulesCache(rules) {
  rulesCache = Array.isArray(rules) ? rules : []
}

export function getCorrectionRulesCache() {
  return rulesCache
}

export function getActiveCorrectionRules() {
  return rulesCache.filter((r) => r.status === 'approved' || r.status === 'needs_tree_patch')
}

/**
 * @param {unknown} raw
 * @returns {TagCorrectionRule[]}
 */
export function normalizeCorrectionRules(raw) {
  const list = Array.isArray(raw) ? raw : raw?.rules
  if (!Array.isArray(list)) return []
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const o = /** @type {Partial<TagCorrectionRule>} */ (item)
      if (!o.id || !o.dimension || !o.toLabel) return null
      return {
        id: String(o.id),
        dimension: o.dimension,
        productKey: String(o.productKey || '').trim(),
        fromLabel: String(o.fromLabel || '').trim(),
        toLabel: String(o.toLabel || '').trim(),
        keywords: Array.isArray(o.keywords) ? o.keywords.map((k) => String(k).trim()).filter(Boolean) : [],
        evidenceCount: Number(o.evidenceCount) || 0,
        distinctMonths: Number(o.distinctMonths) || 0,
        samples: Array.isArray(o.samples) ? o.samples : [],
        status: o.status || 'pending',
        reviewNote: o.reviewNote,
        reviewedAt: o.reviewedAt,
        createdAt: o.createdAt || new Date().toISOString(),
        updatedAt: o.updatedAt,
      }
    })
    .filter(Boolean)
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown> }} adapter
 */
export async function loadCorrectionRules(adapter) {
  if (!adapter?.getMeta) return []
  const rules = normalizeCorrectionRules(await adapter.getMeta(META_KEY_TAG_CORRECTION_RULES))
  setCorrectionRulesCache(rules)
  return rules
}

/**
 * @param {{ putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {TagCorrectionRule[]} rules
 */
export async function saveCorrectionRules(adapter, rules) {
  const next = normalizeCorrectionRules(rules)
  setCorrectionRulesCache(next)
  await adapter.putMeta(META_KEY_TAG_CORRECTION_RULES, {
    version: 1,
    rules: next,
    updatedAt: new Date().toISOString(),
  })
  return next
}

/**
 * @param {TagCorrectionRule} rule
 */
export function correctionRulePairKey(rule) {
  const product = rule.dimension === 'journey' ? rule.productKey || '*' : '*'
  return `${rule.dimension}::${product}::${rule.fromLabel}::${rule.toLabel}`
}

/**
 * @param {string} text
 * @param {string[]} keywords
 */
export function keywordsHitText(text, keywords) {
  const hay = String(text || '').toLowerCase()
  if (!hay || !keywords?.length) return false
  return keywords.some((kw) => {
    const needle = String(kw || '').trim().toLowerCase()
    return needle.length >= 2 && hay.includes(needle)
  })
}

/**
 * @param {{ requestScene: string; problemType: string; journeyL1: string; journeyL2: string }} dims
 * @param {string} text
 * @param {{ productKey?: string; rules?: TagCorrectionRule[] }} [opts]
 */
export function applyCorrectionOverlay(dims, text, opts = {}) {
  const rules = (opts.rules || getActiveCorrectionRules()).filter(
    (r) => r.dimension === 'requestScene' || r.dimension === 'problemType',
  )
  if (!rules.length) return { ...dims, overlayHits: [] }

  const productKey = String(opts.productKey || '').trim()
  const next = { ...dims }
  /** @type {string[]} */
  const overlayHits = []

  for (const rule of rules) {
    if (rule.productKey && rule.productKey !== productKey) continue
    if (!keywordsHitText(text, rule.keywords)) continue
    if (rule.dimension === 'requestScene') {
      next.requestScene = rule.toLabel
      overlayHits.push('requestScene')
    }
    if (rule.dimension === 'problemType') {
      next.problemType = rule.toLabel
      overlayHits.push('problemType')
    }
  }

  return { ...next, overlayHits }
}

/**
 * @param {TagCorrectionRule} rule
 */
export function journeyTargetFromRule(rule) {
  return parseJourneyPair(rule.toLabel)
}
