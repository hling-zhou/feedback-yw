import { describe, expect, it } from 'vitest'
import {
  breadthScoreFromShare,
  buildJourneyClusterView,
  buildJourneyClusterViewFromSnapshot,
  buildSourcePainPointClusterSnapshot,
  resolveJourneyClusterViewForDisplay,
  clusterByJaccard,
  hierarchicalClusterValidNaive,
  filterLowValuePrimaryClusters,
  getEmotionIntensity,
  getP90EmotionIntensity,
  getSeverityFromProblemType,
  jaccardSimilarity,
  runPrimaryClustering,
  runProductClusteringPipeline,
  runMultiProductClusteringPipeline,
  runSecondaryClustering,
  scoreAndRankFinalClusters,
  tokenizePainPointText,
  tokenSetFromPainPoint,
  PRIMARY_CLUSTER_THRESHOLD,
} from './index.js'
import { percentile90 } from './emotionIntensity.js'
import { getMaxSeverity } from './severity.js'
import {
  buildPrimaryClusterLabel,
  buildFinalClusterLabel,
  majorityProblemType,
  pickRepresentativePainPoint,
  getRecordPainPoint,
} from './clusterLabel.js'
import { computeClusterScores } from './priorityScore.js'
import { buildClusterActionRecommendations } from './buildClusterActionRecommendations.js'

function makeRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    rawText: 'test',
    createdAt: '2025-06-15T10:00:00Z',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    problemType: '可用性/连通性故障',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    sentiment: 'negative',
    painPoint: '公网IP无法访问外网连接失败',
    ...overrides,
  }
}

describe('painPointClustering/textTokenize', () => {
  it('tokenizes Chinese pain points with unigram and bigram tokens', () => {
    const tokens = tokenizePainPointText('公网IP无法访问外网')
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.some((t) => t.includes('公网') || t.includes('访问'))).toBe(true)
  })

  it('jaccardSimilarity returns 1 for identical token sets', () => {
    const a = tokenSetFromPainPoint('带宽超限导致网速很慢')
    const b = tokenSetFromPainPoint('带宽超限导致网速很慢')
    expect(jaccardSimilarity(a, b)).toBe(1)
  })

  it('jaccardSimilarity returns higher score for similar texts', () => {
    const a = tokenSetFromPainPoint('带宽超限导致网速很慢无法正常使用')
    const b = tokenSetFromPainPoint('带宽超限导致网络很慢无法正常使用')
    const c = tokenSetFromPainPoint('账单金额计算错误多扣费用')
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(jaccardSimilarity(a, c))
  })
})

describe('painPointClustering/jaccardHierarchical', () => {
  it('clusters items with similar pain text and isolates singletons', () => {
    const items = [
      { id: 'a', text: '安全组规则配置错误导致端口不通' },
      { id: 'b', text: '安全组规则配置错误导致端口无法访问' },
      { id: 'c', text: '账单金额异常多扣费用' },
    ]
    const { clusters, isolated } = clusterByJaccard(
      items,
      (x) => x.text,
      PRIMARY_CLUSTER_THRESHOLD,
      2,
    )
    expect(clusters.length).toBe(1)
    expect(clusters[0]).toHaveLength(2)
    expect(isolated).toHaveLength(1)
    expect(isolated[0].id).toBe('c')
  })
})

describe('painPointClustering/filterLowValue', () => {
  it('excludes 配额与权限申请 and 其他 primary clusters', () => {
    const primary = [
      {
        id: 'p1',
        problemType: '配额与权限申请',
        ticketCount: 3,
        recordIds: ['a', 'b', 'c'],
      },
      {
        id: 'p2',
        problemType: '配置与操作',
        ticketCount: 2,
        recordIds: ['d', 'e'],
      },
      {
        id: 'p3',
        problemType: '其他',
        ticketCount: 4,
        recordIds: ['f', 'g', 'h', 'i'],
      },
    ]
    const { retained, excluded, excludedClusterCount, excludedTicketCount } =
      filterLowValuePrimaryClusters(primary)
    expect(retained).toHaveLength(1)
    expect(retained[0].id).toBe('p2')
    expect(excluded).toHaveLength(2)
    expect(excludedClusterCount).toBe(2)
    expect(excludedTicketCount).toBe(7)
  })
})

describe('painPointClustering/primaryCluster', () => {
  it('groups by product × dataSource × journeyL1 and clusters similar pains', () => {
    const product = '弹性公网 IP'
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ product, painPoint: pain, journeyL1: '业务使用与连通' }),
      makeRecord({ product, painPoint: pain, journeyL1: '业务使用与连通' }),
      makeRecord({
        product,
        painPoint: '账单金额计算错误多扣费用',
        journeyL1: '业务使用与连通',
        problemType: '计费与账单',
      }),
      makeRecord({
        product,
        dataSourceType: 'consultation_ticket',
        painPoint: pain,
        journeyL1: '业务使用与连通',
      }),
      makeRecord({
        product,
        dataSourceType: 'consultation_ticket',
        painPoint: pain,
        journeyL1: '业务使用与连通',
      }),
    ]
    const { primaryClusters, isolatedRecords } = runPrimaryClustering(records, product)
    const complaintL1 = primaryClusters.filter(
      (c) => c.dataSourceType === 'complaint_ticket' && c.journeyL1 === '业务使用与连通',
    )
    expect(complaintL1.some((c) => c.ticketCount === 2)).toBe(true)
    expect(primaryClusters.some((c) => c.dataSourceType === 'consultation_ticket')).toBe(true)
    expect(isolatedRecords.length).toBeGreaterThanOrEqual(1)
  })
})

describe('painPointClustering/secondaryCluster', () => {
  it('merges similar primary clusters across sources', () => {
    const pain = '带宽超限导致网速很慢无法正常使用'
    const primary = [
      {
        id: 'p1',
        product: '云专线',
        dataSourceType: 'complaint_ticket',
        journeyL1: '使用运维',
        label: '云专线-投诉-使用运维-' + pain,
        representativePainPoint: pain,
        problemType: '性能问题',
        recordIds: ['r1', 'r2'],
        ticketCount: 2,
      },
      {
        id: 'p2',
        product: '云专线',
        dataSourceType: 'consultation_ticket',
        journeyL1: '配置部署',
        label: '云专线-咨询-配置部署-' + pain,
        representativePainPoint: pain + '咨询反馈',
        problemType: '性能问题',
        recordIds: ['r3', 'r4'],
        ticketCount: 2,
      },
    ]
    const finals = runSecondaryClustering(primary, '云专线')
    expect(finals.length).toBeGreaterThanOrEqual(1)
    expect(finals[0].primaryGroups.length).toBeGreaterThanOrEqual(1)
    expect(finals[0].ticketCount).toBe(4)
  })
})

describe('painPointClustering/priorityScore', () => {
  it('maps share percentage to breadth score bands', () => {
    expect(breadthScoreFromShare(0.5)).toBe(1)
    expect(breadthScoreFromShare(2)).toBe(2)
    expect(breadthScoreFromShare(5)).toBe(3)
    expect(breadthScoreFromShare(10)).toBe(4)
    expect(breadthScoreFromShare(20)).toBe(5)
  })

  it('computes harm score from severity and P90 emotion', () => {
    expect(getSeverityFromProblemType('可用性/连通性故障')).toBe(5)
    const records = [
      makeRecord({ sentiment: 'strong_negative', urgencyLevel: 'high' }),
      makeRecord({ sentiment: 'negative' }),
      makeRecord({ sentiment: 'mild_negative' }),
    ]
    const p90 = getP90EmotionIntensity(records)
    expect(p90).toBeGreaterThanOrEqual(getEmotionIntensity(records[1]))
  })

  it('ranks final clusters by priority score and limits to top N', () => {
    const allRecords = [
      makeRecord({ id: 'a1', painPoint: 'A' }),
      makeRecord({ id: 'a2', painPoint: 'A' }),
      makeRecord({ id: 'b1', painPoint: 'B' }),
      makeRecord({ id: 'b2', painPoint: 'B' }),
    ]
    const finals = [
      {
        id: 'f1',
        product: '弹性公网 IP',
        label: 'cluster-a',
        representativePainPoint: 'A',
        primaryGroups: [],
        recordIds: ['a1', 'a2'],
        ticketCount: 2,
      },
      {
        id: 'f2',
        product: '弹性公网 IP',
        label: 'cluster-b',
        representativePainPoint: 'B',
        primaryGroups: [],
        recordIds: ['b1', 'b2'],
        ticketCount: 2,
      },
    ]
    const top = scoreAndRankFinalClusters(finals, allRecords, 4, 10)
    expect(top).toHaveLength(2)
    expect(top[0].rank).toBe(1)
    expect(top[1].rank).toBe(2)
    expect(top[0].sharePct).toBe(50)
  })
})

describe('painPointClustering/runProductClusteringPipeline', () => {
  it('runs full pipeline with exclusion stats', () => {
    const product = '弹性公网 IP'
    const sharedPain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ product, painPoint: sharedPain, problemType: '配置与操作' }),
      makeRecord({ product, painPoint: sharedPain, problemType: '配置与操作' }),
      makeRecord({
        product,
        painPoint: '申请提升带宽配额上限',
        problemType: '配额与权限申请',
      }),
      makeRecord({
        product,
        painPoint: '申请提升带宽配额上限',
        problemType: '配额与权限申请',
      }),
    ]
    const result = runProductClusteringPipeline(records, product)
    expect(result.clusteringVersion).toBe('v2.0')
    expect(result.productTotalTickets).toBe(4)
    expect(result.excludedPrimaryClusterCount).toBeGreaterThanOrEqual(1)
    expect(result.excludedPrimaryTicketCount).toBe(2)
    expect(Array.isArray(result.topFinalClusters)).toBe(true)
  })
})

describe('painPointClustering/buildJourneyClusterView', () => {
  it('filters cluster ticket counts by journeyL2 subset', () => {
    const product = '弹性公网 IP'
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({
        product,
        painPoint: pain,
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
      }),
      makeRecord({
        product,
        painPoint: pain,
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
      }),
      makeRecord({
        product,
        painPoint: pain,
        journeyL1: '业务使用与连通',
        journeyL2: '其他二级环节',
      }),
    ]
    const l1View = buildJourneyClusterView({
      records,
      product,
      dataSourceType: 'complaint_ticket',
      journeyL1: '业务使用与连通',
    })
    expect(l1View.groups.some((g) => g.ticketCount === 3)).toBe(true)

    const l2View = buildJourneyClusterView({
      records,
      product,
      dataSourceType: 'complaint_ticket',
      journeyL1: '业务使用与连通',
      journeyL2: '公网访问不通',
    })
    expect(l2View.groups.some((g) => g.ticketCount === 2)).toBe(true)
    expect(l2View.groups.every((g) => g.ticketCount > 0)).toBe(true)
  })
})

// =============================================================================
// P0: 附录 A - 问题类型严重度完整映射 (12 类)
// =============================================================================
describe('P0: severity - 附录 A 完整映射', () => {
  it('所有 12 类问题类型 → 基准严重度', () => {
    const expected = {
      '可用性/连通性故障': 5,
      '性能问题': 4,
      '计费与账单': 5,
      '配额与权限申请': 1,
      '资源开通与创建': 5,
      '配置与操作': 5,
      '退订与释放': 5,
      '界面与操作易用性': 3,
      '产品功能需求': 3,
      '产品功能咨询': 2,
      '人工服务与流程': 1,
      '其他': 0,
    }
    for (const [type, score] of Object.entries(expected)) {
      expect(getSeverityFromProblemType(type), `问题类型「${type}」`).toBe(score)
    }
  })

  it('getMaxSeverity 取群内最大值', () => {
    const records = [
      makeRecord({ problemType: '配额与权限申请' }), // 1
      makeRecord({ problemType: '性能问题' }), // 4
      makeRecord({ problemType: '可用性/连通性故障' }), // 5
    ]
    expect(getMaxSeverity(records)).toBe(5)
  })

  it('未识别的 problemType → 默认 0', () => {
    expect(getSeverityFromProblemType('')).toBe(0)
    expect(getSeverityFromProblemType(undefined)).toBe(0)
    expect(getSeverityFromProblemType('未知类型')).toBe(0)
  })
})

// =============================================================================
// P0: 附录 B - 情绪烈度完整映射
// =============================================================================
describe('P0: emotionIntensity - 附录 B 完整映射', () => {
  it('6 种情绪基础分全部正确', () => {
    const expected = {
      positive: 1,
      neutral_inquiry: 1,
      neutral_pending: 2,
      mild_negative: 3,
      negative: 4,
      strong_negative: 5,
    }
    for (const [sentiment, score] of Object.entries(expected)) {
      const record = makeRecord({ sentiment })
      expect(getEmotionIntensity(record), `情绪「${sentiment}」`).toBe(score)
    }
  })

  it('加急标记 +0.5 (上限 5)', () => {
    expect(getEmotionIntensity(makeRecord({ sentiment: 'negative', urgencyLevel: 'high' }))).toBe(4.5)
    expect(getEmotionIntensity(makeRecord({ sentiment: 'mild_negative', urgencyLevel: 'high' }))).toBe(3.5)
    expect(getEmotionIntensity(makeRecord({ sentiment: 'positive', urgencyLevel: 'high' }))).toBe(1.5)
  })

  it('strong_negative + 加急 = 上限 5 (不超过)', () => {
    const record = makeRecord({ sentiment: 'strong_negative', urgencyLevel: 'high' })
    expect(getEmotionIntensity(record)).toBe(5)
  })

  it('percentile90 边界测试', () => {
    expect(percentile90([])).toBe(0)
    expect(percentile90([3])).toBe(3)
    expect(percentile90([1, 2])).toBe(2) // ceil(0.9*2)-1 = 1, sorted[1]=2
    expect(percentile90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9) // ceil(0.9*10)-1 = 8, sorted[8]=9
  })

  it('getP90EmotionIntensity 空数组返回 0', () => {
    expect(getP90EmotionIntensity([])).toBe(0)
  })
})

// =============================================================================
// P0: 评分公式精确验证
// =============================================================================
describe('P0: computeClusterScores 精确公式', () => {
  it('危害度 = maxSeverity×0.6 + P90Emotion×0.4', () => {
    const records = [
      makeRecord({ problemType: '可用性/连通性故障', sentiment: 'negative' }), // severity=5, emotion=4
    ]
    const scores = computeClusterScores(records, 100)
    expect(scores.harmScore).toBeCloseTo(5 * 0.6 + 4 * 0.4, 5) // 3.0 + 1.6 = 4.6
  })

  it('优先级 = breadth×0.5 + harm×0.5', () => {
    const records = [
      makeRecord({ problemType: '性能问题', sentiment: 'mild_negative' }), // severity=4, emotion=3
      makeRecord({ problemType: '性能问题', sentiment: 'mild_negative' }),
    ]
    const scores = computeClusterScores(records, 100) // sharePct=2%, breadth=2
    // harm = 4*0.6 + 3*0.4 = 2.4 + 1.2 = 3.6
    // priority = 2*0.5 + 3.6*0.5 = 1.0 + 1.8 = 2.8
    expect(scores.breadthScore).toBe(2)
    expect(scores.harmScore).toBeCloseTo(3.6, 5)
    expect(scores.priorityScore).toBeCloseTo(2.8, 5)
  })

  it('分母为产品全部工单 (不剔除)', () => {
    const records = Array.from({ length: 5 }, () => makeRecord())
    const scores = computeClusterScores(records, 200) // 5/200 = 2.5%
    expect(scores.sharePct).toBeCloseTo(2.5, 5)
    expect(scores.breadthScore).toBe(2) // 1-3% → 2
  })

  it('影响广度分档边界', () => {
    expect(breadthScoreFromShare(0)).toBe(1)
    expect(breadthScoreFromShare(0.99)).toBe(1)
    expect(breadthScoreFromShare(1)).toBe(2)
    expect(breadthScoreFromShare(2.99)).toBe(2)
    expect(breadthScoreFromShare(3)).toBe(3)
    expect(breadthScoreFromShare(7.99)).toBe(3)
    expect(breadthScoreFromShare(8)).toBe(4)
    expect(breadthScoreFromShare(14.99)).toBe(4)
    expect(breadthScoreFromShare(15)).toBe(5)
    expect(breadthScoreFromShare(100)).toBe(5)
  })
})

// =============================================================================
// P0: 并列排序 + Top 10 截断
// =============================================================================
describe('P0: scoreAndRankFinalClusters 并列排序与截断', () => {
  it('优先级分相同 → 危害度高的排前面', () => {
    const allRecords = [
      makeRecord({ id: 'a1', problemType: '性能问题', sentiment: 'negative' }),
      makeRecord({ id: 'a2', problemType: '性能问题', sentiment: 'negative' }),
      makeRecord({ id: 'b1', problemType: '可用性/连通性故障', sentiment: 'negative' }),
      makeRecord({ id: 'b2', problemType: '可用性/连通性故障', sentiment: 'negative' }),
    ]
    const finals = [
      { id: 'f1', product: 'P', label: 'A', representativePainPoint: 'A', primaryGroups: [], recordIds: ['a1', 'a2'], ticketCount: 2 },
      { id: 'f2', product: 'P', label: 'B', representativePainPoint: 'B', primaryGroups: [], recordIds: ['b1', 'b2'], ticketCount: 2 },
    ]
    const top = scoreAndRankFinalClusters(finals, allRecords, 4, 10)
    // f2 has higher severity (5 vs 4) → higher harm → should rank first
    expect(top[0].id).toBe('f2')
    expect(top[0].harmScore).toBeGreaterThan(top[1].harmScore)
  })

  it('超过 10 个 → 只取 Top 10', () => {
    const allRecords = Array.from({ length: 30 }, (_, i) => makeRecord({ id: `r${i}` }))
    const finals = Array.from({ length: 15 }, (_, i) => ({
      id: `f${i}`,
      product: 'P',
      label: `cluster-${i}`,
      representativePainPoint: `pain-${i}`,
      primaryGroups: [],
      recordIds: [`r${i * 2}`, `r${i * 2 + 1}`],
      ticketCount: 2,
    }))
    const top = scoreAndRankFinalClusters(finals, allRecords, 30, 10)
    expect(top).toHaveLength(10)
    expect(top[0].rank).toBe(1)
    expect(top[9].rank).toBe(10)
    expect(top[0].totalFinal).toBe(10)
  })

  it('不足 10 个 → 全部返回, totalFinal = scored.length', () => {
    const allRecords = [makeRecord({ id: 'r1' }), makeRecord({ id: 'r2' })]
    const finals = [{
      id: 'f1', product: 'P', label: 'X', representativePainPoint: 'X',
      primaryGroups: [], recordIds: ['r1', 'r2'], ticketCount: 2,
    }]
    const top = scoreAndRankFinalClusters(finals, allRecords, 2, 10)
    expect(top).toHaveLength(1)
    expect(top[0].totalFinal).toBe(1)
  })
})

// =============================================================================
// P0: 二次聚类边界
// =============================================================================
describe('P0: runSecondaryClustering 边界', () => {
  it('空输入 → 返回空数组', () => {
    expect(runSecondaryClustering([], '产品')).toEqual([])
  })

  it('跨 L1 环节合并', () => {
    const pain = '安全组规则未放行导致端口不通'
    const primary = [
      { id: 'p1', product: 'EIP', dataSourceType: 'complaint_ticket', journeyL1: '配置与部署', label: 'L1', representativePainPoint: pain, problemType: '配置与操作', recordIds: ['r1', 'r2'], ticketCount: 2 },
      { id: 'p2', product: 'EIP', dataSourceType: 'complaint_ticket', journeyL1: '使用运维', label: 'L2', representativePainPoint: pain, problemType: '配置与操作', recordIds: ['r3', 'r4'], ticketCount: 2 },
    ]
    const finals = runSecondaryClustering(primary, 'EIP')
    expect(finals.length).toBeGreaterThanOrEqual(1)
    expect(finals[0].ticketCount).toBe(4)
  })

  it('recordIds 去重', () => {
    const pain = '带宽超限导致性能下降'
    const primary = [
      { id: 'p1', product: 'P', dataSourceType: 'complaint_ticket', journeyL1: 'L1', label: 'L1', representativePainPoint: pain, problemType: '性能问题', recordIds: ['r1', 'r2', 'r3'], ticketCount: 3 },
      { id: 'p2', product: 'P', dataSourceType: 'consultation_ticket', journeyL1: 'L2', label: 'L2', representativePainPoint: pain + '问题', problemType: '性能问题', recordIds: ['r2', 'r3', 'r4'], ticketCount: 3 },
    ]
    const finals = runSecondaryClustering(primary, 'P')
    expect([...finals[0].recordIds].sort()).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(finals[0].ticketCount).toBe(4)
  })

  it('minClusterSize=1 → 单个一次群组不被丢弃', () => {
    const primary = [{
      id: 'p1', product: 'P', dataSourceType: 'complaint_ticket', journeyL1: 'L1',
      label: '唯一群组', representativePainPoint: '安全组规则未放行导致端口不通',
      problemType: '配置与操作', recordIds: ['r1', 'r2'], ticketCount: 2,
    }]
    const finals = runSecondaryClustering(primary, 'P')
    expect(finals).toHaveLength(1)
    expect(finals[0].ticketCount).toBe(2)
  })
})

// =============================================================================
// P0: filterLowValue 边界
// =============================================================================
describe('P0: filterLowValuePrimaryClusters 边界', () => {
  it('全部低价值 → retained 为空', () => {
    const primary = [
      { id: 'p1', problemType: '配额与权限申请', ticketCount: 3, recordIds: ['a', 'b', 'c'] },
      { id: 'p2', problemType: '其他', ticketCount: 2, recordIds: ['d', 'e'] },
    ]
    const { retained, excluded, excludedClusterCount, excludedTicketCount } = filterLowValuePrimaryClusters(primary)
    expect(retained).toHaveLength(0)
    expect(excluded).toHaveLength(2)
    expect(excludedClusterCount).toBe(2)
    expect(excludedTicketCount).toBe(5)
  })

  it('剔除的群组不出现在二次聚类结果中', () => {
    const product = 'EIP'
    const pain = '安全组规则未放行导致端口不通'
    const records = [
      makeRecord({ product, painPoint: pain, problemType: '配置与操作' }),
      makeRecord({ product, painPoint: pain, problemType: '配置与操作' }),
      makeRecord({ product, painPoint: '申请提升带宽配额', problemType: '配额与权限申请' }),
      makeRecord({ product, painPoint: '申请提升带宽配额', problemType: '配额与权限申请' }),
    ]
    const result = runProductClusteringPipeline(records, product)
    const allRecordIdsInFinals = result.topFinalClusters.flatMap((c) => c.recordIds)
    expect(allRecordIdsInFinals).not.toContain(records[2].id)
    expect(allRecordIdsInFinals).not.toContain(records[3].id)
  })
})

// =============================================================================
// P1: §8 行动建议字段完整性
// =============================================================================
describe('P1: buildClusterActionRecommendations 字段完整性', () => {
  it('painClusterScores 含 harmScore, maxSeverity, p90Emotion', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ painPoint: pain, problemType: '可用性/连通性故障', sentiment: 'strong_negative' }),
      makeRecord({ painPoint: pain, problemType: '可用性/连通性故障', sentiment: 'negative' }),
    ]
    const recs = buildClusterActionRecommendations(records)
    expect(recs.length).toBeGreaterThanOrEqual(1)
    const scores = recs[0].sections?.painClusterScores
    expect(scores).toBeDefined()
    expect(scores.harmScore).toBeGreaterThan(0)
    expect(scores.maxSeverity).toBe(5)
    expect(scores.p90Emotion).toBeGreaterThan(0)
  })

  it('sourceDistributionLines 格式正确', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ painPoint: pain, dataSourceType: 'complaint_ticket', journeyL1: '配置与部署' }),
      makeRecord({ painPoint: pain, dataSourceType: 'complaint_ticket', journeyL1: '配置与部署' }),
      makeRecord({ painPoint: pain, dataSourceType: 'consultation_ticket', journeyL1: '使用运维' }),
      makeRecord({ painPoint: pain, dataSourceType: 'consultation_ticket', journeyL1: '使用运维' }),
    ]
    const recs = buildClusterActionRecommendations(records)
    expect(recs.length).toBeGreaterThanOrEqual(1)
    const lines = recs[0]?.sections?.painClusterScores?.sourceDistributionLines
    expect(lines).toBeDefined()
    expect(lines.length).toBeGreaterThanOrEqual(1)
    expect(lines[0]).toMatch(/(投诉|咨询)：\d+件（占比\d+%）/)
  })

  it('productActions 至少 2 条', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ painPoint: pain, optimizationProduct: '增加安全组规则冲突检测' }),
      makeRecord({ painPoint: pain, optimizationProduct: '提供一键修复功能' }),
    ]
    const recs = buildClusterActionRecommendations(records)
    expect(recs[0]?.sections?.productActions?.length).toBeGreaterThanOrEqual(2)
  })

  it('evidenceRecordIds 包含群组全部工单 ID', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ id: 'r1', painPoint: pain }),
      makeRecord({ id: 'r2', painPoint: pain }),
    ]
    const recs = buildClusterActionRecommendations(records)
    expect(recs[0]?.evidenceRecordIds).toEqual(expect.arrayContaining(['r1', 'r2']))
  })

  it('多产品 → 各产品独立建议并按分数排序', () => {
    const pain1 = '安全组规则未放行导致公网端口无法访问'
    const pain2 = '账单金额计算错误多扣费用'
    const records = [
      makeRecord({ product: 'EIP', painPoint: pain1, problemType: '可用性/连通性故障', sentiment: 'strong_negative' }),
      makeRecord({ product: 'EIP', painPoint: pain1, problemType: '可用性/连通性故障', sentiment: 'negative' }),
      makeRecord({ product: '计费', painPoint: pain2, problemType: '计费与账单', sentiment: 'negative' }),
      makeRecord({ product: '计费', painPoint: pain2, problemType: '计费与账单', sentiment: 'mild_negative' }),
    ]
    const recs = buildClusterActionRecommendations(records)
    expect(recs.length).toBeGreaterThanOrEqual(2)
    const products = recs.map((r) => r.scope?.product)
    expect(products).toContain('EIP')
    expect(products).toContain('计费')
    // 排序: 优先级分高的在前
    const scores = recs.map((r) => r.generationMeta?.score ?? 0)
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1])
  })
})

// =============================================================================
// P1: runMultiProductClusteringPipeline
// =============================================================================
describe('P1: runMultiProductClusteringPipeline', () => {
  it('多产品 → 各产品独立 pipeline', () => {
    const records = [
      makeRecord({ product: 'EIP', painPoint: '安全组规则未放行导致端口不通' }),
      makeRecord({ product: 'EIP', painPoint: '安全组规则未放行导致端口不通' }),
      makeRecord({ product: 'VPC', painPoint: '路由表配置错误导致网络不通' }),
      makeRecord({ product: 'VPC', painPoint: '路由表配置错误导致网络不通' }),
    ]
    const results = runMultiProductClusteringPipeline(records)
    expect(results.length).toBe(2)
    expect(results.map((r) => r.product)).toEqual(expect.arrayContaining(['EIP', 'VPC']))
  })

  it('指定 product → 只跑该产品', () => {
    const records = [
      makeRecord({ product: 'EIP', painPoint: '安全组规则未放行导致端口不通' }),
      makeRecord({ product: 'EIP', painPoint: '安全组规则未放行导致端口不通' }),
      makeRecord({ product: 'VPC', painPoint: '路由表配置错误导致网络不通' }),
    ]
    const results = runMultiProductClusteringPipeline(records, 'EIP')
    expect(results).toHaveLength(1)
    expect(results[0].product).toBe('EIP')
  })
})

// =============================================================================
// P2: 一次聚类空值 / 缺失回退
// =============================================================================
describe('P2: primaryCluster 空值与缺失回退', () => {
  it('painPoint 为空 → 跳过该工单', () => {
    const product = 'EIP'
    const records = [
      makeRecord({ product, painPoint: '安全组规则未放行导致端口不通' }),
      makeRecord({ product, painPoint: '安全组规则未放行导致端口不通' }),
      makeRecord({ product, painPoint: '', problemSummary: '' }),
      makeRecord({ product, painPoint: undefined }),
    ]
    const { primaryClusters, isolatedRecords } = runPrimaryClustering(records, product)
    const totalInClusters = primaryClusters.reduce((sum, c) => sum + c.ticketCount, 0)
    expect(totalInClusters).toBe(2)
    expect(isolatedRecords).toHaveLength(0)
  })

  it('journeyL1 缺失 → 回退为「未识别环节」', () => {
    const product = 'EIP'
    const pain = '安全组规则未放行导致端口不通'
    const records = [
      makeRecord({ product, painPoint: pain, journeyL1: undefined }),
      makeRecord({ product, painPoint: pain, journeyL1: '' }),
    ]
    const { primaryClusters } = runPrimaryClustering(records, product)
    expect(primaryClusters.some((c) => c.journeyL1 === '未识别环节')).toBe(true)
  })

  it('getRecordPainPoint 优先 painPoint, 回退 problemSummary', () => {
    expect(getRecordPainPoint({ painPoint: '痛点A', problemSummary: '摘要B' })).toBe('痛点A')
    expect(getRecordPainPoint({ painPoint: '', problemSummary: '摘要B' })).toBe('摘要B')
    expect(getRecordPainPoint({ painPoint: undefined, problemSummary: '' })).toBe('')
  })
})

// =============================================================================
// P2: clusterLabel 辅助函数
// =============================================================================
describe('P2: clusterLabel 辅助函数', () => {
  it('majorityProblemType 取多数票; 并列取先遇到的', () => {
    expect(majorityProblemType([
      makeRecord({ problemType: '性能问题' }),
      makeRecord({ problemType: '性能问题' }),
      makeRecord({ problemType: '配置与操作' }),
    ])).toBe('性能问题')

    expect(majorityProblemType([
      makeRecord({ problemType: '性能问题' }),
      makeRecord({ problemType: '配置与操作' }),
    ])).toBe('性能问题')
  })

  it('pickRepresentativePainPoint 最高频; 并列取更长', () => {
    expect(pickRepresentativePainPoint([
      makeRecord({ painPoint: 'A' }),
      makeRecord({ painPoint: 'A' }),
      makeRecord({ painPoint: 'B' }),
    ])).toBe('A')

    expect(pickRepresentativePainPoint([
      makeRecord({ painPoint: '短' }),
      makeRecord({ painPoint: '更长的痛点描述' }),
    ])).toBe('更长的痛点描述')
  })

  it('buildPrimaryClusterLabel 格式: 产品-来源-L1-痛点(≤40字)', () => {
    const label = buildPrimaryClusterLabel({
      product: '弹性公网 IP',
      dataSourceType: 'complaint_ticket',
      journeyL1: '配置与部署',
      representativePainPoint: '安全组规则未放行导致公网端口无法访问这是一个很长的描述超过四十个字符',
    })
    expect(label).toMatch(/^弹性公网 IP-投诉-配置与部署-/)
    const painPart = label.split('-').slice(3).join('-')
    expect(painPart.length).toBeLessThanOrEqual(40)
  })

  it('buildFinalClusterLabel 空 label → 回退 pickRepresentativePainPoint', () => {
    expect(buildFinalClusterLabel('', [])).toBe('未命名痛点群组')
    expect(buildFinalClusterLabel('  ', [])).toBe('未命名痛点群组')
    expect(buildFinalClusterLabel('有效标签', [])).toBe('有效标签')
  })
})

// =============================================================================
// P2: 旅程 Tab 边缘
// =============================================================================
describe('P2: buildJourneyClusterView 边缘', () => {
  it('isolatedCount + isolatedSamples 正确', () => {
    const product = 'EIP'
    const pain = '安全组规则未放行导致端口不通'
    const records = [
      makeRecord({ product, painPoint: pain, journeyL1: '配置与部署' }),
      makeRecord({ product, painPoint: pain, journeyL1: '配置与部署' }),
      makeRecord({ product, painPoint: '独特的痛点描述与其他都不同', journeyL1: '配置与部署' }),
    ]
    const view = buildJourneyClusterView({
      records,
      product,
      dataSourceType: 'complaint_ticket',
      journeyL1: '配置与部署',
    })
    expect(view.isolatedCount).toBeGreaterThanOrEqual(1)
    expect(view.isolatedSamples.length).toBeGreaterThanOrEqual(1)
  })

  it('L2 过滤后 ticketCount=0 的群组被剔除', () => {
    const product = 'EIP'
    const pain = '安全组规则未放行导致端口不通'
    const records = [
      makeRecord({ product, painPoint: pain, journeyL1: 'L1', journeyL2: 'L2-A' }),
      makeRecord({ product, painPoint: pain, journeyL1: 'L1', journeyL2: 'L2-A' }),
    ]
    const view = buildJourneyClusterView({
      records,
      product,
      dataSourceType: 'complaint_ticket',
      journeyL1: 'L1',
      journeyL2: 'L2-B', // 无匹配
    })
    expect(view.groups).toHaveLength(0)
  })

  it('无产品匹配 → 空 groups', () => {
    const records = [makeRecord({ product: 'EIP' })]
    const view = buildJourneyClusterView({
      records,
      product: 'VPC',
      dataSourceType: 'complaint_ticket',
      journeyL1: '配置与部署',
    })
    expect(view.groups).toHaveLength(0)
    expect(view.isolatedCount).toBe(0)
  })

  it('dataSourceType 过滤生效', () => {
    const product = 'EIP'
    const pain = '安全组规则未放行导致端口不通'
    const records = [
      makeRecord({ product, painPoint: pain, dataSourceType: 'complaint_ticket', journeyL1: 'L1' }),
      makeRecord({ product, painPoint: pain, dataSourceType: 'complaint_ticket', journeyL1: 'L1' }),
      makeRecord({ product, painPoint: pain, dataSourceType: 'consultation_ticket', journeyL1: 'L1' }),
    ]
    const view = buildJourneyClusterView({
      records,
      product,
      dataSourceType: 'complaint_ticket',
      journeyL1: 'L1',
    })
    const totalTickets = view.groups.reduce((sum, g) => sum + g.ticketCount, 0)
    expect(totalTickets).toBe(2)
  })
})

describe('M1: clusterByJaccard exact pre-merge', () => {
  it('merges identical normalized pain points without hierarchical clustering', () => {
    const items = [
      { id: '1', text: '安全组规则未放行导致公网端口无法访问' },
      { id: '2', text: '安全组规则未放行导致公网端口无法访问' },
      { id: '3', text: '  安全组  规则未放行导致公网端口无法访问  ' },
    ]
    const { clusters, isolated } = clusterByJaccard(
      items,
      (x) => x.text,
      0.99,
      2,
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(3)
    expect(isolated).toHaveLength(0)
  })

  it('keeps semantically similar unique texts mergeable via hierarchical step', () => {
    const items = [
      { id: '1', text: '带宽超限导致性能下降' },
      { id: '2', text: '带宽超限导致性能下降问题' },
    ]
    const { clusters, isolated } = clusterByJaccard(items, (x) => x.text, 0.2, 1)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(2)
    expect(isolated).toHaveLength(0)
  })
})

describe('M2: sparse average linkage vs naive', () => {
  /**
   * @param {string[][]} clusters
   */
  function clusterSignature(clusters) {
    return clusters
      .map((c) =>
        [...c]
          .map((x) => x.id)
          .sort()
          .join(','),
      )
      .sort()
      .join('|')
  }

  it('matches naive clustering on small synthetic set', () => {
    const items = [
      { id: '1', text: '安全组规则未放行导致公网端口无法访问' },
      { id: '2', text: '安全组规则未放行导致公网端口无法访问问题' },
      { id: '3', text: '带宽超限导致性能下降' },
      { id: '4', text: '带宽超限导致性能下降问题' },
      { id: '5', text: '完全不同的独立痛点描述' },
    ]
    const sparse = clusterByJaccard(items, (x) => x.text, 0.2, 2)
    const valid = items.map((item) => ({
      item,
      tokens: tokenSetFromPainPoint(item.text),
    }))
    const tokenSets = valid.map((v) => v.tokens)
    const naiveResult = hierarchicalClusterValidNaive(valid, tokenSets, 0.2, 2)
    expect(clusterSignature(sparse.clusters)).toBe(clusterSignature(naiveResult.clusters))
  })
})

describe('L0-1: resolveJourneyClusterViewForDisplay / snapshot', () => {
  it('reads primary clusters from source snapshot and matches live slice', () => {
    const product = '弹性公网 IP'
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({
        product,
        painPoint: pain,
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
      }),
      makeRecord({
        product,
        painPoint: pain,
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
      }),
      makeRecord({
        product,
        painPoint: pain,
        journeyL1: '业务使用与连通',
        journeyL2: '其他二级环节',
      }),
    ]
    const snapshot = buildSourcePainPointClusterSnapshot(records)
    const productClustering = snapshot.products[product]

    const fromSnapshot = buildJourneyClusterViewFromSnapshot({
      productClustering,
      records,
      product,
      dataSourceType: 'complaint_ticket',
      journeyL1: '业务使用与连通',
      journeyL2: '公网访问不通',
    })
    expect(fromSnapshot.clusterSource).toBe('snapshot')
    expect(fromSnapshot.groups.some((g) => g.ticketCount === 2)).toBe(true)

    const live = buildJourneyClusterView({
      records,
      product,
      dataSourceType: 'complaint_ticket',
      journeyL1: '业务使用与连通',
      journeyL2: '公网访问不通',
    })
    expect(fromSnapshot.groups[0]?.ticketCount).toBe(live.groups[0]?.ticketCount)
  })

  it('intersects snapshot clusters with current scoped records (resource pool filter)', () => {
    const product = 'EIP'
    const pain = '安全组规则未放行导致端口不通'
    const allRecords = [
      makeRecord({ product, painPoint: pain, journeyL1: 'L1', resourcePool: '池A' }),
      makeRecord({ product, painPoint: pain, journeyL1: 'L1', resourcePool: '池A' }),
      makeRecord({ product, painPoint: pain, journeyL1: 'L1', resourcePool: '池B' }),
    ]
    const snapshot = buildSourcePainPointClusterSnapshot(allRecords)
    const scoped = allRecords.filter((r) => r.resourcePool === '池A')

    const view = buildJourneyClusterViewFromSnapshot({
      productClustering: snapshot.products[product],
      records: scoped,
      product,
      dataSourceType: 'complaint_ticket',
      journeyL1: 'L1',
    })
    expect(view.groups[0]?.ticketCount).toBe(2)
  })

  it('falls back to frequency when snapshot missing', () => {
    const product = 'EIP'
    const records = [
      makeRecord({ product, painPoint: '痛点A', journeyL1: 'L1' }),
      makeRecord({ product, painPoint: '痛点A', journeyL1: 'L1' }),
    ]
    const view = resolveJourneyClusterViewForDisplay({
      painPointClustering: null,
      records,
      product,
      dataSourceType: 'complaint_ticket',
      journeyL1: 'L1',
    })
    expect(view.clusterSource).toBe('frequency_fallback')
    expect(view.groups).toEqual([])
    expect(view.frequencyPainPoints[0]?.ticketCount).toBe(2)
  })
})
