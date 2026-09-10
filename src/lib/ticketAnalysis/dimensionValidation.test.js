import { describe, it, expect } from 'vitest'
import { validateL0, validateL1, validateL2, mergeGateStatuses } from './dimensionValidation.js'

describe('validateL0 - customerRequest 质量 + 意图可信度', () => {
  it('通过：有效请求 + high confidence', () => {
    const r = validateL0({ customerRequest: 'EIP不通无法访问业务中断', confidence: 'high' })
    expect(r.pass).toBe(true)
    expect(r.grade).toBe('ok')
  })

  it('失败：空 customerRequest', () => {
    const r = validateL0({ customerRequest: '', confidence: 'high' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('incomplete')
  })

  it('失败：占位符', () => {
    const r = validateL0({ customerRequest: 'null', confidence: 'medium' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('incomplete')
  })

  it('失败：confidence=low（弱信号）', () => {
    const r = validateL0({ customerRequest: 'EIP不通无法访问', confidence: 'low' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('weak_signal')
  })

  it('失败：confidence=undefined', () => {
    const r = validateL0({ customerRequest: 'EIP不通无法访问', confidence: undefined })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('weak_signal')
  })

  it('失败：customerRequest 太短', () => {
    const r = validateL0({ customerRequest: 'ab', confidence: 'high' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('incomplete')
  })
})

describe('validateL1 - requestScene × problemType 一致性', () => {
  it('通过：一致的配额申请', () => {
    const r = validateL1({ requestScene: '资源操作申请', problemType: '配额与权限申请' })
    expect(r.pass).toBe(true)
    expect(r.grade).toBe('ok')
  })

  it('通过：一致的故障排查', () => {
    const r = validateL1({ requestScene: '报障与排错', problemType: '可用性/连通性故障' })
    expect(r.pass).toBe(true)
    expect(r.grade).toBe('ok')
  })

  it('通过：报障+性能问题', () => {
    const r = validateL1({ requestScene: '报障与排错', problemType: '性能问题' })
    expect(r.pass).toBe(true)
  })

  it('通过：报障+其他', () => {
    const r = validateL1({ requestScene: '报障与排错', problemType: '其他' })
    expect(r.pass).toBe(true)
  })

  it('拦截：报障+配额（已知矛盾）', () => {
    const r = validateL1({ requestScene: '报障与排错', problemType: '配额与权限申请' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('conflict')
    expect(r.issues[0]).toContain('配额')
  })

  it('拦截：报障+产品功能咨询 → incomplete（默认值弱信号先拦截）', () => {
    const r = validateL1({ requestScene: '报障与排错', problemType: '产品功能咨询' })
    expect(r.pass).toBe(false)
    // "产品功能咨询" 被视为默认兜底，incomplete 先于 conflict 拦截
    expect(r.grade).toBe('incomplete')
  })

  it('拦截：产品信息咨询+退订（已知矛盾）', () => {
    const r = validateL1({ requestScene: '产品信息咨询', problemType: '退订与释放' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('conflict')
  })

  it('降级：空 requestScene', () => {
    const r = validateL1({ requestScene: '', problemType: '配额与权限申请' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('incomplete')
  })

  it('降级：默认 problemType', () => {
    const r = validateL1({ requestScene: '报障与排错', problemType: '产品功能咨询' })
    expect(r.pass).toBe(false)
  })

  it('低置信度降级', () => {
    const r = validateL1({ requestScene: '报障与排错', problemType: '可用性/连通性故障', confidence: 'low' })
    expect(r.grade).toBe('incomplete')
  })
})

describe('validateL2 - journey 有效性', () => {
  it('通过：一致的 journey', () => {
    const r = validateL2({ journeyL1: '开通与申领', journeyL2: '订购开通与加急', requestScene: '资源操作申请' })
    expect(r.pass).toBe(true)
    expect(r.grade).toBe('ok')
  })

  it('通过：报障+运行旅程', () => {
    const r = validateL2({ journeyL1: '运行与质量', journeyL2: '网络质量与丢包', requestScene: '报障与排错' })
    expect(r.pass).toBe(true)
  })

  it('拦截：空 journeyL1', () => {
    const r = validateL2({ journeyL1: '', journeyL2: '订购开通', requestScene: '资源操作申请' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('incomplete')
  })

  it('拦截：journeyL1 无法识别', () => {
    const r = validateL2({ journeyL1: '无法识别', journeyL2: '无法识别', requestScene: '资源操作申请' })
    expect(r.pass).toBe(false)
  })

  it('拦截：方向不一致', () => {
    const r = validateL2({ journeyL1: '认知与选型', journeyL2: '方案咨询', requestScene: '报障与排错' })
    expect(r.pass).toBe(false)
    expect(r.grade).toBe('mismatch')
  })

  it('通过：产品信息咨询+认知旅程', () => {
    const r = validateL2({ journeyL1: '认知与选型', journeyL2: '方案与商务', requestScene: '产品信息咨询' })
    expect(r.pass).toBe(true)
  })
})

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
})