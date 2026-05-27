import { DATA_SOURCE_TYPES } from '../domain/enums.js'

export const WORKBENCH_HOME = '/workbench'
export const WORKBENCH_ANALYSIS = '/workbench/analysis'

const ANALYSIS_TABS = new Set(['request', 'problem', 'journey', 'sentiment', 'keywords'])

/**
 * @param {{
 *   source?: string
 *   product?: string
 *   journeyL1?: string
 *   journeyL2?: string
 *   problemType?: string
 *   requestScene?: string
 *   tab?: string
 * }} [params]
 */
export function buildWorkbenchAnalysisUrl(params = {}) {
  const sp = new URLSearchParams()
  const source = params.source
  if (source && source !== 'overview' && DATA_SOURCE_TYPES.includes(source)) {
    sp.set('source', source)
  }
  const product = params.product?.trim()
  if (product) sp.set('product', product)
  const journeyL1 = params.journeyL1?.trim()
  if (journeyL1) sp.set('journeyL1', journeyL1)
  const journeyL2 = params.journeyL2?.trim()
  if (journeyL2) sp.set('journeyL2', journeyL2)
  const problemType = params.problemType?.trim()
  if (problemType) sp.set('problemType', problemType)
  const requestScene = params.requestScene?.trim()
  if (requestScene) sp.set('requestScene', requestScene)
  const tab = params.tab?.trim()
  if (tab && ANALYSIS_TABS.has(tab)) sp.set('tab', tab)
  const qs = sp.toString()
  return qs ? `${WORKBENCH_ANALYSIS}?${qs}` : WORKBENCH_ANALYSIS
}

/**
 * @param {URLSearchParams | { get: (key: string) => string | null }} searchParams
 */
export function parseAnalysisSearchParams(searchParams) {
  const rawSource = searchParams.get('source')
  const source =
    rawSource && DATA_SOURCE_TYPES.includes(rawSource) ? rawSource : ''
  const product = searchParams.get('product')?.trim() || ''
  const journeyL1 = searchParams.get('journeyL1')?.trim() || ''
  const journeyL2 = searchParams.get('journeyL2')?.trim() || ''
  const problemType = searchParams.get('problemType')?.trim() || ''
  const requestScene = searchParams.get('requestScene')?.trim() || ''
  const rawTab = searchParams.get('tab')?.trim() || ''
  const tab = ANALYSIS_TABS.has(rawTab) ? rawTab : ''
  return { source, product, journeyL1, journeyL2, problemType, requestScene, tab }
}

/**
 * @param {URLSearchParams} base
 * @param {{
 *   source?: string
 *   product?: string
 *   journeyL1?: string
 *   journeyL2?: string
 *   problemType?: string
 *   requestScene?: string
 *   tab?: string
 * }} patch
 */
export function patchAnalysisSearchParams(base, patch) {
  const next = new URLSearchParams(base)
  const stringFields = [
    'source',
    'product',
    'journeyL1',
    'journeyL2',
    'problemType',
    'requestScene',
    'tab',
  ]
  for (const key of stringFields) {
    if (!(key in patch)) continue
    const value = patch[key]?.trim()
    if (value) next.set(key, value)
    else next.delete(key)
  }
  return next
}
