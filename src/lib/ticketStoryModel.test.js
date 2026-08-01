import { describe, expect, it } from 'vitest'
import { buildTicketStoryModel } from './ticketStoryModel.js'

const record = (id, overrides = {}) => ({
  id,
  ticketId: `T-${id}`,
  dataSourceType: 'complaint_ticket',
  product: '弹性公网IP',
  importMonth: '2026-06',
  requestScene: '报障与排错',
  problemType: '可用性/连通性故障',
  journeyL1: '使用',
  journeyL2: '连通性验证',
  painPoint: '公网IP无法访问',
  sentiment: 'negative',
  ...overrides,
})

describe('ticket story model', () => {
  it('builds a complaint story with evidence-only follow-up data', () => {
    const records = [
      record('1', { followUpSatisfaction: { score: 8, problemResolved: 'unresolved' }, customerTier: '金牌' }),
      record('2'),
    ]
    const recommendations = [{
      id: 'cluster-1', stableKey: 'pcl-1', signalType: 'pain_cluster_v2', summary: '公网IP无法访问', priority: 'high',
      scope: { product: '弹性公网IP' }, evidenceRecordIds: ['1', '2'],
      sections: { painClusterScores: { ticketCount: 2, sharePct: 100, maxSeverity: 5, p90Emotion: 4, priorityScore: 4.5 } },
    }]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket', sourceLabel: '投诉工单', periodLabel: '2026年6月',
      records, trendRecords: records, trendMonths: ['2026-05', '2026-06'], recommendations,
      snapshot: { status: 'ready', pipelineVersion: 'ticket-v1', aggregates: { painPointClustering: { clusteringVersion: 'v2.0' } } },
    })
    expect(Object.keys(model)).toEqual(['scope', 'conclusions', 'overview', 'trendsAndChanges', 'drivers', 'impactAndEvidence', 'actionsAndRecovery', 'quality'])
    expect(model.overview.metrics).toMatchObject({ total: 2, negativeCount: 2, unresolvedCount: 1 })
    expect(model.drivers.clusters[0]).toMatchObject({ pain: '公网IP无法访问', priorityScore: 4.5 })
    expect(model.drivers.fallbackReferences).toEqual([])
    expect(model.impactAndEvidence.highValueCount).toBe(1)
    expect(model.drivers.locationRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ scene: '报障与排错', journeyL1: '使用', problemType: '可用性/连通性故障', count: 2 }),
    ]))
    expect(model.drivers.locationRows[0].ticketIds).toEqual(['T-1', 'T-2'])
  })

  it('uses consultation-specific opportunity metrics and omits complaint causes', () => {
    const records = [
      record('1', { dataSourceType: 'consultation_ticket', requestScene: '操作指导', problemType: '配置与操作', painPoint: '缺少配置操作指引', sentiment: 'neutral_inquiry' }),
      record('2', { dataSourceType: 'consultation_ticket', requestScene: '操作指导', problemType: '配置与操作', painPoint: '缺少配置操作指引', sentiment: 'neutral_inquiry' }),
    ]
    const model = buildTicketStoryModel({ sourceType: 'consultation_ticket', sourceLabel: '咨询工单', records, trendRecords: records, trendMonths: ['2026-06'] })
    expect(model.overview.metrics.repeatConsultationPct).toBe(100)
    expect(model.overview.metrics.selfServicePct).toBe(100)
    expect(model.drivers.opportunities[0].name).toBe('文档自助')
    expect(model.drivers.complaintCauses).toEqual([])
  })

  it('does not treat empty months as disappeared problems', () => {
    const records = [record('1')]
    const model = buildTicketStoryModel({ sourceType: 'complaint_ticket', records, trendRecords: records, trendMonths: ['2026-05', '2026-06', '2026-07'] })
    expect(model.trendsAndChanges.changes).toEqual([])
  })

  it('includes real ticket ids on change buckets for evidence drill-down', () => {
    const records = [record('1', { importMonth: '2026-05' }), record('2', { importMonth: '2026-06' })]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records,
      trendRecords: records,
      trendMonths: ['2026-05', '2026-06'],
    })
    expect(model.trendsAndChanges.changes[0].change).toBe('持续')
    expect(model.trendsAndChanges.changes[0].ticketIds).toEqual(expect.arrayContaining(['T-1', 'T-2']))
  })

  it('keeps follow-up and customer tier out of cluster priority scores', () => {
    const recommendations = [{
      id: 'cluster-1', stableKey: 'pcl-1', signalType: 'pain_cluster_v2', summary: '公网IP无法访问', priority: 'high', scope: { product: '弹性公网IP' }, evidenceRecordIds: ['1'],
      sections: { painClusterScores: { ticketCount: 1, sharePct: 100, maxSeverity: 5, p90Emotion: 4, priorityScore: 4.5 } },
    }]
    const base = buildTicketStoryModel({ sourceType: 'complaint_ticket', records: [record('1')], recommendations })
    const enriched = buildTicketStoryModel({ sourceType: 'complaint_ticket', records: [record('1', { customerTier: '金牌', followUpSatisfaction: { score: 1, problemResolved: 'unresolved' } })], recommendations })
    expect(enriched.drivers.clusters[0].priorityScore).toBe(base.drivers.clusters[0].priorityScore)
    expect(enriched.impactAndEvidence.unresolvedCount).toBe(1)
  })

  it('separates fallback references and builds stable insight ids', () => {
    const recommendations = [{
      id: 'fallback-1',
      stableKey: 'pfr-1234',
      signalType: 'journey_problem_fallback',
      summary: '控制台配置路径不清晰',
      text: '控制台配置路径不清晰',
      priority: 'low',
      scope: { product: '弹性公网IP', journeyL1: '使用', journeyL2: '连通性验证', problemType: '配置与操作' },
      evidenceRecordIds: ['1'],
      evidenceBundle: { ticketCount: 1, sharePct: 100 },
      generationMeta: { selectedReason: '按旅程×问题类型频次推断' },
    }]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: [record('1')],
      recommendations,
      actions: [{ id: 'a1', linkedInsightIds: ['ticket:complaint_ticket:pfr-1234'], status: 'pending_evaluation' }],
    })
    expect(model.drivers.clusters).toEqual([])
    expect(model.drivers.fallbackReferences).toHaveLength(1)
    expect(model.actionsAndRecovery.rows[0].insightIds).toContain('ticket:complaint_ticket:pfr-1234')
    expect(model.actionsAndRecovery.rows[0].actionStatus).toBeTruthy()
  })

  it('uses snapshot impact focus summaries when available and groups evidence by theme', () => {
    const recommendations = [{
      id: 'cluster-1',
      stableKey: 'pcl-1',
      signalType: 'pain_cluster_v2',
      summary: '公网IP无法访问',
      priority: 'high',
      scope: { product: '弹性公网IP' },
      evidenceRecordIds: ['1'],
      sections: { painClusterScores: { ticketCount: 1, sharePct: 100, maxSeverity: 5, p90Emotion: 4, priorityScore: 4.5 } },
    }]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: [record('1', { customerTier: '金牌', followUpSatisfaction: { score: 6, problemResolved: 'unresolved' } })],
      recommendations,
      selectedProduct: '弹性公网IP',
      snapshot: {
        status: 'ready',
        pipelineVersion: 'ticket-v1',
        aggregates: {
          painPointClustering: { clusteringVersion: 'v2.0' },
          impactFocusSummaries: {
            all: { summary: { status: 'empty', executiveSummary: '全部产品暂无结果', focusItems: [] }, themeLinks: [], ungroupedEvidenceRecordIds: [] },
            byProduct: {
              弹性公网IP: {
                summary: {
                  status: 'linked',
                  executiveSummary: '当前最需要重点关注公网IP无法访问。',
                  focusItems: [{ themeId: 'pcl-1', themeLabel: '公网IP无法访问', riskLevel: 'high', riskSignals: ['高价值客户', '回访未解决'], summary: '公网IP无法访问已影响高价值客户。', evidenceRecordIds: ['1'], evidenceTicketIds: ['T-1'] }],
                },
                themeLinks: [{ themeId: 'pcl-1', themeLabel: '公网IP无法访问', riskLevel: 'high', impactSignals: { highValueCount: 1, negativeCount: 1, urgentCount: 0, unresolvedCount: 1 }, evidenceRecordIds: ['1'], inferred: false }],
                ungroupedEvidenceRecordIds: ['1'],
              },
            },
          },
        },
      },
    })

    expect(model.impactAndEvidence.summary.executiveSummary).toContain('公网IP无法访问')
    expect(model.impactAndEvidence.summarySource).toBe('snapshot')
    expect(model.impactAndEvidence.themeLinks[0]).toMatchObject({
      themeId: 'pcl-1',
      records: [expect.objectContaining({ id: '1' })],
    })
  })

  it('falls back to evidence-only impact summary when there is no theme', () => {
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: [record('1', { urgencyLevel: 'high' })],
      recommendations: [],
    })

    expect(model.impactAndEvidence.summary.status).toBe('evidence_only')
    expect(model.impactAndEvidence.themeLinks).toEqual([])
    expect(model.impactAndEvidence.records[0].id).toBe('1')
  })
})
