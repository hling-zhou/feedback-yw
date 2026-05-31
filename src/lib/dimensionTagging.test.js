import { describe, expect, it, vi } from 'vitest'
import {
  matchSharedLabel,
  matchProblemTypesForRecords,
  matchRequestScenesForRecords,
  resolveProblemTypeFromConfig,
  resolveProblemTypeWithPeerFallback,
  resolveRequestSceneFromConfig,
  retagRecordsSharedDimensionsAfterTicketLlm,
  recordEligibleForPostLlmDimensionRetag,
  shouldRetagDimensionsAfterTicketLlm,
} from './dimensionTagging.js'
import { REQUEST_SCENES_BUILTIN, PROBLEM_TYPES_BUILTIN } from './sharedTagDefs.js'
import { REQUEST_SCENE_DEFAULT, REQUEST_SCENE_FAULT } from './requestSceneClassifier.js'

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
    const label = resolveRequestSceneFromConfig(
      '客户报障公网IP无法访问需要排查',
      REQUEST_SCENES_BUILTIN,
    )
    expect(label).toBe(REQUEST_SCENE_FAULT)
  })

  it('matches problem type by description tokens', () => {
    const label = matchSharedLabel('希望增加批量导出功能', PROBLEM_TYPES_BUILTIN)
    expect(label).toBe('产品功能需求')
  })

  it('resolveProblemTypeFromConfig uses classifier first', () => {
    expect(resolveProblemTypeFromConfig('希望增加批量导出功能', PROBLEM_TYPES_BUILTIN)).toBe(
      '产品功能需求',
    )
    expect(resolveProblemTypeFromConfig('慢', PROBLEM_TYPES_BUILTIN)).toBe('性能问题')
    expect(resolveProblemTypeFromConfig('专线不通，另外延迟也很高', PROBLEM_TYPES_BUILTIN)).toBe(
      '可用性/连通性故障',
    )
  })

  it('resolveProblemTypeFromConfig falls back to legacy scoring when classifier returns 其他', () => {
    expect(resolveProblemTypeFromConfig('我不认可上次结论，再不解决就投诉', PROBLEM_TYPES_BUILTIN)).toBe(
      '其他',
    )
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
    expect(results[0].label).toBe('性能问题')
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
    expect(results[0].label).toBe('其他')
    expect(matchSharedDimensionLlmBatch).not.toHaveBeenCalled()
  })

  it('matchRequestScenesForRecords skips LLM for complaint tickets', async () => {
    const { matchSharedDimensionLlmBatch } = await import('./themeSemantic.js')
    const records = [
      {
        id: '1',
        dataSourceType: 'complaint_ticket',
        requestScene: '表格里的初判场景',
        rawText: '无关键词可匹配的受理说明',
        handlingText: '无关键词可匹配的处理意见',
      },
    ]
    const results = await matchRequestScenesForRecords(
      records,
      ['无关键词可匹配的处理意见'],
      REQUEST_SCENES_BUILTIN,
      { themeMatchMode: 'hybrid', llmApiKey: 'sk-test' },
    )
    expect(results[0].label).toBe(REQUEST_SCENE_DEFAULT)
    expect(matchSharedDimensionLlmBatch).not.toHaveBeenCalled()
  })

  it('matchRequestScenesForRecords matches by keywords for complaint tickets', async () => {
    const records = [
      {
        id: '1',
        dataSourceType: 'complaint_ticket',
        rawText: '客户报障公网IP无法访问需要排查',
        handlingText: '客户报障公网IP无法访问需要排查',
      },
    ]
    const results = await matchRequestScenesForRecords(
      records,
      ['客户报障公网IP无法访问需要排查'],
      REQUEST_SCENES_BUILTIN,
      { themeMatchMode: 'hybrid', llmApiKey: 'sk-test' },
    )
    expect(results[0].label).toBe(REQUEST_SCENE_FAULT)
  })

  it('resolveProblemTypeWithPeerFallback applies §3 peer exclusion on full text', () => {
    expect(
      resolveProblemTypeWithPeerFallback(
        '专线不通请排查',
        'ping通目标，但连接被对端reset',
        PROBLEM_TYPES_BUILTIN,
      ),
    ).toBe('产品功能咨询')
  })

  it('recordEligibleForPostLlmDimensionRetag checks llm source flags', () => {
    expect(recordEligibleForPostLlmDimensionRetag({ customerRequestSource: 'llm' })).toBe(true)
    expect(recordEligibleForPostLlmDimensionRetag({ painPointSource: 'llm' })).toBe(true)
    expect(recordEligibleForPostLlmDimensionRetag({ customerRequestSource: 'rule' })).toBe(false)
  })

  it('shouldRetagDimensionsAfterTicketLlm defaults to true', () => {
    expect(shouldRetagDimensionsAfterTicketLlm({})).toBe(true)
    expect(shouldRetagDimensionsAfterTicketLlm({}, { retagDimensionsAfterTicketLlm: false })).toBe(
      false,
    )
  })

  it('retagRecordsSharedDimensionsAfterTicketLlm uses llm corpus only', async () => {
    const records = [
      {
        id: '1',
        dataSourceType: 'complaint_ticket',
        customerRequest: '专线不通，另外延迟也很高',
        customerRequestSource: 'llm',
        rawText: '受理：慢',
        handlingText: '处理：协查对端',
        requestScene: '产品信息咨询',
        problemType: '其他',
      },
      {
        id: '2',
        dataSourceType: 'complaint_ticket',
        customerRequest: '规则请求',
        customerRequestSource: 'rule',
        rawText: '慢',
        requestScene: '报障与排错',
        problemType: '性能问题',
      },
    ]
    const out = await retagRecordsSharedDimensionsAfterTicketLlm(records, {})
    expect(out[0].requestScene).toBe('报障与排错')
    expect(out[0].problemType).toBe('可用性/连通性故障')
    expect(out[1].requestScene).toBe('报障与排错')
    expect(out[1].problemType).toBe('性能问题')
  })
})
