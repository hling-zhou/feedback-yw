import { describe, it, expect } from 'vitest'
import {
  computeQuoteExtractionVersion,
  countStaleQuoteExtractions,
  defaultQuoteExtractionMode,
  extractQuoteFromFields,
  extractQuoteForRecord,
  hasTicketLikeStructure,
  isQuoteExtractionStale,
  normalizeQuoteExtractionConfig,
  resolveQuoteExtractionMode,
} from './quoteExtraction.js'

describe('quoteExtraction', () => {
  it('defaults ticket sources to structured_first', () => {
    expect(defaultQuoteExtractionMode('complaint_ticket')).toBe('structured_first')
    expect(defaultQuoteExtractionMode('consultation_ticket')).toBe('structured_first')
    expect(defaultQuoteExtractionMode('post_use_rating')).toBe('plain')
    expect(defaultQuoteExtractionMode('user_survey')).toBe('plain')
    expect(defaultQuoteExtractionMode('other')).toBe('auto')
  })

  it('prefers 【受理内容】 over handling for complaint tickets', () => {
    const { customerQuote } = extractQuoteFromFields(
      {
        rawText: '【受理内容】\n公网无法访问\n\n【处理意见】\n已放行 443',
        handlingText: '已放行 443',
      },
      { dataSourceType: 'complaint_ticket', useRegex: true },
    )
    expect(customerQuote).toContain('公网无法访问')
    expect(customerQuote).not.toContain('已放行')
  })

  it('uses plain body for post_use_rating', () => {
    const { customerQuote, mode } = extractQuoteFromFields(
      { commentText: '控制台加载很慢' },
      { dataSourceType: 'post_use_rating', useRegex: true },
    )
    expect(mode).toBe('plain')
    expect(customerQuote).toBe('控制台加载很慢')
  })

  it('does not run ticket regex on survey open text', () => {
    const { customerQuote } = extractQuoteFromFields(
      { openText: '联系时间：全天可用，希望加快审批' },
      { dataSourceType: 'user_survey', useRegex: true },
    )
    expect(customerQuote).toBe('联系时间：全天可用，希望加快审批')
  })

  it('auto mode uses structure when brackets present', () => {
    expect(
      hasTicketLikeStructure({
        rawText: '【咨询内容】\n如何备案\n\n【处理意见】\n已发送指引',
      }),
    ).toBe(true)
    const { customerQuote } = extractQuoteFromFields(
      {
        rawText: '【咨询内容】\n如何备案\n\n【处理意见】\n已发送指引',
      },
      { dataSourceType: 'other', useRegex: true },
    )
    expect(customerQuote).toBe('如何备案')
  })

  it('when useRegex is off, ticket quote stays acceptance not handling', () => {
    const { customerQuote } = extractQuoteFromFields(
      {
        rawText: '客户无法登录\n\n【处理意见】\n重置密码完成',
        handlingText: '重置密码完成',
      },
      { dataSourceType: 'complaint_ticket', useRegex: false },
    )
    expect(customerQuote).toContain('无法登录')
    expect(customerQuote).not.toContain('重置密码')
  })

  it('resolveQuoteExtractionMode uses team config', () => {
    expect(
      resolveQuoteExtractionMode('complaint_ticket', {
        quoteExtraction: { complaint_ticket: 'plain' },
      }),
    ).toBe('plain')
    expect(
      resolveQuoteExtractionMode('post_use_rating', {
        quoteExtraction: { post_use_rating: 'structured_first' },
      }),
    ).toBe('plain')
  })

  it('normalizeQuoteExtractionConfig fills defaults', () => {
    const cfg = normalizeQuoteExtractionConfig({ complaint_ticket: 'plain' })
    expect(cfg.complaint_ticket).toBe('plain')
    expect(cfg.consultation_ticket).toBe('structured_first')
  })

  it('computeQuoteExtractionVersion changes when team config changes', () => {
    const a = computeQuoteExtractionVersion({ useRegex: true })
    const b = computeQuoteExtractionVersion({ useRegex: false })
    expect(a).not.toBe(b)
    expect(a).toMatch(/^qe-3-/)
  })

  it('detects stale records without version', () => {
    const v = computeQuoteExtractionVersion({ useRegex: true })
    expect(isQuoteExtractionStale({ customerQuote: 'x' }, v)).toBe(true)
    expect(
      isQuoteExtractionStale({ customerQuote: 'x', quoteExtractionVersion: v }, v),
    ).toBe(false)
    expect(countStaleQuoteExtractions([{ customerQuote: 'a' }, { customerQuote: 'b', quoteExtractionVersion: v }], { useRegex: true })).toBe(1)
  })

  it('strips noise from ticket quotes', () => {
    const { customerQuote } = extractQuoteFromFields(
      {
        rawText: '无法访问\n联系时间：全天',
      },
      { dataSourceType: 'complaint_ticket', useRegex: false },
    )
    expect(customerQuote).toBe('无法访问')
  })

  it('extractQuoteForRecord respects dataSourceType', () => {
    const quote = extractQuoteForRecord(
      {
        dataSourceType: 'post_use_rating',
        rawText: 'ignored',
        commentText: '五星好评',
      },
      { useRegex: true },
    )
    expect(quote).toBe('五星好评')
  })
})
