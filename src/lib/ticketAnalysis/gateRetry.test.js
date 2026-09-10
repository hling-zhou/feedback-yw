import { describe, it, expect } from 'vitest'
import { validateL0, validateL1, validateL2, mergeGateStatuses } from './dimensionValidation.js'
import { retryGate } from './gateRetry.js'

// ============================================================
// L0 闸门测试
// ============================================================
describe('validateL0', () => {
  it('通过：有效 customerRequest + high confidence', () => {
    const r = validateL0({ customerRequest: 'EIP不通无法访问业务中断', confidence: 'high' })
    expect(r.pass).toBe(true)
    expect(r.grade).toBe('ok')
  })

  it('失败：customerRequest 为空', () => {
    const r = validateL0({ customerRequest: '', confidence: 'high' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('incomplete')
    expect(r.issues[0]).toContain('为空')
  })

  it('失败：customerRequest 为占位符', () => {
    const r = validateL0({ customerRequest: 'null', confidence: 'medium' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('incomplete')
  })

  it('失败：confidence 为 low', () => {
    const r = validateL0({ customerRequest: 'EIP不通无法访问', confidence: 'low' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('weak_signal')
    expect(r.issues[0]).toContain('low')
  })

  it('失败：confidence 为 undefined', () => {
    const r = validateL0({ customerRequest: 'EIP不通无法访问', confidence: undefined })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('weak_signal')
  })

  it('失败：customerRequest 太短', () => {
    const r = validateL0({ customerRequest: 'ab', confidence: 'high' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('incomplete')
  })

  it('失败：customerRequest 为模板字段堆叠', () => {
    const r = validateL0({
      customerRequest: '请求节点：全局流转--业务规则咨询/查询工单标题：业务规则咨询',
      confidence: 'medium',
    })
    expect(r.pass).toBe(false)
  })
})

// ============================================================
// mergeGateStatuses 测试
// ============================================================
describe('mergeGateStatuses', () => {
  it('全部通过 → ok', () => {
    expect(mergeGateStatuses([
      { level: 'L0', grade: 'ok', pass: true },
      { level: 'L1', grade: 'ok', pass: true },
      { level: 'L2', grade: 'ok', pass: true },
    ])).toBe('ok')
  })

  it('任一失败 → manual_review', () => {
    expect(mergeGateStatuses([
      { level: 'L0', grade: 'ok', pass: true },
      { level: 'L1', grade: 'conflict', pass: false },
    ])).toBe('manual_review')
  })

  it('L0 失败 → manual_review', () => {
    expect(mergeGateStatuses([
      { level: 'L0', grade: 'incomplete', pass: false },
      { level: 'L1', grade: 'incomplete', pass: false },
    ])).toBe('manual_review')
  })
})

// ============================================================
// retryGate 测试
// ============================================================
describe('retryGate', () => {
  // 由于 retryGate 的 LLM 策略需要 LLM 配置，这里只测无 LLM 的路径

  it('L1 回退旧分类器可能修复 conflict', async () => {
    const taxonomy = {
      problemTypes: [{ label: '可用性/连通性故障' }, { label: '配额与权限申请' }],
      requestScenes: [{ label: '报障与排错' }, { label: '资源操作申请' }],
      journeys: [],
    }
    const result = await retryGate({
      level: 'L1',
      input: {
        rawText: 'EIP不通无法访问业务中断',
        handlingText: '经排查定位为公网链路质量问题，已协助处理',
        customerRequest: 'EIP不通无法访问业务中断',
      },
      text: 'EIP不通无法访问业务中断',
      taxonomy,
      taxonomyKey: 'eip',
      dims: { requestScene: '报障与排错', problemType: '配额与权限申请' },
      gateResult: { pass: false, issues: ['报障场景不应有配额工单'], grade: 'conflict' },
      settings: null, // 无 LLM
    })

    // 应该尝试回退旧分类器，可能 PASS 或 manual_review
    expect(result.tagStatus).toMatch(/ok|manual_review/)
  })

  it('L2 路径兜底在无路径段时返回 manual_review', async () => {
    const taxonomy = {
      problemTypes: [],
      requestScenes: [],
      journeys: [],
    }
    const result = await retryGate({
      level: 'L2',
      input: { customerRequest: '测试', painPoint: '测试' },
      text: '无路径段的文本',
      taxonomy,
      taxonomyKey: 'eip',
      dims: { requestScene: '报障与排错', problemType: '可用性/连通性故障', journeyL1: '无法识别', journeyL2: '无法识别' },
      gateResult: { pass: false, issues: ['journeyL1 为空'], grade: 'incomplete' },
      settings: null,
    })

    expect(result.tagStatus).toBe('manual_review')
  })

  it('L0 在无 LLM 时全部策略失败 → manual_review', async () => {
    const result = await retryGate({
      level: 'L0',
      input: { rawText: '短', handlingText: '', customerRequest: '' },
      text: '短',
      taxonomy: { problemTypes: [], requestScenes: [], journeys: [] },
      taxonomyKey: 'eip',
      dims: { customerRequest: '', confidence: 'low' },
      gateResult: { pass: false, issues: ['customerRequest 为空'], grade: 'incomplete' },
      settings: null,
    })

    expect(result.pass).toBe(false)
    expect(result.tagStatus).toBe('manual_review')
    expect(result.tagIssues.some(i => i.includes('L0 重试后仍不通过'))).toBe(true)
  })

  it('未知层级 → manual_review', async () => {
    const result = await retryGate({
      level: 'L9',
      input: {},
      text: '',
      taxonomy: {},
      taxonomyKey: '',
      dims: {},
      gateResult: { pass: false, issues: [], grade: 'unknown' },
      settings: null,
    })

    expect(result.tagStatus).toBe('manual_review')
  })
})
