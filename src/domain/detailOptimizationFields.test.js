import { describe, expect, it } from 'vitest'
import { getFieldByKey } from './fieldRegistry.js'
import {
  buildDetailOptimizationSavePatch,
  DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH,
  hasDetailOptimizationContent,
  normalizeDetailOptimizationText,
} from './detailOptimizationFields.js'

describe('detailOptimizationFields', () => {
  it('normalizeDetailOptimizationText trims and caps length', () => {
    expect(normalizeDetailOptimizationText('  abc  ')).toBe('abc')
    expect(
      normalizeDetailOptimizationText('x'.repeat(DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH + 4)).length,
    ).toBe(DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH)
  })

  it('buildDetailOptimizationSavePatch normalizes both fields', () => {
    expect(
      buildDetailOptimizationSavePatch({
        productGroupOptimization: ' 产品组 ',
        designerOptimization: '设计师',
      }),
    ).toEqual({
      productGroupOptimization: '产品组',
      designerOptimization: '设计师',
    })
  })

  it('hasDetailOptimizationContent detects either field', () => {
    expect(hasDetailOptimizationContent({ productGroupOptimization: 'a' })).toBe(true)
    expect(hasDetailOptimizationContent({ designerOptimization: 'b' })).toBe(true)
    expect(hasDetailOptimizationContent({})).toBe(false)
  })

  it('registry marks product group and designer as non-corpus export fields', () => {
    expect(getFieldByKey('productGroupOptimization')?.clusterRole).toBe('none')
    expect(getFieldByKey('designerOptimization')?.clusterRole).toBe('none')
    expect(getFieldByKey('productGroupOptimization')?.exportable).toBe(true)
    expect(getFieldByKey('designerOptimization')?.exportable).toBe(true)
  })
})
