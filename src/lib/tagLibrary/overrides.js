const META_KEY_OVERRIDES = 'taxonomy_overrides'
const META_KEY_TAG_VERSION = 'tag_library_version'

/**
 * @typedef {Object} TaxonomyOverrides
 * @property {string} tagLibraryVersion
 * @property {{ label: string; keywords: string[] }[]} [problemTypes]
 * @property {{ taxonomyKey: string; journeyL1: string; journeyL2: string; description?: string; keywords?: string[] }[]} [journeyPatches]
 * @property {string} updatedAt
 */

/** @returns {TaxonomyOverrides} */
export function emptyOverrides(version = 'taxonomy-static-1') {
  return {
    tagLibraryVersion: version,
    problemTypes: [],
    journeyPatches: [],
    updatedAt: new Date().toISOString(),
  }
}

export { META_KEY_OVERRIDES, META_KEY_TAG_VERSION }

/**
 * @param {import('../taxonomyLoader.js').getAllProducts} getProducts
 * @param {TaxonomyOverrides} overrides
 */
export function applyJourneyPatchesToProducts(products, overrides) {
  if (!overrides?.journeyPatches?.length) return products
  const next = structuredClone(products)
  for (const patch of overrides.journeyPatches) {
    const tax = next[patch.taxonomyKey] || next.generic
    if (!tax) continue
    let l1 = tax.journeys?.find((j) => j.label === patch.journeyL1)
    if (!l1) {
      l1 = {
        id: `patch-${patch.journeyL1}`,
        label: patch.journeyL1,
        description: '',
        children: [],
      }
      tax.journeys = tax.journeys || []
      tax.journeys.push(l1)
    }
    if (!l1.children?.some((c) => c.label === patch.journeyL2)) {
      l1.children = l1.children || []
      l1.children.push({
        id: `patch-${patch.journeyL2}`,
        label: patch.journeyL2,
        description: patch.description || '',
        keywords: patch.keywords || [],
      })
    }
  }
  return next
}

/**
 * @param {{ label: string; keywords: string[] }[]} base
 * @param {{ label: string; keywords: string[] }[]} patches
 */
export function mergeProblemTypes(base, patches) {
  if (!patches?.length) return base
  const map = new Map(base.map((t) => [t.label, { ...t }]))
  for (const p of patches) {
    if (!map.has(p.label)) map.set(p.label, { ...p })
  }
  return [...map.values()]
}
