import { describe, it, expect } from 'vitest'
import { stripQuoteNoise } from './quoteNoise.js'

describe('stripQuoteNoise', () => {
  it('removes boilerplate lines and truncates at 联系时间', () => {
    const text =
      '公网 IP 无法访问\n联系时间：0:00 — 23:59\n问题原因：客户侧配置'
    expect(stripQuoteNoise(text, null)).toBe('公网 IP 无法访问')
  })

  it('removes standard closing lines', () => {
    const text = '登录失败\n如有问题请随时联系'
    expect(stripQuoteNoise(text)).toBe('登录失败')
  })

  it('applies team extra line patterns', () => {
    const text = '客户诉求\n答复内容：已发送指引'
    const out = stripQuoteNoise(text, {
      quoteNoise: { extraLinePatterns: ['答复内容：'] },
    })
    expect(out).toBe('客户诉求')
  })

  it('applies team extra inline truncate labels', () => {
    const text = '无法备案\n答复内容：请查看邮件'
    const out = stripQuoteNoise(text, {
      quoteNoise: { extraInlineLabels: ['答复内容'] },
    })
    expect(out).toBe('无法备案')
  })
})
