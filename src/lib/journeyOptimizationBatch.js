import { buildJourneyInsights } from './journeyInsights.js'
import { generateMeasuresForSegment, segmentCacheKey } from './journeyOptimizationLLM.js'
import {
  buildJourneyMeasuresScopeKey,
  computeJourneyMeasuresFingerprint,
  isJourneyMeasuresScopeReady,
  loadJourneyMeasuresBundle,
  saveJourneyMeasuresBundle,
} from './journeyOptimizationMeasuresCache.js'
import { canUseSemanticMatch } from './themeSemantic.js'

/**
 * 为洞察周期 + 产品范围批量生成各旅程环节的 AI 举措（每个周期仅一次，直至工单集合变化）。
 *
 * @param {Object} params
 * @param {string} params.periodId
 * @param {string} [params.productName]
 * @param {import('./types.js').FeedbackRecord[]} params.items
 * @param {{ journeys: import('./productTaxonomy.js').JourneyL1[]; name?: string }} params.taxonomy
 * @param {import('./storage.js').AppSettings} params.settings
 * @param {(message: string) => void} [params.onProgress]
 */
export async function ensureJourneyMeasuresForScope({
  periodId,
  productName,
  items,
  taxonomy,
  settings,
  onProgress,
}) {
  if (settings?.optimizationMode !== 'llm') {
    return { ok: false, skipped: true, reason: 'rules-mode' }
  }
  if (!canUseSemanticMatch(settings)) {
    return { ok: false, skipped: true, reason: 'no-llm' }
  }
  if (!periodId?.trim() || !items.length) {
    return { ok: false, skipped: true, reason: 'empty' }
  }

  const scopeKey = buildJourneyMeasuresScopeKey(periodId, productName)
  const fingerprint = computeJourneyMeasuresFingerprint(items.map((f) => f.id))

  if (isJourneyMeasuresScopeReady(scopeKey, fingerprint)) {
    return {
      ok: true,
      skipped: true,
      scopeKey,
      fingerprint,
      bundle: loadJourneyMeasuresBundle(scopeKey),
    }
  }

  const stages = buildJourneyInsights(items, taxonomy.journeys)
  /** @type {import('./journeyOptimizationMeasuresCache.js').JourneyMeasuresBundle} */
  const bundle = { fingerprint, segments: {} }
  const meta = { productName: productName || taxonomy.name }

  for (const stage of stages) {
    const l1Def = taxonomy.journeys.find((j) => j.label === stage.l1)
    /** @type {Record<string, { text: string; source: string }[]>} */
    const childMeasuresByL2 = {}

    for (const child of stage.children) {
      const childItems = items.filter(
        (fb) => fb.journeyL1 === stage.l1 && fb.journeyL2 === child.l2,
      )
      if (!childItems.length) continue
      const childIds = childItems.map((f) => f.id)
      onProgress?.(`正在生成「${stage.l1} / ${child.l2}」举措…`)
      const childMeasures = await generateMeasuresForSegment(
        `${scopeKey}::${stage.l1}::${child.l2}`,
        childItems,
        stage.l1,
        child.l2,
        {
          ...meta,
          l1Desc: l1Def?.description,
          l2Desc: child.description,
        },
        settings,
      )
      bundle.segments[segmentCacheKey(stage.l1, child.l2, childIds)] = childMeasures
      childMeasuresByL2[child.l2] = childMeasures
    }

    const l1Items = items.filter((fb) => fb.journeyL1 === stage.l1)
    if (!l1Items.length) continue
    const l1Ids = l1Items.map((f) => f.id)
    const l1Sk = segmentCacheKey(stage.l1, '', l1Ids)
    onProgress?.(`正在归纳「${stage.l1}」一级总领举措…`)
    bundle.segments[l1Sk] = await generateMeasuresForSegment(
      `${scopeKey}::${stage.l1}::`,
      l1Items,
      stage.l1,
      '',
      { ...meta, l1Desc: l1Def?.description },
      settings,
      { childMeasuresByL2 },
    )
  }

  saveJourneyMeasuresBundle(scopeKey, bundle)
  return { ok: true, skipped: false, scopeKey, fingerprint, bundle }
}
