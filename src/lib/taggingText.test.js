import { describe, expect, it } from 'vitest'
import {
  buildTaggingTextForRecord,
  buildTaggingTextFromFields,
  extractAppendTextForDisplay,
  extractAppendTextFromFields,
  extractHandlingTextFromFields,
} from './taggingText.js'

describe('buildTaggingTextFromFields', () => {
  it('prioritizes handling text and adds acceptance content', () => {
    const text = buildTaggingTextFromFields({
      handlingText: '已协助客户绑定 EIP',
      rawText: '客户反馈公网 IP 无法访问',
    })
    expect(text).toContain('【处理意见】')
    expect(text).toContain('已协助客户绑定 EIP')
    expect(text).toContain('【受理内容】')
    expect(text).toContain('客户反馈公网 IP 无法访问')
  })

  it('includes append info from bracket sections', () => {
    const text = buildTaggingTextFromFields({
      handlingText: '处理完成',
      rawText: '受理说明\n\n【追加信息】\n客户补充端口 443 仍不通',
    })
    expect(text).toContain('【追加信息】')
    expect(text).toContain('端口 443 仍不通')
  })

  it('parses stored rawText with handling section', () => {
    const text = buildTaggingTextFromFields({
      handlingText: '排查为安全组限制',
      rawText: '无法远程登录\n\n【处理意见】\n排查为安全组限制',
    })
    expect(text).toContain('【受理内容】')
    expect(text).toContain('无法远程登录')
    expect(text).toContain('排查为安全组限制')
    expect(text.match(/【处理意见】/g)).toHaveLength(1)
  })

  it('falls back to customer quote when all ticket fields empty', () => {
    expect(
      buildTaggingTextFromFields({
        customerQuote: '控制台打不开',
      }),
    ).toBe('控制台打不开')
  })
})

describe('extractTicketTextSections', () => {
  it('extractHandlingTextFromFields prefers handlingText field', () => {
    expect(
      extractHandlingTextFromFields({
        handlingText: '主处理意见',
        rawText: '【处理意见】\n其它',
      }),
    ).toBe('主处理意见')
  })

  it('extractAppendTextForDisplay reads bracket and sourceColumns', () => {
    expect(
      extractAppendTextForDisplay({
        handlingText: '已处理',
        rawText: '【追加信息】\n补充说明',
      }),
    ).toBe('补充说明')
    expect(
      extractAppendTextForDisplay({
        handlingText: '已处理',
        rawText: '受理',
        sourceColumns: { 追加信息: '来电补充' },
      }),
    ).toBe('来电补充')
  })

  it('extractAppendTextFromFields skips append duplicated in acceptance body', () => {
    expect(
      extractAppendTextFromFields({
        handlingText: '已处理',
        rawText: '【追加信息】\n补充说明',
      }),
    ).toBe('')
  })
})

describe('buildTaggingTextForRecord', () => {
  it('reads append info from sourceColumns', () => {
    const text = buildTaggingTextForRecord({
      handlingText: '已处理',
      rawText: '受理内容',
      sourceColumns: { 追加信息: '客户再次来电确认' },
    })
    expect(text).toContain('客户再次来电确认')
  })
})
