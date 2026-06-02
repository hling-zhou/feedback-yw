import { describe, expect, it } from 'vitest'
import { randomId } from '../randomId.js'
import {
  CLUSTER_SYNTHESIZED_ACTION_COUNT,
  synthesizeClusterProductActions,
} from './clusterActionSynthesis.js'
import { buildClusterActionRecommendations } from './buildClusterActionRecommendations.js'

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
    ...overrides,
  }
}

describe('clusterActionSynthesis', () => {
  it('synthesizes exactly 2 actions from pain + journey + problem type', () => {
    const pool = [
      makeRecord(),
      makeRecord({ id: randomId() }),
    ]
    const actions = synthesizeClusterProductActions(
      {
        id: 'rec-1',
        scope: { product: '弹性公网 IP' },
        generationMeta: { representativePain: '安全组规则未放行导致公网端口无法访问' },
      },
      pool,
      '安全组规则未放行导致公网端口无法访问',
    )
    expect(actions).toHaveLength(CLUSTER_SYNTHESIZED_ACTION_COUNT)
    expect(actions[0]).toMatch(/安全组规则未放行/)
    expect(actions[0]).not.toMatch(/针对「|集中反馈|环节关于/)
    expect(actions[1]).toMatch(/配置与操作|控制台|排查|playbook/i)
  })

  it('synthesizes billing/quota cluster actions without ticket metadata or SLA service lines', () => {
    const pool = [
      makeRecord({
        product: '弹性公网 IP',
        journeyL1: '认知与选型',
        journeyL2: '计费模式咨询',
        problemType: '人工服务与流程',
        painPoint:
          '请求节点：计费咨询--计费咨询工单标题：计费咨询详细内容：关于广州资源池需要将三个共享带宽的弹性公网IP数量提升至40。',
      }),
      makeRecord({
        id: randomId(),
        product: '弹性公网 IP',
        journeyL1: '认知与选型',
        journeyL2: '计费模式咨询',
        problemType: '人工服务与流程',
        painPoint:
          '请求节点：计费咨询--计费咨询工单标题：计费咨询详细内容：关于广州资源池需要将1个共享带宽的弹性公网IP数量提升至40。',
      }),
    ]
    const actions = synthesizeClusterProductActions(
      {
        id: 'rec-billing',
        scope: { product: '弹性公网 IP', journeyL2: '计费模式咨询' },
        generationMeta: { representativePain: pool[0].painPoint },
      },
      pool,
    )
    expect(actions).toHaveLength(2)
    const joined = actions.join('\n')
    expect(joined).not.toMatch(/请求节点|工单标题|SLA|回访|工单流转|针对「/)
    expect(joined).not.toMatch(/计费模式咨询/)
    expect(joined).toMatch(/配额|计费|控制台|FAQ|广州资源池/)
  })
})

describe('buildClusterActionRecommendations with synthesis', () => {
  it('uses cluster synthesis instead of ticket optimization excerpts', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ painPoint: pain, optimizationProduct: '不应直接摘录的单条优化建议内容。' }),
      makeRecord({ painPoint: pain, optimizationProduct: '也不应参与聚类的旧自动建议。' }),
    ]
    const recs = buildClusterActionRecommendations(records)
    expect(recs[0]?.sections?.productActions).toHaveLength(2)
    const joined = recs[0]?.sections?.productActions?.join('\n') || ''
    expect(joined).toMatch(/安全组规则未放行/)
    expect(joined).not.toMatch(/不应直接摘录/)
    expect(recs[0]?.measureSource).toBe('群组规则合成')
    expect(recs[0]?.productActionsSource).toBe('synth')
  })
})
