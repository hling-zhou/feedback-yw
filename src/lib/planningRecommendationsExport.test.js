import { describe, expect, it } from 'vitest'
import { buildClusterActionRecommendations } from './painPointClustering/buildClusterActionRecommendations.js'
import { randomId } from './randomId.js'
import {
  PAIN_CLUSTER_EXPORT_LABELS,
  PAIN_CLUSTER_SECTION_TITLE,
} from './planningRecommendationDisplay.js'
import {
  fallbackRecommendationToExportRow,
  planningRecommendationToExportRow,
} from './planningRecommendationsExport.js'
import { PLANNING_SECTION_LABELS } from './planningRecommendationSections.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    painPoint: '安全组规则未放行导致公网端口无法访问',
    problemType: '配置与操作',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    sentiment: 'negative',
    optimizationProduct: '控制台增加安全组规则冲突检测与一键修复引导',
    ...overrides,
  }
}

describe('planningRecommendationsExport', () => {
  it('exports V2 columns aligned with overview sections', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ painPoint: pain, customerTier: '金牌' }),
      makeRecord({ painPoint: pain, customerTier: '银牌' }),
      makeRecord({ painPoint: pain }),
    ]
    const [rec] = buildClusterActionRecommendations(records)
    expect(rec?.sections?.painClusterScores).toBeTruthy()

    const row = planningRecommendationToExportRow(rec, 0)
    expect(row[PAIN_CLUSTER_EXPORT_LABELS.priorityScore]).toBeGreaterThan(0)
    expect(row[PAIN_CLUSTER_EXPORT_LABELS.rank]).toMatch(/\//)
    expect(row[PAIN_CLUSTER_EXPORT_LABELS.currentPain]).toBe(rec.summary)
    expect(row[PLANNING_SECTION_LABELS.productActions]).toBeTruthy()
    expect(row).not.toHaveProperty('类别')
    expect(row).not.toHaveProperty('详细意见1')
    expect(row).not.toHaveProperty('导出全文')
    expect(row).not.toHaveProperty(PAIN_CLUSTER_SECTION_TITLE)
    expect(row).not.toHaveProperty('跟进状态')
    expect(row).not.toHaveProperty('负责人')
    expect(row).not.toHaveProperty('目标日期')
    expect(row).not.toHaveProperty('备注')
  })

  it('does not include legacy-only columns', () => {
    const row = planningRecommendationToExportRow(
      {
        id: 'legacy-1',
        priority: 'high',
        category: 'product',
        summary: '在公网访问环节补齐诊断工具',
        text: '在公网访问环节补齐诊断工具',
        details: ['新增连通性诊断'],
      },
      0,
    )
    expect(row[PAIN_CLUSTER_EXPORT_LABELS.priorityScore]).toBe('')
    expect(row[PAIN_CLUSTER_EXPORT_LABELS.currentPain]).toBe('在公网访问环节补齐诊断工具')
    expect(row).not.toHaveProperty('概述')
    expect(row).not.toHaveProperty('已合并同类信号')
  })

  it('exports fallback recommendations without V2 score fields', () => {
    const row = fallbackRecommendationToExportRow(
      {
        id: 'fallback-1',
        stableKey: 'pfr-1',
        signalType: 'journey_problem_fallback',
        priority: 'low',
        category: 'product',
        summary: '控制台配置路径不清晰',
        text: '控制台配置路径不清晰',
        scope: {
          product: '云专线',
          journeyL1: '订购开通',
          journeyL2: '加急开通',
          problemType: '配置与操作',
        },
        evidenceBundle: { ticketCount: 3 },
        evidenceStrength: 'weak',
        evidenceNote: '小产品频次兜底：订购开通→加急开通 × 配置与操作',
        generationMeta: { selectedReason: '按旅程×问题类型频次推断' },
      },
      0,
    )
    expect(row['类型']).toBe('小样本参考项')
    expect(row['工单数']).toBe(3)
    expect(row).not.toHaveProperty(PAIN_CLUSTER_EXPORT_LABELS.priorityScore)
    expect(row['依据说明']).toContain('频次兜底')
  })
})
