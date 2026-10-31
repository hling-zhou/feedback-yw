import { describe, expect, it } from 'vitest'
import {
  buildRecallText,
  keywordsMatch,
  deriveFtsQueries,
  recallObservationCandidates,
} from './recall.js'

const issues = [
  {
    issueId: 'issue-x',
    productKey: 'eip',
    title: '退订入口难找',
    summary: '控制台找不到退订/取消入口',
    keywords: ['退订', '取消入口'],
    confirmedTicketIds: ['T101'],
    confirmedRecordIds: ['rec-101'],
  },
  {
    issueId: 'issue-y',
    productKey: 'eip',
    title: '转发表加载慢',
    summary: '转发表超过100条时控制台加载超过10秒',
    keywords: ['转发表', '加载慢'],
    confirmedTicketIds: ['T201'],
    confirmedRecordIds: ['rec-201'],
  },
]

describe('buildRecallText', () => {
  it('ticket: painPoint + customerRequest', () => {
    const text = buildRecallText({ dataSourceType: 'complaint_ticket', painPoint: '退订失败', customerRequest: '想退订' })
    expect(text).toBe('退订失败\n想退订')
  })

  it('rating: comment + rawText + reason', () => {
    const text = buildRecallText({ dataSourceType: 'post_use_rating', commentText: '想退退不了', lowScoreReason: '服务不好用' })
    expect(text).toContain('想退退不了')
    expect(text).toContain('服务不好用')
  })
})

describe('keywordsMatch', () => {
  it('matches substring keyword', () => {
    expect(keywordsMatch('共享带宽无法退订', ['退订'])).toBe(true)
    expect(keywordsMatch('页面打开慢', ['退订'])).toBe(false)
  })

  it('empty text or keywords never match', () => {
    expect(keywordsMatch('', ['退订'])).toBe(false)
    expect(keymarks('', ['退订'])).toBe(false)
    expect(keywordsMatch('退订', [])).toBe(false)
  })
})

/** @param {string} text @param {string[]} kws */
function keymarks(text, kws) {
  return keywordsMatch(text, kws)
}

describe('deriveFtsQueries', () => {
  it('splits by punctuation, dedupes, longest first, caps at 4', () => {
    const queries = deriveFtsQueries('共享带宽无法取消。客户想退订，控制台找不到入口！共享带宽无法取消')
    expect(queries.length).toBeLessThanOrEqual(4)
    expect(new Set(queries).size).toBe(queries.length)
    expect(queries[0].length).toBeGreaterThanOrEqual(queries[1]?.length || 0)
    expect(queries).toContain('共享带宽无法取消')
  })

  it('empty text yields no queries', () => {
    expect(deriveFtsQueries('')).toEqual([])
    expect(deriveFtsQueries('   ')).toEqual([])
  })
})

describe('recallObservationCandidates', () => {
  it('anchor channel: originalTicketId hit yields high confidence without FTS call', () => {
    const searchRange = () => {
      throw new Error('FTS should not be called when anchor hits')
    }
    const hits = recallObservationCandidates({
      target: { recordId: 'r1', recordDataSource: 'post_use_rating', productKey: 'eip', productName: 'x', ticketId: '', originalTicketId: 'T101' },
      record: { dataSourceType: 'post_use_rating', commentText: '折腾半天没搞定' },
      issues,
      deps: { searchRange },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].channel).toBe('anchor')
    expect(hits[0].confidence).toBe('high')
    expect(hits[0].excerpt).toContain('T101')
  })

  it('keywords channel: keyword hit yields medium', () => {
    const searchRange = () => ({ total: 0, results: [] })
    const hits = recallObservationCandidates({
      target: { recordId: 'r2', recordDataSource: 'post_use_rating', productKey: 'eip', productName: 'x', ticketId: '', originalTicketId: null },
      record: { dataSourceType: 'post_use_rating', commentText: '无法退订共享带宽' },
      issues,
      deps: { searchRange },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].issueId).toBe('issue-x')
    expect(hits[0].confidence).toBe('medium')
  })

  it('fts channel: matched record maps back to its confirmed issue (keywords-covered issue still hit)', () => {
    const searchRange = () => ({
      total: 1,
      results: [{ recordId: 'rec-201', ticketId: 'T201', product: 'EIP', dataSourceType: 'complaint_ticket', importMonth: '2026-10', matchedField: '痛点', snippet: '转发表加载超过10秒' }],
    })
    const hits = recallObservationCandidates({
      target: { recordId: 't9', recordDataSource: 'complaint_ticket', productKey: 'eip', productName: 'x', ticketId: 'T9', originalTicketId: null },
      record: { dataSourceType: 'complaint_ticket', painPoint: '转发表加载超过10秒打开很卡', customerRequest: '' },
      issues,
      deps: { searchRange },
    })
    // keywords 通道（「转发表」）先命中即达标；通道标记保留首个专门通道
    const hit = hits.find((h) => h.issueId === 'issue-y')
    expect(hit).toBeTruthy()
    expect(hit?.confidence).toBe('medium')
  })

  it('pure fts hit (no keyword overlap) still reaches the issue', () => {
    const searchRange = () => ({
      total: 1,
      results: [{ recordId: 'rec-201', ticketId: 'T201', product: 'EIP', dataSourceType: 'complaint_ticket', importMonth: '2026-10', matchedField: '痛点', snippet: '转发表很卡' }],
    })
    const noKeywordIssues = issues.map((i) => ({ ...i, keywords: [] }))
    const hits = recallObservationCandidates({
      target: { recordId: 't9', recordDataSource: 'complaint_ticket', productKey: 'eip', productName: 'x', ticketId: 'T9', originalTicketId: null },
      record: { dataSourceType: 'complaint_ticket', painPoint: '转发表很卡打不开', customerRequest: '' },
      issues: noKeywordIssues,
      deps: { searchRange },
    })
    const hit = hits.find((h) => h.issueId === 'issue-y')
    expect(hit?.channel).toBe('fts')
    expect(hit?.confidence).toBe('medium')
  })

  it('high anchor result not downgraded by other channels', () => {
    const searchRange = () => ({
      total: 1,
      results: [{ recordId: 'rec-201', ticketId: 'T201', product: 'EIP', dataSourceType: 'complaint_ticket', importMonth: '2026-10', matchedField: '痛点', snippet: '转发表加载' }],
    })
    const hits = recallObservationCandidates({
      target: { recordId: 'r3', recordDataSource: 'post_use_rating', productKey: 'eip', productName: 'x', ticketId: '', originalTicketId: 'T101' },
      record: { dataSourceType: 'post_use_rating', commentText: '转发表加载慢，退订也退不了' },
      issues,
      deps: { searchRange },
    })
    const anchorHit = hits.find((h) => h.issueId === 'issue-x')
    expect(anchorHit?.confidence).toBe('high')
    expect(hits.find((h) => h.issueId === 'issue-y')).toBeTruthy()
  })

  it('no recall text yields no hits', () => {
    const hits = recallObservationCandidates({
      target: { recordId: 'r4', recordDataSource: 'complaint_ticket', productKey: 'eip', productName: 'x', ticketId: 'T4', originalTicketId: null },
      record: { dataSourceType: 'complaint_ticket' },
      issues,
      deps: { searchRange: () => ({ total: 0, results: [] }) },
    })
    expect(hits).toEqual([])
  })

  it('FTS search errors swallowed, keywords result still returned', () => {
    const searchRange = () => {
      throw new Error('boom')
    }
    const hits = recallObservationCandidates({
      target: { recordId: 'r5', recordDataSource: 'post_use_rating', productKey: 'eip', productName: 'x', ticketId: '', originalTicketId: null },
      record: { dataSourceType: 'post_use_rating', commentText: '无法退订' },
      issues,
      deps: { searchRange },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].channel).toBe('keywords')
  })
})
