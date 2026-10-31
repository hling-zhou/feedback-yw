import { describe, expect, it } from 'vitest'
import {
  buildRecordProfile,
  buildIssueProfile,
  buildObservationMatchPrompt,
  parseObservationMatchResult,
  scoreObservationFallback,
  passesObservationGate,
  matchObservationIssue,
} from './matcher.js'

const mkLlm = (payload) => async () => ({
  choices: [{ message: { content: JSON.stringify(payload) } }],
})

const mkLlmRaw = (content) => async () => ({
  choices: [{ message: { content } }],
})

describe('buildRecordProfile', () => {
  it('ticket: painPoint + customerRequest', () => {
    const p = buildRecordProfile({ dataSourceType: 'complaint_ticket', painPoint: '共享带宽无法取消', customerRequest: '想退订' })
    expect(p.text).toContain('共享带宽无法取消')
    expect(p.text).toContain('想退订')
    expect(p.thin).toBe(false)
  })

  it('thin ticket includes handling tail fallback', () => {
    const p = buildRecordProfile({
      dataSourceType: 'consultation_ticket',
      painPoint: '',
      customerRequest: '退订',
      handlingText: '经核实客户已在控制台找到入口并完成退订操作，处理结果：已完成。',
    })
    expect(p.thin).toBe(true)
    expect(p.text).toContain('（处理意见末段）')
    expect(p.text).toContain('已完成')
  })

  it('rating: comment + reason label', () => {
    const p = buildRecordProfile({ dataSourceType: 'post_use_rating', commentText: '转圈半天才出来', lowScoreReason: '页面打开慢' })
    expect(p.text).toContain('转圈半天才出来')
    expect(p.text).toContain('（原因标签）页面打开慢')
  })

  it('caps long profile text', () => {
    const p = buildRecordProfile({ dataSourceType: 'complaint_ticket', painPoint: '长'.repeat(2000) })
    expect(p.text.length).toBeLessThanOrEqual(600)
  })
})

describe('buildIssueProfile', () => {
  it('summary + representative evidence', () => {
    const profile = buildIssueProfile({
      summary: '控制台找不到退订/取消入口',
      representativeEvidence: '工单 #101 痛点：带宽退订入口找不到',
    })
    expect(profile).toContain('（问题描述）控制台找不到退订/取消入口')
    expect(profile).toContain('（代表证据）')
  })
})

describe('parseObservationMatchResult', () => {
  it('parses valid same/medium with reason', () => {
    const r = parseObservationMatchResult({ choices: [{ message: { content: '{"decision":"same","confidence":"medium","reason":"两者均为退订入口受阻"}' } }] })
    expect(r?.decision).toBe('same')
    expect(r?.confidence).toBe('medium')
    expect(r?.reason).toContain('退订')
  })

  it('invalid decision or garbage returns null', () => {
    expect(parseObservationMatchResult({ choices: [{ message: { content: '{"decision":"maybe"}' } }] })).toBeNull()
    expect(parseObservationMatchResult({ choices: [{ message: { content: '不是JSON' } }] })).toBeNull()
    expect(parseObservationMatchResult(null)).toBeNull()
  })

  it('unknown confidence downgrades to low', () => {
    const r = parseObservationMatchResult({ choices: [{ message: { content: '{"decision":"same","confidence":"extreme"}' } }] })
    expect(r?.confidence).toBe('low')
  })
})

describe('passesObservationGate', () => {
  it('same + medium/high passes; low or not_same blocked', () => {
    expect(passesObservationGate({ decision: 'same', confidence: 'high' })).toBe(true)
    expect(passesObservationGate({ decision: 'same', confidence: 'medium' })).toBe(true)
    expect(passesObservationGate({ decision: 'same', confidence: 'low' })).toBe(false)
    expect(passesObservationGate({ decision: 'not_same', confidence: 'high' })).toBe(false)
  })
})

describe('scoreObservationFallback', () => {
  it('keyword hit yields medium (never high)', () => {
    const r = scoreObservationFallback({ keywords: ['退订'] }, '共享带宽无法退订')
    expect(r?.decision).toBe('same')
    expect(r?.confidence).toBe('medium')
  })

  it('no signal returns null', () => {
    expect(scoreObservationFallback({ keywords: ['证书'] }, '共享带宽无法退订')).toBeNull()
    expect(scoreObservationFallback({ keywords: [] }, '')).toBeNull()
  })

  it('summary 4-char sliding overlap counts', () => {
    // 「打开很慢转圈」在两侧均有 4+ 连续字重叠
    const r = scoreObservationFallback(
      { summary: '页面打开很慢转圈' },
      '控制台打开很慢转圈半天才出来',
    )
    expect(r?.decision).toBe('same')
    // 3 字重叠不算（避免误报）
    const weak = scoreObservationFallback(
      { summary: '页面打开慢' },
      '打不开页面',
    )
    expect(weak).toBeNull()
  })
})

describe('matchObservationIssue', () => {
  const record = { dataSourceType: 'complaint_ticket', painPoint: '共享带宽无法取消', customerRequest: '想退订退不掉' }
  const issue = {
    issueId: 'i1',
    title: '退订入口难找',
    summary: '控制台找不到退订/取消入口',
    keywords: ['退订'],
    representativeEvidence: '痛点：带宽退订入口找不到',
  }

  it('llm same/medium passes gate with reason', async () => {
    const r = await matchObservationIssue({
      issue,
      record,
      productName: '弹性公网IP',
      deps: { llm: mkLlm({ decision: 'same', confidence: 'medium', reason: '两者均为退订操作入口受阻' }) },
    })
    expect(r?.decision).toBe('same')
    expect(r?.confidence).toBe('medium')
    expect(r?.source).toBe('llm')
    expect(passesObservationGate(r)).toBe(true)
  })

  it('llm not_same returns not_same (no suggestion)', async () => {
    const r = await matchObservationIssue({
      issue,
      record,
      productName: '弹性公网IP',
      deps: { llm: mkLlm({ decision: 'not_same', confidence: 'high', reason: '文案可读性问题' }) },
    })
    expect(r?.decision).toBe('not_same')
    expect(passesObservationGate(r)).toBe(false)
  })

  it('llm parse failure yields null (宁漏勿错)', async () => {
    const r = await matchObservationIssue({
      issue,
      record,
      productName: '弹性公网IP',
      deps: { llm: mkLlmRaw('坏掉的输出') },
    })
    expect(r).toBeNull()
  })

  it('llm unavailable falls back to keyword scoring', async () => {
    const r = await matchObservationIssue({
      issue,
      record,
      productName: '弹性公网IP',
      deps: { llm: async () => { throw new Error('llm down') } },
    })
    expect(r?.source).toBe('fallback')
    expect(r?.confidence).toBe('medium')
  })

  it('crossSource caps high to medium and prefixes reason', async () => {
    const r = await matchObservationIssue({
      issue,
      record,
      productName: '弹性公网IP',
      crossSource: true,
      deps: { llm: mkLlm({ decision: 'same', confidence: 'high', reason: '口语与书面描述同一问题' }) },
    })
    expect(r?.confidence).toBe('medium')
    expect(r?.reason.startsWith('【跨源】')).toBe(true)
  })

  it('empty profiles yield null without llm call', async () => {
    let called = false
    const r = await matchObservationIssue({
      issue: { summary: '', title: '' },
      record: { dataSourceType: 'complaint_ticket' },
      productName: 'x',
      deps: { llm: async () => { called = true; return {} } },
    })
    expect(r).toBeNull()
    expect(called).toBe(false)
  })
})
