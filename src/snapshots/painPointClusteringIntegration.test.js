import { describe, expect, it } from 'vitest'
import { createInsightPeriod } from '../domain/insightPeriod.js'
import { buildOverviewConclusions } from './buildOverviewConclusions.js'
import { buildOverviewSnapshot } from './buildOverviewSnapshot.js'
import { buildSourceSnapshot } from './buildSourceSnapshot.js'
import { randomId } from '../lib/randomId.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
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

    expect(complaintSnap.aggregates.painPointClustering?.clusteringVersion).toBe('v2.4')

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

    expect(conclusions.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2_4')
    expect(conclusions.recommendationsMeta?.legacyFallback).not.toBe(true)
    expect(conclusions.recommendations.length).toBeGreaterThan(0)
    expect(['pain_cluster_v2', 'overview_fused_cluster', 'high_risk_singleton']).toContain(
      conclusions.recommendations[0].signalType,
    )
    expect(conclusions.recommendations[0].sections?.painClusterScores).toBeTruthy()

    const overview = buildOverviewSnapshot({
      insightPeriodId: period.id,
      period,
      feedbacks: records,
      sourceSnapshots,
    })
    expect(overview.conclusions?.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2_4')
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
    expect(conclusions.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2_4')
    expect(conclusions.recommendationsMeta?.legacyFallback).toBe(false)
    expect(conclusions.recommendationsMeta?.formalClusterCount || 0).toBe(0)
    expect(conclusions.recommendations.every((rec) => rec.signalType !== 'pain_cluster_v2')).toBe(true)
    expect(
      (conclusions.recommendationsMeta?.fallbackReferenceCount || 0)
        + (conclusions.recommendationsMeta?.singletonCount || 0),
    ).toBeGreaterThanOrEqual(1)
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

  it('v2.4：同因异表象合并、异因同表象拆开（端到端）', () => {
    const period = createInsightPeriod({
      label: '2025-06',
      granularity: 'month',
      anchorYear: 2025,
      anchorMonth: 6,
    })
    // 同因「安全组未放行 22 端口」、不同表象措辞 → 应聚成一类
    // 同表象「公网不通」、不同因 → 应拆开（各自单例）
    const records = [
      makeRecord({
        painPoint: 'SSH 连不上云主机',
        rootCause: '安全组未放行 22 端口',
        rootCauseSource: 'llm',
        journeyL1: '业务使用与连通',
      }),
      makeRecord({
        painPoint: '云主机端口不通',
        rootCause: '安全组未放行 22 端口',
        rootCauseSource: 'llm',
        journeyL1: '业务使用与连通',
      }),
      makeRecord({
        painPoint: '公网不通',
        rootCause: '弹性公网 IP 未绑定到云主机',
        rootCauseSource: 'llm',
        journeyL1: '业务使用与连通',
      }),
      makeRecord({
        painPoint: '公网不通',
        rootCause: '异网访问拥塞',
        rootCauseSource: 'llm',
        journeyL1: '业务使用与连通',
      }),
    ]
    const complaintSnap = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'complaint_ticket',
      records,
    })

    // 源快照一次聚类：同因两条合成一簇，类名为问题原因
    const ppc = complaintSnap.aggregates.painPointClustering
    const productPpc = ppc?.products?.['弹性公网 IP']
    const primary = productPpc?.primaryClusters || []
    const sgwCluster = primary.find((c) => c.causeKey === '安全组未放行22端口')
    expect(sgwCluster).toBeTruthy()
    expect(sgwCluster.ticketCount).toBe(2)
    expect(sgwCluster.representativeCause).toBe('安全组未放行 22 端口')
    // 异因两条「公网不通」不与安全组合并：无 causeKey 相同的簇含 EIP/异网
    const eipCluster = primary.find((c) => c.causeKey === '弹性公网ip未绑定到云主机')
    const congestionCluster = primary.find((c) => c.causeKey === '异网访问拥塞')
    // EIP/异网各 1 条，不足 minSize，应落入 isolated 而非与安全组合并
    expect(eipCluster).toBeFalsy()
    expect(congestionCluster).toBeFalsy()
    const isolatedIds = productPpc?.isolatedRecordIds || []
    expect(isolatedIds.length).toBe(2)
    const isolatedRecords = records.filter((r) => isolatedIds.includes(r.id))
    expect(isolatedRecords.some((r) => r.rootCause === '弹性公网 IP 未绑定到云主机')).toBe(true)
    expect(isolatedRecords.some((r) => r.rootCause === '异网访问拥塞')).toBe(true)

    // 概览行动建议引擎为 v2.4，且无建议把安全组与 EIP/异网混为一类
    const conclusions = buildOverviewConclusions({
      period,
      feedbacks: records,
      sourceSnapshots: { complaint_ticket: complaintSnap },
      crossSourceMetrics: { totalRecords: records.length },
    })
    expect(conclusions.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2_4')
    const allSummaries = conclusions.recommendations.map((r) => r.summary || r.text || '')
    const mixed = allSummaries.find(
      (s) => s.includes('安全组未放行 22 端口') && (s.includes('弹性公网') || s.includes('异网')),
    )
    expect(mixed).toBeFalsy()
  })
})
