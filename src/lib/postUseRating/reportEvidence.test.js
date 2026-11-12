import { describe, expect, it } from 'vitest'
import {
  buildReportIssueOccurrences,
  buildReportProductEvidence,
  buildReportPeriodIssueChanges,
  draftReportNegativeDetail,
  resolveReportIssues,
  traceSourceFingerprint,
  visitSourceFingerprint,
} from './reportEvidence.js'

const record = {
  id: 'rating-1', product: '弹性公网IP', productName: '旧规格名',
  customerCode: 'C1', customerName: '客户甲', importMonth: '2026-06',
  channel: 'console', ratingScore: 2,
  feedbackReasonTexts: ['功能有缺失；页面打开慢'],
  commentText: '页面打开慢，业务操作受影响',
}

describe('report evidence', () => {
  it('collects all negative reason pieces and the comment using the canonical product', () => {
    const issues = buildReportIssueOccurrences([record])
    expect(issues.map((row) => row.issueName)).toEqual([
      '功能有缺失', '页面打开慢', '页面打开慢',
    ])
    expect(issues.map((row) => row.text)).toContain('页面打开慢，业务操作受影响')
    expect(issues.every((row) => row.productName === '弹性公网IP')).toBe(true)
    const evidence = buildReportProductEvidence(resolveReportIssues(issues), '弹性公网IP')
    expect(evidence.rawPieceCount).toBe(3)
    expect(draftReportNegativeDetail(evidence)).toContain('「页面打开慢」原始 2 次')
  })

  it('excludes only the linked issue and keeps raw counts and low scores', () => {
    const issues = buildReportIssueOccurrences([record])
    const visit = {
      id: 'visit-1', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1',
      userFeedbackText: '功能有缺失', visitResult: '无问题，客户已确认',
    }
    const links = [{
      issueId: issues[0].id, sourceType: 'visit', sourceId: visit.id,
      sourceFingerprint: visitSourceFingerprint(visit), verdict: 'no_issue',
    }]
    const resolved = resolveReportIssues(issues, [visit], [], links)
    expect(resolved.map((row) => row.status)).toEqual(['excluded_no_issue', 'open', 'open'])
    const evidence = buildReportProductEvidence(resolved, '弹性公网IP')
    expect(evidence.rawPieceCount).toBe(3)
    expect(evidence.excludedIssueCount).toBe(1)
    expect(evidence.activeIssueCount).toBe(2)
    expect(evidence.quotes.every((row) => row.lowestScore === 2)).toBe(true)
  })

  it('invalidates an association after the source result changes or the source is removed', () => {
    const issue = buildReportIssueOccurrences([record])[0]
    const visit = {
      id: 'visit-1', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1',
      userFeedbackText: '功能有缺失', visitResult: '无问题',
    }
    const link = {
      issueId: issue.id, sourceType: 'visit', sourceId: visit.id,
      sourceFingerprint: visitSourceFingerprint(visit), verdict: 'no_issue',
    }
    const changed = { ...visit, visitResult: '仍有问题' }
    expect(resolveReportIssues([issue], [changed], [], [link])[0]).toMatchObject({
      status: 'open', staleLinkCount: 1,
    })
    expect(resolveReportIssues([issue], [], [], [link])[0].status).toBe('open')
  })

  it('requires same customer and product for trace links', () => {
    const issue = buildReportIssueOccurrences([record])[0]
    const trace = { id: 'trace-1', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C2' }
    const link = {
      issueId: issue.id, sourceType: 'trace', sourceId: trace.id,
      sourceFingerprint: traceSourceFingerprint(trace), verdict: 'related',
    }
    expect(resolveReportIssues([issue], [], [trace], [link])[0].linkedTraceIds).toEqual([])
  })

  it('compares exact adjacent quarters and omits excluded issues from change counts', () => {
    const issues = [
      { productName: '弹性公网IP', issueName: '页面打开慢', month: '2026-03', status: 'open', recordId: 'old' },
      { productName: '弹性公网IP', issueName: '页面打开慢', month: '2026-06', status: 'open', recordId: 'new' },
      { productName: '弹性公网IP', issueName: '页面打开慢', month: '2026-06', status: 'excluded_no_issue', recordId: 'excluded' },
      { productName: '弹性公网IP', issueName: '页面打开慢', month: '2025-12', status: 'open', recordId: 'older' },
    ]
    const changes = buildReportPeriodIssueChanges(
      issues, ['2026-04', '2026-05', '2026-06'], ['2026-01', '2026-02', '2026-03'],
    )
    expect(changes[0]).toMatchObject({ currentCount: 1, previousCount: 1, change: '持续' })
    expect(buildReportPeriodIssueChanges(issues, ['2026-06'], ['2026-05'], false)).toEqual([])
  })
})
