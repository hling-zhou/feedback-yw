import { describe, it, expect } from 'vitest'
import { extractCustomerQuote, extractResponseText } from './extract.js'

describe('extract', () => {
  it('extracts customer quote from ticket template', () => {
    const text =
      '客户问题：网络经常断线，办公无法正常使用。联系时间：2024-02-28。处理意见：已排查为本地路由器故障。'
    expect(extractCustomerQuote(text)).toBe('网络经常断线，办公无法正常使用。')
  })

  it('extracts response from handling notes', () => {
    const text =
      '客户反馈：登录失败。处理意见：已重置密码。解决方案：请使用新密码登录。如有问题请随时联系。'
    expect(extractResponseText(text)).toContain('请使用新密码登录')
  })

  it('falls back to trimmed raw when no match', () => {
    const text = '简单反馈没有标准字段'
    expect(extractCustomerQuote(text)).toBe(text)
  })

  it('extracts 详细内容 from mobile cloud ticket format', () => {
    const text =
      '工单标题：网络波动详细内容：7月31日下午网络出现波动，导致业务受影响。联系时间：0:00 — 23:59'
    expect(extractCustomerQuote(text)).toContain('7月31日下午网络出现波动')
  })

  it('extracts 咨询内容 for consultation tickets', () => {
    const text =
      '咨询内容：如何完成备案？联系时间：工作日。处理意见：已发送备案指引。'
    expect(extractCustomerQuote(text)).toBe('如何完成备案？')
  })
})
