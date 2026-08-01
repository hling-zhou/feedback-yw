import { buildPostUseInsightBundle } from './insights.js'

export const META_KEY_POST_USE_INSIGHTS = 'post_use_insight_bundle_v1'

export async function loadPostUseInsightBundle(adapter, periodKey) {
  const raw = await adapter.getMeta(META_KEY_POST_USE_INSIGHTS)
  return raw?.periods?.[periodKey] || null
}

export async function recomputePostUseInsightBundle(adapter, periodKey, records, options = {}) {
  const bundle = buildPostUseInsightBundle(records, options)
  const raw = await adapter.getMeta(META_KEY_POST_USE_INSIGHTS)
  const store = raw && typeof raw === 'object' ? raw : { version: 1, periods: {} }
  await adapter.putMeta(META_KEY_POST_USE_INSIGHTS, {
    ...store,
    version: 1,
    periods: { ...(store.periods || {}), [periodKey]: bundle },
  })
  return bundle
}
