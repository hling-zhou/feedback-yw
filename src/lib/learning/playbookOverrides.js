import { META_KEY_PLAYBOOK_OVERRIDES } from './constants.js'

/**
 * @param {string[]} lines
 */
function uniqueLines(lines) {
  return [...new Set((lines || []).map((x) => String(x).trim()).filter(Boolean))]
}

/**
 * @param {import('../planningConfigLoader.js').PlanningPlaybookConfig | null | undefined} base
 * @param {import('../planningConfigLoader.js').PlanningPlaybookConfig | null | undefined} overlay
 */
export function mergePlaybookConfigs(base, overlay) {
  const out = {
    version: Math.max(Number(base?.version) || 0, Number(overlay?.version) || 0),
    journeys: { ...(base?.journeys || {}) },
    problemTypes: { ...(base?.problemTypes || {}) },
    products: structuredClone(base?.products || {}),
  }

  for (const [key, lines] of Object.entries(overlay?.journeys || {})) {
    out.journeys[key] = uniqueLines([...(out.journeys[key] || []), ...lines])
  }
  for (const [key, lines] of Object.entries(overlay?.problemTypes || {})) {
    out.problemTypes[key] = uniqueLines([...(out.problemTypes[key] || []), ...lines])
  }
  for (const [product, bucket] of Object.entries(overlay?.products || {})) {
    if (!out.products[product]) out.products[product] = { journeys: {}, problemTypes: {} }
    if (!out.products[product].journeys) out.products[product].journeys = {}
    if (!out.products[product].problemTypes) out.products[product].problemTypes = {}
    for (const [key, lines] of Object.entries(bucket?.journeys || {})) {
      out.products[product].journeys[key] = uniqueLines([
        ...(out.products[product].journeys[key] || []),
        ...lines,
      ])
    }
    for (const [key, lines] of Object.entries(bucket?.problemTypes || {})) {
      out.products[product].problemTypes[key] = uniqueLines([
        ...(out.products[product].problemTypes[key] || []),
        ...lines,
      ])
    }
  }
  return out
}

/**
 * @param {unknown} raw
 */
export function normalizePlaybookOverride(raw) {
  if (!raw || typeof raw !== 'object') {
    return { version: 1, journeys: {}, problemTypes: {}, products: {} }
  }
  const o = /** @type {import('../planningConfigLoader.js').PlanningPlaybookConfig} */ (raw)
  return {
    version: Number(o.version) || 1,
    journeys: o.journeys || {},
    problemTypes: o.problemTypes || {},
    products: o.products || {},
  }
}

/**
 * @param {import('../planningConfigLoader.js').PlanningPlaybookConfig} overlay
 * @param {{ product?: string; productKey?: string; journeyL2?: string; problemType?: string; text: string }} row
 */
export function mergePlaybookCandidateIntoOverlay(overlay, row) {
  const next = normalizePlaybookOverride(overlay)
  const text = String(row.text || '').trim()
  if (!text) return next
  const productKeys = [...new Set([row.productKey, row.product].map((x) => String(x || '').trim()).filter(Boolean))]
  const journeyL2 = String(row.journeyL2 || '').trim()
  const problemType = String(row.problemType || '').trim()

  if (productKeys.length) {
    for (const product of productKeys) {
    if (!next.products[product]) next.products[product] = { journeys: {}, problemTypes: {} }
    const bucket = next.products[product]
    if (!bucket.journeys) bucket.journeys = {}
    if (!bucket.problemTypes) bucket.problemTypes = {}
    if (journeyL2 && !/未知|未识别|无法识别/.test(journeyL2)) {
      bucket.journeys[journeyL2] = uniqueLines([...(bucket.journeys[journeyL2] || []), text])
    }
    if (problemType) {
      bucket.problemTypes[problemType] = uniqueLines([
        ...(bucket.problemTypes[problemType] || []),
        text,
      ])
    }
    }
  } else {
    if (journeyL2 && !/未知|未识别|无法识别/.test(journeyL2)) {
      next.journeys[journeyL2] = uniqueLines([...(next.journeys[journeyL2] || []), text])
    }
    if (problemType) {
      next.problemTypes[problemType] = uniqueLines([...(next.problemTypes[problemType] || []), text])
    }
  }
  return next
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown> }} adapter
 */
export async function loadPlaybookOverrides(adapter) {
  if (!adapter?.getMeta) return normalizePlaybookOverride(null)
  return normalizePlaybookOverride(await adapter.getMeta(META_KEY_PLAYBOOK_OVERRIDES))
}

/**
 * @param {{ putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('../planningConfigLoader.js').PlanningPlaybookConfig} overlay
 */
export async function savePlaybookOverrides(adapter, overlay) {
  const next = normalizePlaybookOverride(overlay)
  await adapter.putMeta(META_KEY_PLAYBOOK_OVERRIDES, {
    ...next,
    updatedAt: new Date().toISOString(),
  })
  return next
}
