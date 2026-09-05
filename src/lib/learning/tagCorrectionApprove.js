import { getOrInitManagedSnapshot, saveManagedTaxonomy } from '../tagLibrary/taxonomyManagedStore.js'
import { parseJourneyPair } from './journeyLabel.js'
import { correctionRulePairKey, saveCorrectionRules } from './tagCorrectionRules.js'

/**
 * @param {import('../tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @param {import('./tagCorrectionRules.js').TagCorrectionRule} rule
 */
export function mergeCorrectionKeywordsIntoSnapshot(snapshot, rule) {
  const keywords = (rule.keywords || []).map((k) => String(k).trim()).filter(Boolean)
  if (!keywords.length) return snapshot

  const merge = (list, label) => {
    const row = (list || []).find((item) => item.label === label)
    if (!row) return
    const next = new Set([...(row.keywords || []), ...keywords])
    row.keywords = [...next]
  }

  if (rule.dimension === 'requestScene') {
    merge(snapshot.sharedRequestScenes, rule.toLabel)
  }
  if (rule.dimension === 'problemType') {
    merge(snapshot.sharedProblemTypes, rule.toLabel)
  }
  if (rule.dimension === 'journey') {
    const { journeyL1, journeyL2 } = parseJourneyPair(rule.toLabel)
    const productKey = rule.productKey || 'generic'
    const tax = snapshot.products?.[productKey]
    const l1 = tax?.journeys?.find((j) => j.label === journeyL1)
    const l2 = l1?.children?.find((c) => c.label === journeyL2)
    if (l2) {
      const next = new Set([...(l2.keywords || []), ...keywords])
      l2.keywords = [...next]
    }
  }
  snapshot.updatedAt = new Date().toISOString()
  return snapshot
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('./tagCorrectionRules.js').TagCorrectionRule[]} rules
 * @param {import('./tagCorrectionRules.js').TagCorrectionRule} candidate
 * @param {{ status?: import('./constants.js').TagCorrectionRuleStatus; keywords?: string[]; reviewNote?: string }} [patch]
 */
export async function upsertCorrectionRule(adapter, rules, candidate, patch = {}) {
  const nextStatus = patch.status || candidate.status || 'pending'
  const keywords = patch.keywords || candidate.keywords || []
  const now = new Date().toISOString()
  const pair = correctionRulePairKey({ ...candidate, keywords })
  const existing = rules.find((r) => correctionRulePairKey(r) === pair)
  const updated = {
    ...candidate,
    ...existing,
    ...patch,
    keywords,
    status: nextStatus,
    reviewNote: patch.reviewNote ?? existing?.reviewNote ?? candidate.reviewNote,
    reviewedAt: nextStatus === 'pending' ? existing?.reviewedAt : now,
    updatedAt: now,
    createdAt: existing?.createdAt || candidate.createdAt || now,
    id: existing?.id || candidate.id,
  }
  const nextRules = existing
    ? rules.map((r) => (r.id === existing.id ? updated : r))
    : [...rules, updated]

  if (nextStatus === 'approved' || nextStatus === 'needs_tree_patch') {
    const snapshot = structuredClone(await getOrInitManagedSnapshot(adapter))
    mergeCorrectionKeywordsIntoSnapshot(snapshot, updated)
    snapshot.tagLibraryVersion = `taxonomy-managed-${Date.now()}`
    await saveManagedTaxonomy(adapter, snapshot)
  }

  await saveCorrectionRules(adapter, nextRules)
  return { rule: updated, rules: nextRules }
}
