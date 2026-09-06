import { describe, expect, it } from 'vitest'
import { isValidLlmRootCause, truncateRootCause } from './rootCauseLLM.js'

describe('isValidLlmRootCause', () => {
  it('accepts a concrete mechanism', () => {
    expect(isValidLlmRootCause('安全组未放行 22 端口')).toBe(true)
    expect(isValidLlmRootCause('弹性公网 IP 未绑定到云主机')).toBe(true)
    expect(isValidLlmRootCause('异网访问拥塞')).toBe(true)
  })

  it('rejects placeholders', () => {
    expect(isValidLlmRootCause('待分析')).toBe(false)
    expect(isValidLlmRootCause('无法复现')).toBe(false)
    expect(isValidLlmRootCause('根因未明')).toBe(false)
    expect(isValidLlmRootCause('工单未定位到具体问题原因')).toBe(true)
  })

  it('rejects org-blame-only labels', () => {
    expect(isValidLlmRootCause('云能问题')).toBe(false)
    expect(isValidLlmRootCause('产品原因')).toBe(false)
    expect(isValidLlmRootCause('计算部原因')).toBe(false)
  })

  it('rejects tree-path concatenations', () => {
    expect(isValidLlmRootCause('云能问题 / 产品原因 / 计算部原因')).toBe(false)
    expect(isValidLlmRootCause('云能问题/产品原因/计算部原因')).toBe(false)
  })

  it('accepts L3 cause label', () => {
    expect(isValidLlmRootCause('安全策略')).toBe(true)
    expect(isValidLlmRootCause('硬件问题')).toBe(true)
  })

  it('rejects too-short and too-long', () => {
    expect(isValidLlmRootCause('异网')).toBe(false)
    expect(isValidLlmRootCause('x'.repeat(70))).toBe(false)
  })

  it('accepts short L3 labels of 4 chars', () => {
    expect(isValidLlmRootCause('安全策略')).toBe(true)
    expect(isValidLlmRootCause('硬件问题')).toBe(true)
  })
})

describe('truncateRootCause', () => {
  it('strips leading field prefixes', () => {
    expect(truncateRootCause('问题原因】：安全组未放行 22 端口')).toBe('安全组未放行 22 端口')
    expect(truncateRootCause('问题原因：带宽超限')).toBe('带宽超限')
    expect(truncateRootCause('根因：MTU 配置错误')).toBe('MTU 配置错误')
    expect(truncateRootCause('原因是安全组未放行')).toBe('安全组未放行')
  })

  it('takes first clause', () => {
    expect(truncateRootCause('安全组未放行 22 端口。已协助放行')).toBe('安全组未放行 22 端口')
  })

  it('truncates to hard max', () => {
    const long = '安全组未放行端口导致客户业务全部中断需要立刻处理才行'
    expect(truncateRootCause(long).length).toBeLessThanOrEqual(60)
  })
})
