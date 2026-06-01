/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/** @type {number} */
export const DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH = 1000

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeDetailOptimizationText(value) {
  return String(value ?? '').trim().slice(0, DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH)
}

/**
 * @param {{ productGroupOptimization?: string, designerOptimization?: string }} input
 * @returns {{ productGroupOptimization: string, designerOptimization: string }}
 */
export function buildDetailOptimizationSavePatch(input) {
  return {
    productGroupOptimization: normalizeDetailOptimizationText(input.productGroupOptimization),
    designerOptimization: normalizeDetailOptimizationText(input.designerOptimization),
  }
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {boolean}
 */
export function hasDetailOptimizationContent(record) {
  return Boolean(
    record?.productGroupOptimization?.trim() || record?.designerOptimization?.trim(),
  )
}
