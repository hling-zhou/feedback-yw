import { describe, expect, it } from 'vitest'
import {
  applyMailPlaceholders,
  assertEmailList,
  defaultMailTemplate,
  joinPublicAppUrl,
  MAIL_PRESET_CALLBACK_VISIT,
  MAIL_PRESET_REPORT,
  parseEmailList,
  resolveMailContentUrl,
} from './mail.js'

describe('mail domain', () => {
  it('parses mixed separators and de-duplicates emails', () => {
    expect(parseEmailList('a@x.com, b@x.com；a@x.com\nc@x.com')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ])
  })

  it('rejects invalid emails and empty lists', () => {
    expect(() => assertEmailList([])).toThrow(/请填写/)
    expect(() => assertEmailList(['not-an-email'])).toThrow(/不是有效邮箱/)
  })

  it('replaces report placeholders', () => {
    const template = defaultMailTemplate(MAIL_PRESET_REPORT)
    expect(
      applyMailPlaceholders(template.body, {
        periodLabel: '2026年6月',
        reportKey: '2026-06',
        reportKind: 'month',
        absoluteUrl: 'https://example.com/workbench/post-use-report/2026-06',
      }),
    ).toBe(
      '2026年6月的用后即评月报\n详见附件，可用浏览器直接打开\n原始数据及报告见用户反馈分析平台 https://example.com/workbench/post-use-report/2026-06',
    )
  })

  it('replaces placeholders on a custom template', () => {
    expect(
      applyMailPlaceholders('{周期标签}的附件 {月报|季报} {绝对链接}', {
        periodLabel: '2026年Q2',
        reportKind: 'quarter',
        absoluteUrl: 'https://example.com/workbench?tab=post_use_rating',
      }),
    ).toBe('2026年Q2的附件 季报 https://example.com/workbench?tab=post_use_rating')
  })

  it('builds the callback list URL against the workbench tab', () => {
    expect(joinPublicAppUrl('https://example.com/', '/workbench?tab=post_use_rating')).toBe(
      'https://example.com/workbench?tab=post_use_rating',
    )
    expect(
      resolveMailContentUrl(MAIL_PRESET_CALLBACK_VISIT, 'month', '2026-06', 'https://example.com'),
    ).toBe('https://example.com/workbench?tab=post_use_rating')
    expect(resolveMailContentUrl(MAIL_PRESET_REPORT, 'quarter', '2026-Q2', 'https://example.com')).toBe(
      'https://example.com/workbench/post-use-report/2026-Q2',
    )
  })
})
