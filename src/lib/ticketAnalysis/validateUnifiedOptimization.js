import { isGenericMeasure } from '../journeyOptimizationLLM.js'

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeOptimizationStrings(value) {
  if (typeof value === 'string') {
    const t = value.trim()
    return t ? [t] : []
  }
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 合并 LLM 输出的 optimization 是否有效（至少 1 条非空泛 product）
 * @param {{ optimizationProduct?: string; optimizationService?: string; productOptimizations?: unknown; serviceOptimizations?: unknown }} opt
 */
export function isValidUnifiedOptimization(opt) {
  const productItems = [
    ...normalizeOptimizationStrings(opt?.productOptimizations),
    ...normalizeOptimizationStrings(opt?.optimizationProduct),
  ]
  return productItems.some((item) => item && !isGenericMeasure(item))
}

/**
 * @param {{ productOptimizations?: unknown; serviceOptimizations?: unknown; optimizationProduct?: string; optimizationService?: string }} parsed
 * @returns {{ optimizationProduct: string; optimizationService: string; optimizationSuggestion: string }}
 */
export function joinUnifiedOptimizationFields(parsed) {
  const product = [
    ...new Set(
      normalizeOptimizationStrings(parsed?.productOptimizations).filter(
        (item) => !isGenericMeasure(item),
      ),
    ),
  ].slice(0, 3)
  const service = [
    ...new Set(
      normalizeOptimizationStrings(parsed?.serviceOptimizations).filter(
        (item) => !isGenericMeasure(item),
      ),
    ),
  ].slice(0, 2)

  const optimizationProduct = product.join('\n')
  const optimizationService = service.join('\n')
  const optimizationSuggestion = [optimizationProduct, optimizationService].filter(Boolean).join('\n')

  return { optimizationProduct, optimizationService, optimizationSuggestion }
}
