import { describe, expect, it } from 'vitest'
import { createInsightPeriod } from '../domain/insightPeriod.js'
import { buildOverviewConclusions } from './buildOverviewConclusions.js'
import { buildOverviewSnapshot } from './buildOverviewSnapshot.js'
import { buildSourceSnapshot } from './buildSourceSnapshot.js'

function makeRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    source: '工单',
    rawText: 'test',
    createdAt: '2025-06-15T10:00:00Z',
    importMonth: '2025-06',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    problemType: '配置与操作',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    sentiment: 'negative',
    painPoint: '安全组规则未放行导致公网端口无法访问',
    ...overrides,
  }
}

describe('pain point clustering integration', () => {
  it('source snapshot → overview snapshot produces V2 action recommendations', () => {
    const period = createInsightPeriod({
      label: '2025-06',
      granularity: 'month',
      anchorYear: 2025,
      anchorMonth: 6,
    })
    const sharedPain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ painPoint: sharedPain }),
      makeRecord({ painPoint: sharedPain }),
      makeRecord({ painPoint: sharedPain }),
      makeRecord({
        dataSourceType: 'consultation_ticket',
        problemType: '计费与账单',
        journeyL1: '认知与选型',
        painPoint: '账单金额计算错误多扣费用',
      }),
    ]

    const complaintSnap = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'complaint_ticket',
      records: records.filter((r) => r.dataSourceType === 'complaint_ticket'),
    })
    const consultationSnap = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'consultation_ticket',
      records: records.filter((r) => r.dataSourceType === 'consultation_ticket'),
    })

    expect(complaintSnap.aggregates.painPointClustering?.clusteringVersion).toBe('v2.0')

    const sourceSnapshots = {
      complaint_ticket: complaintSnap,
      consultation_ticket: consultationSnap,
    }

    const conclusions = buildOverviewConclusions({
      period,
      feedbacks: records,
      sourceSnapshots,
      crossSourceMetrics: { totalRecords: records.length },
    })

    expect(conclusions.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2')
    expect(conclusions.recommendationsMeta?.legacyFallback).not.toBe(true)
    expect(conclusions.recommendations.length).toBeGreaterThan(0)
    expect(conclusions.recommendations[0].signalType).toBe('pain_cluster_v2')
    expect(conclusions.recommendations[0].sections?.painClusterScores).toBeTruthy()

    const overview = buildOverviewSnapshot({
      insightPeriodId: period.id,
      period,
      feedbacks: records,
      sourceSnapshots,
    })
    expect(overview.conclusions?.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2')
  })

  it('V2 无 Top 10 → 不展示行动建议并写入提示', () => {
    const period = createInsightPeriod({
      label: '2025-06',
      granularity: 'month',
      anchorYear: 2025,
      anchorMonth: 6,
    })
    const records = [
      makeRecord({ painPoint: '', problemSummary: '' }),
      makeRecord({ painPoint: '', problemSummary: '' }),
      makeRecord({ painPoint: '', problemSummary: '' }),
    ]
    const complaintSnap = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'complaint_ticket',
      records,
    })
    const conclusions = buildOverviewConclusions({
      period,
      feedbacks: records,
      sourceSnapshots: { complaint_ticket: complaintSnap },
      crossSourceMetrics: { totalRecords: records.length },
    })
    expect(conclusions.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2')
    expect(conclusions.recommendationsMeta?.legacyFallback).toBe(false)
    expect(conclusions.recommendations).toHaveLength(0)
    expect(conclusions.dataCoverageNotes?.some((n) => n.includes('未形成痛点聚类'))).toBe(true)
  })

  it('低价值剔除备注写入 dataCoverageNotes', () => {
    const period = createInsightPeriod({
      label: '2025-06',
      granularity: 'month',
      anchorYear: 2025,
      anchorMonth: 6,
    })
    const sharedPain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ painPoint: sharedPain }),
      makeRecord({ painPoint: sharedPain }),
      makeRecord({ painPoint: '申请提升带宽配额上限', problemType: '配额与权限申请' }),
      makeRecord({ painPoint: '申请提升带宽配额上限', problemType: '配额与权限申请' }),
    ]
    const complaintSnap = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'complaint_ticket',
      records,
    })
    const conclusions = buildOverviewConclusions({
      period,
      feedbacks: records,
      sourceSnapshots: { complaint_ticket: complaintSnap },
      crossSourceMetrics: { totalRecords: records.length },
    })
    expect(conclusions.dataCoverageNotes?.some((n) => n.includes('剔除') && n.includes('低价值'))).toBe(
      true,
    )
  })
})
