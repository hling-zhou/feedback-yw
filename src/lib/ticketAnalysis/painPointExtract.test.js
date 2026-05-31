import { describe, expect, it } from 'vitest'
import { extractPainPoint, rewriteDemandPainPoint, truncatePainPoint } from './painPointExtract.js'

describe('painPointExtract V2 rules', () => {
  it('prioritizes customerRequest over rootCause', () => {
    const pain = extractPainPoint({
      customerRequest: '无法退订共享带宽，请帮忙处理。',
      rootCauseCol: '安全组未放行8085端口',
      taggingText: '处理意见：已协助排查',
    })
    expect(pain).toMatch(/退订/)
    expect(pain).not.toMatch(/安全组/)
  })

  it('rewrites demand-type suggestions', () => {
    expect(rewriteDemandPainPoint('希望增加批量删除功能')).toMatch(/逐个操作|效率低/)
    expect(rewriteDemandPainPoint('建议增加夜间模式')).toMatch(/夜间模式/)
  })

  it('truncatePainPoint respects hard max 80', () => {
    const long = '云主机网络连通性不稳定导致业务受影响'.repeat(3)
    expect(truncatePainPoint(long).length).toBeLessThanOrEqual(80)
  })

  it('falls back to rootCause when customerRequest empty', () => {
    const pain = extractPainPoint({
      customerRequest: '',
      rootCauseCol: '安全组未放行8085端口导致无法访问',
      taggingText: '',
    })
    expect(pain).toMatch(/安全组|8085/)
  })
})
