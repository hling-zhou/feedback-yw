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

  // 11-19 两档剔除（用户拍板）：档 1 回访结果"无实际不满"全剔除；档 2 内部评估/溯源"无需优改"类半剔除
  //（excluded_no_action——进定量不进定性）。匹配按客户+产品+月份窗口（validSource），非逐字。
  it('marks issues excluded_no_issue when the visit result says no real dissatisfaction', () => {
    const issues = buildReportIssueOccurrences([record])
    const visit = {
      id: 'visit-nd', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1',
      visitResult: '经省代表回访核实，客户无实际不满，系误操作',
    }
    const resolved = resolveReportIssues(issues, [visit], [])
    // 客户+产品匹配命中该客户该产品的全部问题（同一回访对所有问题生效）
    expect(resolved.every((row) => row.status === 'excluded_no_issue')).toBe(true)
    expect(resolved[0].resolutionSource).toBe('no_dissatisfaction_visit')
  })

  it('marks issues excluded_no_action for no-action conclusions and keeps them out of qualitative only', () => {
    const issues = buildReportIssueOccurrences([record])
    // 档 2a：内部评估"无需优改"类（回访结果未提无实际不满）
    const visit = {
      id: 'visit-na', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1',
      visitResult: '客户反馈功能缺失，经评估',
      internalConclusion: '无需优改（客户误操作/账户异常/极小概率场景）',
    }
    const resolvedVisit = resolveReportIssues(issues, [visit], [])
    expect(resolvedVisit.every((row) => row.status === 'excluded_no_action')).toBe(true)
    expect(resolvedVisit[0].resolutionSource).toBe('no_action_conclusion')
    // 档 2b：产品部溯源"无需优改"类
    const trace = {
      id: 'trace-na', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1',
      recommendedReason: '经产品部评估，该场景无需优化',
    }
    const resolvedTrace = resolveReportIssues(issues, [], [trace])
    expect(resolvedTrace.every((row) => row.status === 'excluded_no_action')).toBe(true)
    expect(resolvedTrace[0].resolutionSource).toBe('no_action_trace')
  })

  it('does not exclude issues of another product or month for the same customer', () => {
    // 误杀对照（Q2 拍板：保留客户+产品匹配）：同客户其他产品/其他月的问题不受回访剔除影响
    const otherProductRecord = {
      ...record, id: 'rating-2', product: '云监控', productName: '云监控',
    }
    const issues = buildReportIssueOccurrences([record, otherProductRecord])
    const visit = {
      id: 'visit-nd', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1',
      visitResult: '经省代表回访，客户无实际不满',
    }
    const resolved = resolveReportIssues(issues, [visit], [])
    const byProduct = Object.fromEntries(resolved.map((row) => [row.productName, row.status]))
    expect(byProduct['弹性公网IP']).toBe('excluded_no_issue')
    expect(byProduct['云监控']).toBe('open')
  })

  it('keeps no_dissatisfaction outranking no_action when both fields present', () => {
    // 档位优先级：回访结果"无实际不满"（档 1）优先于内部评估"无需优改"（档 2）
    const issues = buildReportIssueOccurrences([record])
    const visit = {
      id: 'visit-both', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1',
      visitResult: '经核实，客户无实际不满',
      internalConclusion: '无需优改（客户误操作/无实际不满/账户异常/极小概率场景）',
    }
    const resolved = resolveReportIssues(issues, [visit], [])
    expect(resolved[0].status).toBe('excluded_no_issue')
  })

  it('does not auto-exclude when a conflicting dissatisfied visit exists (11-19 review fix)', () => {
    // 矛盾回访对防御（用户拍板"不满意优先"）：同客户同产品既有"无实际不满"又有不满意措辞时
    // 不自动剔除（回访月粒度无法判时间序，自动剔除可能吞掉真实不满）——回退人工 link 判定
    const issues = buildReportIssueOccurrences([record])
    const visits = [
      { id: 'visit-nd', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1', visitResult: '经核实客户无实际不满' },
      { id: 'visit-bad', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1', visitResult: '客户仍表示不满需处理' },
    ]
    const resolved = resolveReportIssues(issues, visits, [])
    expect(resolved[0].status).toBe('open')
  })

  // 11-19 晚拍板（按对象剔除，真机 bug 复盘）：复合句"不满对象在产品范围外"→ 剔除。
  // 真实先例：Q3 季报"客户对于模型使用不满，对云监控无实际不满"被矛盾防御误判保留进关注项。
  it('excludes compound sentences whose dissatisfaction targets an out-of-scope object', () => {
    const issues = buildReportIssueOccurrences([record])
    const visit = {
      id: 'visit-compound', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1',
      visitResult: '客户对于模型使用不满，对弹性公网IP无实际不满',
    }
    const resolved = resolveReportIssues(issues, [visit], [])
    expect(resolved[0].status).toBe('excluded_no_issue')
  })

  it('keeps the issue when an LLM keep verdict overrides the compound-sentence baseline (11-19)', () => {
    // 反序句"对本产品很不满，对其他对象无实际不满"正则会先剔误杀——LLM 复核 keep 拉回
    const issues = buildReportIssueOccurrences([record])
    const visit = {
      id: 'visit-reverse', importMonth: '2026-06', productName: '弹性公网IP', customerCode: 'C1',
      visitResult: '客户对弹性公网IP非常不满，对共享带宽无实际不满；LLM 判定：对产品仍有真实不满',
    }
    const resolved = resolveReportIssues(issues, [visit], [])
    expect(resolved[0].status).toBe('open')
  })
})
