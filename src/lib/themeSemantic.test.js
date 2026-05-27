import { describe, expect, it } from 'vitest'
import {
  isInThemeLibrary,
  isLlmProposedThemeLabel,
  mergeSharedDimensionLabel,
  resolveThemeOverflowOrigin,
} from './themeSemantic.js'

const rules = [
  { id: 'a', label: '计费与账单', description: '账单相关', keywords: ['账单'] },
  { id: 'b', label: '可用性', description: '故障', keywords: ['宕机'] },
]

describe('themeSemantic shared dimensions', () => {
  it('isLlmProposedThemeLabel detects library-external labels', () => {
    expect(isInThemeLibrary('计费与账单', rules)).toBe(true)
    expect(isLlmProposedThemeLabel('全新问题类型', rules)).toBe(true)
    expect(isLlmProposedThemeLabel('未分类', rules)).toBe(false)
  })

  it('mergeSharedDimensionLabel keeps LLM proposed label', () => {
    expect(mergeSharedDimensionLabel('未分类', '全新问题类型', rules)).toBe('全新问题类型')
  })

  it('mergeSharedDimensionLabel keeps local overflow when LLM returns 未分类', () => {
    expect(mergeSharedDimensionLabel('导入列类型', '未分类', rules)).toBe('导入列类型')
  })

  it('mergeSharedDimensionLabel prefers known LLM match over local unknown', () => {
    expect(mergeSharedDimensionLabel('导入列类型', '可用性', rules)).toBe('可用性')
  })

  it('resolveThemeOverflowOrigin marks LLM vs local overflow', () => {
    expect(
      resolveThemeOverflowOrigin('全新问题类型', '未分类', '全新问题类型', rules),
    ).toBe('llm')
    expect(resolveThemeOverflowOrigin('导入列类型', '导入列类型', '未分类', rules)).toBe(
      'local_overflow',
    )
    expect(resolveThemeOverflowOrigin('可用性', '未分类', '可用性', rules)).toBe(null)
  })
})
