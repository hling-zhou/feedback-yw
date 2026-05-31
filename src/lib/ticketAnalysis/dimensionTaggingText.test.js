import { describe, expect, it } from 'vitest'
import {
  buildDimensionTaggingLayers,
  buildProblemTypeTaggingText,
} from './dimensionTaggingText.js'

describe('buildProblemTypeTaggingText', () => {
  it('prefers customerRequest and painPoint', () => {
    const text = buildProblemTypeTaggingText({
      customerRequest: '端口不通，请排查',
      painPoint: '安全组未放行特定端口',
      rawText: '【受理内容】\n公网 IP 无法访问',
      handlingText: '已协助调整安全组',
    })
    expect(text).toBe('端口不通，请排查\n安全组未放行特定端口')
  })

  it('deduplicates when painPoint equals customerRequest', () => {
    const text = buildProblemTypeTaggingText({
      customerRequest: '专线不通',
      painPoint: '专线不通',
      handlingText: '已联系客户',
    })
    expect(text).toBe('专线不通')
  })

  it('falls back to acceptance and handling when no pain fields', () => {
    const text = buildProblemTypeTaggingText({
      rawText: '【受理内容】\n公网 IP 无法访问\n\n【处理意见】\n已协助调整安全组',
      handlingText: '已协助调整安全组',
    })
    expect(text).toMatch(/公网 IP 无法访问/)
    expect(text).toMatch(/已协助调整安全组/)
  })

  it('falls back to append in layered corpus', () => {
    const text = buildProblemTypeTaggingText({
      rawText:
        '【受理内容】\n公网 IP 无法访问\n\n【追加信息】\n客户补充：HTTPS 仍提示证书错误\n\n【处理意见】\n已协助调整',
      handlingText: '已协助调整',
    })
    expect(text).toMatch(/HTTPS|证书/)
  })

  it('does not use handling-only noise when pain fields exist', () => {
    const text = buildProblemTypeTaggingText({
      customerRequest: '无法退订共享带宽',
      handlingText: '已返单，请网络组协查',
    })
    expect(text).toBe('无法退订共享带宽')
    expect(text).not.toMatch(/已返单|网络组/)
  })
})

describe('buildDimensionTaggingLayers', () => {
  it('splits acceptance/append primary and handling secondary', () => {
    const layers = buildDimensionTaggingLayers({
      rawText: '【受理内容】\n客户反馈专线不通\n\n【处理意见】\n已联系客户',
      handlingText: '已联系客户',
    })
    expect(layers.primaryText).toMatch(/专线不通/)
    expect(layers.secondaryText).toMatch(/已联系客户/)
  })
})
