import { resolvePostUseRatingProduct } from '../productCatalog/postUseRatingProducts.js'
import {
  POST_USE_ANALYSIS_RULE_VERSION,
  POST_USE_QUALITY_SCHEMA_VERSION,
  POST_USE_REASON_RULE_VERSION,
  buildPostUseCatalogVersion,
} from './modelVersions.js'

export const META_KEY_POST_USE_QUALITY = 'post_use_period_quality_v1'

/** @param {unknown} raw */
export function normalizePostUseQualityStore(raw) {
  if (!raw || typeof raw !== 'object') return { version: 1, periods: {} }
  return { version: 1, periods: raw.periods && typeof raw.periods === 'object' ? raw.periods : {} }
}

/**
 * @param {{ importMonth: string; merged: object; catalogProducts: object[]; callbackLinkage?: object; importedAt?: string; importBatchId?: string }} input
 */
export function buildPostUsePeriodQuality(input) {
  const scored = input.merged?.scored || []
  const options = input.merged?.options || []
  const beforeDedupe = Number(input.merged?.counts?.beforeDedupe || scored.length)
  const scoped = scored.filter((r) => resolvePostUseRatingProduct(r.productName, input.catalogProducts))
  const outOfScope = scored.filter((r) => !resolvePostUseRatingProduct(r.productName, input.catalogProducts))
  const invalidScore = scored.filter((r) => !Number.isFinite(r.score) || r.score < 0 || r.score > 10)
  const missingProduct = scored.filter((r) => !String(r.productName || '').trim())
  const missingScene = scored.filter((r) => !String(r.scene || '').trim())
  const uncategorizedEvidence = [...scored, ...options].filter(
    (r) => String(r.rawComment || r.lowScoreReason || '').trim() && !String(r.lowScoreReason || '').trim(),
  )
  const anomalies = [
    ...outOfScope.map((r) => ({ type: 'out_of_scope_product', productName: r.productName || '未提供', channel: r.channel, detail: '产品未开启用后即评分析' })),
    ...invalidScore.map((r) => ({ type: 'invalid_score', productName: r.productName || '未提供', channel: r.channel, detail: `评分 ${String(r.score)}` })),
    ...missingProduct.map((r) => ({ type: 'missing_product', productName: '未提供', channel: r.channel, detail: '产品为空' })),
  ]
  return {
    schemaVersion: POST_USE_QUALITY_SCHEMA_VERSION,
    importMonth: input.importMonth,
    importBatchId: input.importBatchId || '',
    computedAt: input.importedAt || new Date().toISOString(),
    counts: {
      raw: Number(input.merged?.counts?.sourceRows ?? beforeDedupe + options.length),
      rejected: Number(input.merged?.counts?.rejected || 0),
      scoredBeforeDedupe: beforeDedupe,
      validScored: scored.length,
      duplicate: Math.max(0, beforeDedupe - scored.length),
      optionEvidence: options.length,
      analysisScoped: scoped.length,
      outOfScope: outOfScope.length,
      invalidScore: invalidScore.length,
      missingProduct: missingProduct.length,
      missingOriginalScene: missingScene.length,
      uncategorizedEvidence: uncategorizedEvidence.length,
      callbackMatched: Number(input.callbackLinkage?.matched || 0),
      callbackUnmatched: Number(input.callbackLinkage?.unmatched || 0),
    },
    versions: {
      catalog: buildPostUseCatalogVersion(input.catalogProducts),
      analysisRule: POST_USE_ANALYSIS_RULE_VERSION,
      reasonRule: POST_USE_REASON_RULE_VERSION,
    },
    anomalies,
  }
}

export async function loadPostUsePeriodQuality(adapter, month = '') {
  const store = normalizePostUseQualityStore(await adapter.getMeta(META_KEY_POST_USE_QUALITY))
  return month ? store.periods[month] || null : store
}

export async function persistPostUsePeriodQuality(adapter, snapshot) {
  const store = normalizePostUseQualityStore(await adapter.getMeta(META_KEY_POST_USE_QUALITY))
  const next = { ...store, periods: { ...store.periods, [snapshot.importMonth]: snapshot } }
  await adapter.putMeta(META_KEY_POST_USE_QUALITY, next)
  return snapshot
}

export function qualityAnomaliesToCsv(snapshot) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [
    ['异常类型', '产品', '渠道', '说明'],
    ...(snapshot?.anomalies || []).map((r) => [r.type, r.productName, r.channel, r.detail]),
  ].map((row) => row.map(escape).join(',')).join('\n')
}
