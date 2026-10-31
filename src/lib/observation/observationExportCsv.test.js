import { describe, expect, it } from 'vitest'
import { buildObservationIssuesCsv } from './observationExportCsv.js'

const mkIssue = (overrides = {}) => ({
  id: 'i1',
  productName: '弹性公网IP',
  title: '退订入口难找',
  summary: '控制台找不到退订/取消入口',
  status: 'watching',
  occurrenceCount: 2,
  ticketCount: 1,
  ratingCount: 1,
  firstSeenAt: '2026-10-01T00:00:00.000Z',
  lastSeenAt: '2026-10-28T00:00:00.000Z',
  payload: { keywords: ['退订'], notes: '' },
  ...overrides,
})

describe('buildObservationIssuesCsv', () => {
  it('emits BOM + headers + rows with CRLF', () => {
    const { csv, rowCount } = buildObservationIssuesCsv({ issues: [mkIssue()] })
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv).toContain('产品,问题标题,问题描述,状态')
    expect(rowCount).toBe(1)
    expect(csv.includes('\r\n')).toBe(true)
  })

  it('escapes fields containing commas/quotes/newlines (RFC 4180)', () => {
    const { csv } = buildObservationIssuesCsv({
      issues: [mkIssue({ summary: '包含,逗号和"引号"还有\n换行' })],
    })
    expect(csv).toContain('"包含,逗号和""引号""还有')
    expect(csv).toContain('换行"')
  })

  it('evidence detail column joins confirmed links', () => {
    const { csv } = buildObservationIssuesCsv({
      issues: [mkIssue()],
      linksByIssue: [
        {
          issueId: 'i1',
          links: [
            { linkStatus: 'confirmed', ticketId: 'T101', recordId: 'r1', matchedExcerpt: '退订入口找不到' },
            { linkStatus: 'pending_suggest', ticketId: 'T102', recordId: 'r2', matchedExcerpt: '不应出现' },
          ],
        },
      ],
    })
    expect(csv).toContain('T101：退订入口找不到')
    expect(csv).not.toContain('不应出现')
  })

  it('status labels localized; promotedTo actionId emitted', () => {
    const { csv } = buildObservationIssuesCsv({
      issues: [mkIssue({ status: 'promoted', payload: { keywords: [], promotedTo: { actionItemId: 'act-9' } } })],
    })
    expect(csv).toContain('已升级')
    expect(csv).toContain('act-9')
  })

  it('caps rows at 5000 and flags truncated', () => {
    const issues = Array.from({ length: 5010 }, (_, i) => mkIssue({ id: `i${i}`, title: `t${i}` }))
    const { rowCount, truncated } = buildObservationIssuesCsv({ issues })
    expect(rowCount).toBe(5000)
    expect(truncated).toBe(true)
  })

  it('empty issues yields header-only csv', () => {
    const { csv, rowCount } = buildObservationIssuesCsv({ issues: [] })
    expect(rowCount).toBe(0)
    expect(csv.split('\r\n')).toHaveLength(1)
  })
})
