import { describe, expect, it, vi } from 'vitest'

import {
  buildGeneralizationIssueProfile,
  buildGeneralizationMatchPrompt,
  buildGeneralizationRecordProfile,
  matchGeneralizationIssue,
  parseGeneralizationMatchResult,
  passesGeneralizationGate,
  scoreGeneralizationFallback,
} from './matcher.js'

/**
 * 举一反三判别 matcher 单测——TASKS G2-2 验收：
 * mock transport：same/not_same 分支、解析失败降级、跨产品前缀、跨产品命中 confidence 正常（不封顶）。
 */

const makeRecord = (overrides = {}) => ({
  id: 'rec-1',
  dataSourceType: 'complaint_ticket',
  productKey: 'eip',
  product: '弹性公网IP',
  ticketId: 'T100',
  painPoint: '批量删除安全组只成功一半，报部分失败',
  customerRequest: '想批量删除失败的那些',
  ...overrides,
})

const makeIssue = (overrides = {}) => ({
  issueId: 'gi-1',
  title: '批量删除接口部分失败',
  summary: '批量操作部分成功无回滚',
  keywords: [],
  representativeEvidence: '批量删除一半成功一半失败',
  ...overrides,
})

/** mock LLM 响应（llmChatCompletion 形态） */
const llmResponse = (json) => ({
  choices: [{ message: { content: JSON.stringify(json) } }],
})

describe('buildGeneralizationRecordProfile（工单画像——无评价分支）', () => {
  it('痛点+请求拼接', () => {
    const p = buildGeneralizationRecordProfile(makeRecord())
    expect(p.text).toContain('批量删除安全组只成功一半')
    expect(p.text).toContain('想批量删除失败的那些')
    expect(p.thin).toBe(false)
  })

  it('瘦工单兜底：痛点过短带处理意见末段', () => {
    const p = buildGeneralizationRecordProfile({
      dataSourceType: 'complaint_ticket',
      painPoint: '短',
      handlingText: '前面一大段说明。定位为批量接口事务未包裹，已修复并回归验证通过。',
    })
    expect(p.thin).toBe(true)
    expect(p.text).toContain('处理意见末段')
    expect(p.text).toContain('已修复并回归验证')
  })

  it('空记录空文本', () => {
    expect(buildGeneralizationRecordProfile(null).text).toBe('')
  })
})

describe('buildGeneralizationIssueProfile / buildGeneralizationMatchPrompt', () => {
  it('issue 画像含描述与代表证据', () => {
    const profile = buildGeneralizationIssueProfile(makeIssue())
    expect(profile).toContain('（问题描述）')
    expect(profile).toContain('（代表证据）')
  })

  it('prompt：举一反三称谓 + 可跨产品规则（与留观版差异）', () => {
    const { systemPrompt, userPrompt } = buildGeneralizationMatchPrompt({
      issueProfile: 'X',
      recordProfile: 'Y',
      productName: 'EIP',
      crossProduct: false,
    })
    expect(systemPrompt).toContain('举一反三问题')
    expect(systemPrompt).toContain('同一底层问题模式')
    expect(systemPrompt).toContain('允许跨产品')
    expect(systemPrompt).not.toContain('留观') // gen 版 prompt 零留观字样
    expect(userPrompt).toContain('【举一反三问题】')
    expect(userPrompt).toContain('【新工单】')
  })

  it('crossProduct 时 prompt 带跨产品对照指令', () => {
    const { systemPrompt } = buildGeneralizationMatchPrompt({
      issueProfile: 'X',
      recordProfile: 'Y',
      productName: 'EIP',
      crossProduct: true,
    })
    expect(systemPrompt).toContain('两个产品不同')
  })
})

describe('parseGeneralizationMatchResult（strict 解析）', () => {
  it('合法 JSON 解析成功', () => {
    const r = parseGeneralizationMatchResult(llmResponse({ decision: 'same', confidence: 'high', reason: '同类事务缺陷' }))
    expect(r).toEqual({ decision: 'same', confidence: 'high', reason: '同类事务缺陷' })
  })

  it('非法 decision / 非法 confidence 降级处理', () => {
    expect(parseGeneralizationMatchResult(llmResponse({ decision: 'maybe' }))).toBeNull()
    const low = parseGeneralizationMatchResult(llmResponse({ decision: 'same', confidence: 'weird', reason: 'r' }))
    expect(low?.confidence).toBe('low') // 未知置信度按 low
  })

  it('解析失败返回 null（宁漏勿错）', () => {
    expect(parseGeneralizationMatchResult({ choices: [{ message: { content: '不是JSON' } }] })).toBeNull()
    expect(parseGeneralizationMatchResult(null)).toBeNull()
  })
})

describe('passesGeneralizationGate（same 且 ≥medium）', () => {
  it('门槛四分支', () => {
    expect(passesGeneralizationGate({ decision: 'same', confidence: 'high' })).toBe(true)
    expect(passesGeneralizationGate({ decision: 'same', confidence: 'medium' })).toBe(true)
    expect(passesGeneralizationGate({ decision: 'same', confidence: 'low' })).toBe(false)
    expect(passesGeneralizationGate({ decision: 'not_same', confidence: 'high' })).toBe(false)
    expect(passesGeneralizationGate(null)).toBe(false)
  })
})

describe('scoreGeneralizationFallback（降级不出 high）', () => {
  it('关键词+描述双命中 → same/medium', () => {
    const r = scoreGeneralizationFallback(
      { keywords: ['批量删除'], summary: '批量操作部分成功无回滚' },
      '批量删除安全组失败 批量操作部分成功无回滚',
    )
    expect(r).toMatchObject({ decision: 'same', confidence: 'medium' })
  })

  it('无信号 → null（宁漏勿错）', () => {
    expect(scoreGeneralizationFallback({ summary: '完全无关' }, '批量删除失败')).toBeNull()
    expect(scoreGeneralizationFallback({}, '')).toBeNull()
  })
})

describe('matchGeneralizationIssue（mock transport 主流程）', () => {
  it('same 分支：LLM 判 same/medium → 通过门槛', async () => {
    const result = await matchGeneralizationIssue({
      issue: makeIssue(),
      record: makeRecord(),
      productName: '弹性公网IP',
      deps: {
        llm: async () => llmResponse({ decision: 'same', confidence: 'medium', reason: '同类批量事务缺陷' }),
      },
    })
    expect(result).toMatchObject({ decision: 'same', confidence: 'medium', source: 'llm' })
    expect(passesGeneralizationGate(result)).toBe(true)
  })

  it('not_same 分支：正常返回不落建议', async () => {
    const result = await matchGeneralizationIssue({
      issue: makeIssue(),
      record: makeRecord(),
      productName: '弹性公网IP',
      deps: {
        llm: async () => llmResponse({ decision: 'not_same', confidence: 'high', reason: '本质不同' }),
      },
    })
    expect(result?.decision).toBe('not_same')
    expect(passesGeneralizationGate(result)).toBe(false)
  })

  it('跨产品命中：reason 加【跨产品】前缀、confidence 不封顶（v3.2）', async () => {
    const result = await matchGeneralizationIssue({
      issue: makeIssue(),
      record: makeRecord(),
      productName: 'VPN 网关', // 与 issue 产品不同
      crossProduct: true,
      deps: {
        llm: async () => llmResponse({ decision: 'same', confidence: 'high', reason: '各产品批量接口同缺回滚' }),
      },
    })
    expect(result?.confidence).toBe('high') // 不封顶（与留观跨源封顶的差异点）
    expect(result?.reason.startsWith('【跨产品】')).toBe(true)
  })

  it('解析失败 → null（LLM 正常返回但内容非法）', async () => {
    const result = await matchGeneralizationIssue({
      issue: makeIssue(),
      record: makeRecord(),
      productName: 'EIP',
      deps: {
        llm: async () => ({ choices: [{ message: { content: '坏的' } }] }),
      },
    })
    expect(result).toBeNull()
  })

  it('LLM 异常 → 降级 fallback（不出 high）', async () => {
    const result = await matchGeneralizationIssue({
      issue: makeIssue({ keywords: ['批量删除'] }),
      record: makeRecord(),
      productName: 'EIP',
      deps: {
        llm: async () => {
          throw new Error('llm down')
        },
      },
    })
    expect(result).toMatchObject({ decision: 'same', confidence: 'medium', source: 'fallback' })
  })

  it('空画像 → null 不调 LLM', async () => {
    const llm = vi.fn(async () => llmResponse({ decision: 'same', confidence: 'high', reason: 'r' }))
    const result = await matchGeneralizationIssue({
      issue: makeIssue(),
      record: { dataSourceType: 'complaint_ticket' }, // 无痛点无请求
      productName: 'EIP',
      deps: { llm },
    })
    expect(result).toBeNull()
    expect(llm).not.toHaveBeenCalled()
  })
})
