import { describe, expect, it, vi } from 'vitest'
import {
  matchSharedLabel,
  matchProblemTypesForRecords,
  resolveProblemTypeFromConfig,
} from './dimensionTagging.js'
import { REQUEST_SCENES_BUILTIN, PROBLEM_TYPES_BUILTIN } from './sharedTagDefs.js'

vi.mock('./themeSemantic.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    canUseSemanticMatch: () => true,
    usesLlmThemeMatch: () => true,
    matchSharedDimensionLlmBatch: vi.fn(async (texts) =>
      texts.map(() => ['LLM建议类型']),
    ),
  }
})

describe('dimensionTagging', () => {
  it('matches request scene by keywords', () => {
    const label = matchSharedLabel('客户报障公网IP无法访问需要排查', REQUEST_SCENES_BUILTIN)
    expect(label).toBe('报障与恢复')
  })

  it('matches problem type by description tokens', () => {
    const label = matchSharedLabel('希望增加批量导出功能', PROBLEM_TYPES_BUILTIN)
    expect(label).toBe('功能需求与规划')
  })

  it('resolveProblemTypeFromConfig matches tagging text only', () => {
    expect(resolveProblemTypeFromConfig('希望增加批量导出功能', PROBLEM_TYPES_BUILTIN)).toBe(
      '功能需求与规划',
    )
    expect(resolveProblemTypeFromConfig('慢', PROBLEM_TYPES_BUILTIN)).toBe('性能与质量')
  })

  it('matchProblemTypesForRecords skips LLM when complaint ticket matches config from text', async () => {
    const { matchSharedDimensionLlmBatch } = await import('./themeSemantic.js')
    const records = [
      {
        id: '1',
        dataSourceType: 'complaint_ticket',
        problemType: '表格里的初判原因',
        rawText: '慢',
        handlingText: '慢',
      },
    ]
    const results = await matchProblemTypesForRecords(
      records,
      ['慢'],
      PROBLEM_TYPES_BUILTIN,
      { themeMatchMode: 'hybrid' },
    )
    expect(results[0].label).toBe('性能与质量')
    expect(matchSharedDimensionLlmBatch).not.toHaveBeenCalled()
  })

  it('matchProblemTypesForRecords never uses LLM for complaint tickets even when unmatched', async () => {
    const { matchSharedDimensionLlmBatch } = await import('./themeSemantic.js')
    const records = [
      {
        id: '2',
        dataSourceType: 'complaint_ticket',
        problemType: '表格里的初判原因',
        rawText: '无关键词可匹配的受理说明',
        handlingText: '无关键词可匹配的处理意见',
      },
    ]
    const results = await matchProblemTypesForRecords(
      records,
      ['无关键词可匹配的处理意见'],
      PROBLEM_TYPES_BUILTIN,
      { themeMatchMode: 'hybrid' },
    )
    expect(results[0].label).toBe('未分类')
    expect(matchSharedDimensionLlmBatch).not.toHaveBeenCalled()
  })
})
