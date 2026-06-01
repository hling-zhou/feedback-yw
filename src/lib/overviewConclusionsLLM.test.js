import { describe, expect, it } from 'vitest'
import {
  mergePolishedRecommendation,
  mergePolishedRecommendations,
} from './overviewConclusionsLLM.js'

const baseRuleRec = {
  id: 'rec-journey-1',
  priority: 'high',
  category: 'product',
  text: '在公网访问不通环节补齐自助排查能力',
  summary: '在公网访问不通环节补齐自助排查能力',
  details: ['建立连通性诊断工具', '固化 playbook'],
  evidenceRecordIds: ['uuid-1', 'uuid-2'],
  evidenceTicketIds: ['T-001', 'T-002', 'T-003'],
  evidenceNote: '本期「公网访问不通」32 单，Top 根因「安全组未放行」12 单',
  scope: { journeyL1: '业务使用与连通', journeyL2: '公网访问不通' },
  signalType: 'journey_hotspot',
  metrics: [{ label: '工单数', value: '32' }],
  trackingMetrics: ['环节占比', '协查时长'],
  measureSource: '环节 playbook',
}

describe('overviewConclusionsLLM merge helpers', () => {
  it('mergePolishedRecommendation updates text but preserves evidence fields', () => {
    const merged = mergePolishedRecommendation(baseRuleRec, {
      summary: '在「公网访问不通」环节补齐端到端连通性诊断，减少一线重复协查。',
      details: ['控制台新增连通性诊断', 'TOP 根因固化为 playbook'],
    })

    expect(merged.summary).toMatch(/连通性诊断/)
    expect(merged.text).toBe(merged.summary)
    expect(merged.evidenceTicketIds).toEqual(['T-001', 'T-002', 'T-003'])
    expect(merged.evidenceNote).toBe(baseRuleRec.evidenceNote)
    expect(merged.metrics).toEqual(baseRuleRec.metrics)
    expect(merged.scope).toEqual(baseRuleRec.scope)
    expect(merged.priority).toBe('high')
    expect(merged.measureSource).toBe('环节 playbook')
  })

  it('mergePolishedRecommendation ignores LLM-provided ticket ids in patch object', () => {
    const merged = mergePolishedRecommendation(baseRuleRec, {
      summary: '润色后的概述内容足够长以满足最小长度',
      evidenceTicketIds: ['FAKE-999'],
      evidenceNote: '编造的依据',
    })

    expect(merged.evidenceTicketIds).toEqual(['T-001', 'T-002', 'T-003'])
    expect(merged.evidenceNote).toBe(baseRuleRec.evidenceNote)
  })

  it('mergePolishedRecommendations matches by id when LLM reorders items', () => {
    const ruleRecs = [
      baseRuleRec,
      {
        ...baseRuleRec,
        id: 'rec-problem-2',
        signalType: 'wan_tou',
        summary: '建议围绕「云主机」启动万投比治理专项，建立质量复盘与版本验收机制。',
        details: ['建立万投比专项看板', '每周复盘 Top 根因并跟踪闭环'],
        scope: { product: '云主机' },
        evidenceTicketIds: ['T-010'],
      },
    ]

    const polished = mergePolishedRecommendations(ruleRecs, [
      {
        id: 'rec-problem-2',
        summary: '对万投比 Top 产品启动质量专项治理与复盘机制，纳入版本验收。',
        details: ['建立专项看板', '每周复盘 Top 根因'],
      },
      {
        id: 'rec-journey-1',
        summary: '在公网访问环节上线连通性自助诊断工具，降低一线协查成本。',
        details: ['诊断覆盖安全组与路由', '输出平台/客户侧结论'],
      },
    ])

    expect(polished).toHaveLength(2)
    expect(polished.find((r) => r.id === 'rec-journey-1')?.evidenceTicketIds).toEqual([
      'T-001',
      'T-002',
      'T-003',
    ])
    expect(polished.find((r) => r.id === 'rec-problem-2')?.evidenceTicketIds).toEqual(['T-010'])
  })

  it('mergePolishedRecommendations keeps rule items when LLM returns partial list', () => {
    const ruleRecs = [
      baseRuleRec,
      {
        ...baseRuleRec,
        id: 'rec-problem-2',
        signalType: 'problem_type',
        summary: '建议围绕「公网访问不通」建设标准化排查工具与控制台诊断能力。',
        details: [
          '完善连通性诊断工具，覆盖安全组/ACL/路由',
          '固化 TOP 根因排查 playbook',
        ],
        scope: { product: '弹性公网IP', problemType: '公网访问不通' },
        evidenceTicketIds: ['T-010'],
      },
    ]

    const polished = mergePolishedRecommendations(ruleRecs, [
      {
        id: 'rec-journey-1',
        summary: '在公网访问环节上线连通性自助诊断，降低协查成本。',
        details: ['诊断覆盖安全组', '固化 TOP 根因 playbook'],
      },
    ])

    expect(polished).toHaveLength(2)
    expect(polished.find((r) => r.id === 'rec-problem-2')?.summary).toMatch(/排查工具|诊断/)
    expect(polished.find((r) => r.id === 'rec-problem-2')?.evidenceTicketIds).toEqual(['T-010'])
  })

  it('mergePolishedRecommendation rejects stats-heavy LLM summary and keeps rule text', () => {
    const merged = mergePolishedRecommendation(baseRuleRec, {
      summary: '本期「公网访问不通」32 单（占 20%），主因安全组未放行。',
      details: ['32 单占比 20%', '主因安全组未放行'],
    })

    expect(merged.summary).toBe(baseRuleRec.summary)
    expect(merged.details?.some((d) => /\d+\s*单/.test(d))).toBeFalsy()
  })

  it('mergePolishedRecommendations supports legacy string array by index', () => {
    const polished = mergePolishedRecommendations([baseRuleRec], [
      '在公网访问不通环节补齐端到端连通性诊断工具，减少误判与协查成本。',
    ])

    expect(polished).toHaveLength(1)
    expect(polished[0].summary).toMatch(/连通性诊断/)
    expect(polished[0].evidenceTicketIds).toEqual(['T-001', 'T-002', 'T-003'])
    expect(polished[0].measureSource).toBe('AI 润色')
  })
})
