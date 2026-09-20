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
    // 模拟 strictLabels 模式：从传入的 rules 中取第一个标签返回（LLM 只选不造）
    matchSharedDimensionLlmBatch: vi.fn(async (texts, rules, _config, _hints, _opts) => {
      const label = rules?.[0]?.label || '未分类'
      return texts.map(() => [label])
    }),
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

  it('matchProblemTypesForRecords skips LLM when local classifier hits', async () => {
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
    // 本地命中"性能问题"→不调 LLM
    expect(results[0].label).toBe('性能问题')
    expect(matchSharedDimensionLlmBatch).not.toHaveBeenCalled()
  })

  it('matchProblemTypesForRecords triggers LLM when local returns 其他', async () => {
    const { matchSharedDimensionLlmBatch } = await import('./themeSemantic.js')
    matchSharedDimensionLlmBatch.mockClear()
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
    // 本地返回"其他"→触发 LLM（strictLabels 模式，只选不造）
    expect(matchSharedDimensionLlmBatch).toHaveBeenCalled()
    // LLM mock 返回问题类型标签库第一个标签"可用性/连通性故障"→在标签库中
    // mergeSharedDimensionLabel(local="其他", llm="可用性/连通性故障") → 采纳 LLM 结果
    expect(results[0].label).toBe('可用性/连通性故障')
  })

  it('matchRequestScenesForRecords triggers LLM when local returns default', async () => {
    const { matchSharedDimensionLlmBatch } = await import('./themeSemantic.js')
    matchSharedDimensionLlmBatch.mockClear()
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
    // 本地返回默认值（产品信息咨询）→触发 LLM（strictLabels 模式，只选不造）
    expect(matchSharedDimensionLlmBatch).toHaveBeenCalled()
    // LLM mock 返回请求场景标签库第一个标签"报障与排错"→在标签库中
    // mergeSharedDimensionLabel(local="产品信息咨询", llm="报障与排错") → 采纳 LLM 结果
    expect(results[0].label).toBe('报障与排错')
  })

  it('matchRequestScenesForRecords skips LLM when local classifier hits', async () => {
    const { matchSharedDimensionLlmBatch } = await import('./themeSemantic.js')
    matchSharedDimensionLlmBatch.mockClear()
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
    // 本地命中"报障与排错"→不调 LLM
    expect(results[0].label).toBe(REQUEST_SCENE_FAULT)
    expect(matchSharedDimensionLlmBatch).not.toHaveBeenCalled()
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
