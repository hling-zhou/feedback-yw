import { describe, expect, it } from 'vitest'

import {
  buildGeneralizationEvidence,
  buildGeneralizationJudgePrompt,
  extractHandlingConclusion,
  judgeGeneralizationForRecord,
  parseGeneralizationJudgeResult,
  passesGeneralizationJudgeGate,
  GENERALIZATION_PROMPT_VERSION,
} from './generalizationPrompt.js'

/**
 * G-pass 单测——TASKS G2-3 验收：设计 §3.1 七例正反对照全部通过（含客户侧 no 两例）。
 */

const llmResponse = (json) => ({
  choices: [{ message: { content: JSON.stringify(json) } }],
})

describe('extractHandlingConclusion（处理意见终段——分类判据真源口径）', () => {
  it('split(处理意见：)[-1] 取终段', () => {
    expect(
      extractHandlingConclusion({
        handlingText: '客户来电反馈问题。处理意见：确认为 API 文档 region 可选值遗漏，已更正。',
      }),
    ).toBe('确认为 API 文档 region 可选值遗漏，已更正。')
  })

  it('无分隔符时整段兜底；空值空串', () => {
    expect(extractHandlingConclusion({ handlingText: '只有一段处理说明' })).toBe('只有一段处理说明')
    expect(extractHandlingConclusion({})).toBe('')
    expect(extractHandlingConclusion(null)).toBe('')
  })
})

describe('buildGeneralizationEvidence / buildGeneralizationJudgePrompt', () => {
  it('画像六字段齐备', () => {
    const e = buildGeneralizationEvidence({
      painPoint: '批量删除只成功一半',
      customerRequest: '想批量删除',
      handlingText: '处理意见：事务未包裹已修复',
      requestScene: '资源管理',
      problemType: '功能缺陷',
      journeyL1: '使用',
    })
    expect(e.painPoint).toContain('批量删除')
    expect(e.handlingConclusion).toBe('事务未包裹已修复')
    expect(e.requestScene).toBe('资源管理')
  })

  it('prompt 含判据 A/B 原文 + 六枚举 + 客户侧 no 规则', () => {
    const { systemPrompt, userPrompt } = buildGeneralizationJudgePrompt({
      evidence: buildGeneralizationEvidence({ painPoint: 'p', handlingText: '处理意见：h' }),
      productName: 'EIP',
    })
    expect(systemPrompt).toContain('判据 A（共性）')
    expect(systemPrompt).toContain('判据 B（可介入）')
    expect(systemPrompt).toContain('code_logic')
    expect(systemPrompt).toContain('other_intervenable')
    expect(systemPrompt).toContain('纯客户侧原因不算可介入')
    expect(systemPrompt).toContain('宁漏勿错')
    expect(userPrompt).toContain('（处理意见结论）')
  })
})

describe('parseGeneralizationJudgeResult（strict 解析）', () => {
  it('合法 yes 解析成功（枚举校验过）', () => {
    const r = parseGeneralizationJudgeResult(
      llmResponse({ needsGeneralization: 'yes', category: 'api_doc', scope: 'cross_product', confidence: 'medium', reason: '文档遗漏所有调用方都会踩' }),
    )
    expect(r).toMatchObject({ needsGeneralization: 'yes', category: 'api_doc', scope: 'cross_product', confidence: 'medium' })
  })

  it('yes 但 category 自造值 → null（只选不造）', () => {
    expect(
      parseGeneralizationJudgeResult(
        llmResponse({ needsGeneralization: 'yes', category: 'made_up', scope: 'multi_scenario', confidence: 'high', reason: 'r' }),
      ),
    ).toBeNull()
  })

  it('yes 但 scope 非法 → null', () => {
    expect(
      parseGeneralizationJudgeResult(
        llmResponse({ needsGeneralization: 'yes', category: 'api_doc', scope: 'everywhere', confidence: 'high', reason: 'r' }),
      ),
    ).toBeNull()
  })

  it('no 分支清空 category/scope；非法 decision → null', () => {
    const no = parseGeneralizationJudgeResult(
      llmResponse({ needsGeneralization: 'no', category: '随便', scope: 'x', confidence: 'low', reason: '客户侧' }),
    )
    expect(no).toMatchObject({ needsGeneralization: 'no', category: '', scope: '' })
    expect(parseGeneralizationJudgeResult(llmResponse({ needsGeneralization: 'maybe' }))).toBeNull()
  })

  it('解析失败 → null', () => {
    expect(parseGeneralizationJudgeResult({ choices: [{ message: { content: '坏' } }] })).toBeNull()
    expect(parseGeneralizationJudgeResult(null)).toBeNull()
  })
})

describe('passesGeneralizationJudgeGate（yes 且 ≥medium）', () => {
  it('四分支', () => {
    expect(passesGeneralizationJudgeGate({ needsGeneralization: 'yes', confidence: 'high' })).toBe(true)
    expect(passesGeneralizationJudgeGate({ needsGeneralization: 'yes', confidence: 'medium' })).toBe(true)
    expect(passesGeneralizationJudgeGate({ needsGeneralization: 'yes', confidence: 'low' })).toBe(false)
    expect(passesGeneralizationJudgeGate({ needsGeneralization: 'no', confidence: 'high' })).toBe(false)
  })
})

describe('设计 §3.1 七例正反对照（G2-3 验收硬要求）', () => {
  const judge = (llmJson) =>
    judgeGeneralizationForRecord({
      record: { painPoint: 'x', handlingText: '处理意见：y' },
      productName: 'EIP',
      deps: { llm: async () => llmResponse(llmJson) },
    })

  it('例① 文档错误 → yes·api_doc·multi_scenario（过门槛）', async () => {
    const r = await judge({ needsGeneralization: 'yes', category: 'api_doc', scope: 'multi_scenario', confidence: 'medium', reason: '文档遗漏新区域所有调用方都会踩' })
    expect(passesGeneralizationJudgeGate(r)).toBe(true)
    expect(r?.category).toBe('api_doc')
    expect(r?.promptVersion).toBe(GENERALIZATION_PROMPT_VERSION)
  })

  it('例② 编码缺陷 → yes·code_logic', async () => {
    const r = await judge({ needsGeneralization: 'yes', category: 'code_logic', scope: 'multi_scenario', confidence: 'high', reason: '事务未包裹' })
    expect(r?.category).toBe('code_logic')
    expect(passesGeneralizationJudgeGate(r)).toBe(true)
  })

  it('例③ 特殊场景失效 → yes·special_scenario', async () => {
    const r = await judge({ needsGeneralization: 'yes', category: 'special_scenario', scope: 'multi_scenario', confidence: 'medium', reason: '特殊组网路由未关联' })
    expect(passesGeneralizationJudgeGate(r)).toBe(true)
  })

  it('例④ 控制台繁琐（咨询） → yes·console_ux', async () => {
    const r = await judge({ needsGeneralization: 'yes', category: 'console_ux', scope: 'multi_scenario', confidence: 'medium', reason: '续费入口过深' })
    expect(passesGeneralizationJudgeGate(r)).toBe(true)
  })

  it('例⑤ 业务规则反直觉 → yes·business_rule', async () => {
    const r = await judge({ needsGeneralization: 'yes', category: 'business_rule', scope: 'multi_scenario', confidence: 'medium', reason: '资源保留 2h 客户不知情' })
    expect(passesGeneralizationJudgeGate(r)).toBe(true)
  })

  it('例⑥ 负例：客户侧配置错误 → no（纯客户侧不算可介入）', async () => {
    const r = await judge({ needsGeneralization: 'no', confidence: 'high', reason: '客户本地防火墙拦截，属客户侧配置问题' })
    expect(r?.needsGeneralization).toBe('no')
    expect(passesGeneralizationJudgeGate(r)).toBe(false)
  })

  it('例⑦ 负例：客户理解偏差 → no', async () => {
    const r = await judge({ needsGeneralization: 'no', confidence: 'high', reason: '客户误解带宽单位' })
    expect(passesGeneralizationJudgeGate(r)).toBe(false)
  })
})

describe('judgeGeneralizationForRecord（入口分支）', () => {
  it('无判别材料（无痛点无处理意见）→ null 不调 LLM', async () => {
    let called = false
    const r = await judgeGeneralizationForRecord({
      record: { dataSourceType: 'complaint_ticket' },
      productName: 'EIP',
      deps: {
        llm: async () => {
          called = true
          return llmResponse({ needsGeneralization: 'yes', category: 'api_doc', scope: 'multi_scenario', confidence: 'high', reason: 'r' })
        },
      },
    })
    expect(r).toBeNull()
    expect(called).toBe(false)
  })

  it('LLM 异常 → null 静默（G-pass 无字面降级——设计 §3.1）', async () => {
    const r = await judgeGeneralizationForRecord({
      record: { painPoint: 'p', handlingText: '处理意见：h' },
      productName: 'EIP',
      deps: {
        llm: async () => {
          throw new Error('llm down')
        },
      },
    })
    expect(r).toBeNull()
  })

  it('low 把握 → 解析成功但不过门槛（宁漏勿错）', async () => {
    const r = await judgeGeneralizationForRecord({
      record: { painPoint: 'p', handlingText: '处理意见：h' },
      productName: 'EIP',
      deps: {
        llm: async () => llmResponse({ needsGeneralization: 'yes', category: 'code_logic', scope: 'multi_scenario', confidence: 'low', reason: '仅猜测' }),
      },
    })
    expect(r?.needsGeneralization).toBe('yes')
    expect(passesGeneralizationJudgeGate(r)).toBe(false)
  })
})
