import { describe, expect, it } from 'vitest'
import { randomId } from './randomId.js'
import {
  collectPlanningPlaybookActionLines,
  detectProductActionsSource,
  inferPlanningJourneyContext,
  measureSourceLabelForProductActions,
} from './planningPlaybook.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
    product: '弹性公网 IP',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    problemType: '可用性/连通性故障',
    ...overrides,
  }
}

describe('planningPlaybook', () => {
  it('inferPlanningJourneyContext picks dominant L2', () => {
    const ctx = inferPlanningJourneyContext([
      makeRecord(),
      makeRecord({ id: randomId(), journeyL2: '公网访问不通' }),
    ])
    expect(ctx?.l2).toBe('公网访问不通')
    expect(ctx?.l1).toBe('业务使用与连通')
  })

  it('collectPlanningPlaybookActionLines returns actionable lines', () => {
    const lines = collectPlanningPlaybookActionLines({
      records: [makeRecord(), makeRecord({ id: randomId() })],
      product: '弹性公网 IP',
      problemType: '可用性/连通性故障',
    })
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).toMatch(/排查|诊断|playbook|连通/i)
  })

  it('detectProductActionsSource distinguishes ticket, playbook and mixed', () => {
    expect(
      detectProductActionsSource(['建立端口诊断工具。', '完善控制台引导。'], [
        '建立端口诊断工具。',
        '完善控制台引导。',
      ]),
    ).toBe('ticket')

    expect(
      detectProductActionsSource(['优化账单展示说明。'], ['完善连通性诊断工具与 TOP 场景 playbook。'], {
        usedPlaybookFallback: true,
      }),
    ).toBe('playbook')

    expect(
      detectProductActionsSource(['优化账单展示说明。'], ['优化账单展示说明。', '完善连通性诊断工具。'], {
        usedAlignmentReplacement: true,
      }),
    ).toBe('mixed')
  })

  it('measureSourceLabelForProductActions maps labels', () => {
    expect(measureSourceLabelForProductActions('synth+manual')).toBe('群组规则合成（含确立举措）')
    expect(measureSourceLabelForProductActions('synth')).toBe('群组规则合成')
    expect(measureSourceLabelForProductActions('playbook')).toBe('环节 playbook')
    expect(measureSourceLabelForProductActions('mixed')).toBe('cluster_mixed')
    expect(measureSourceLabelForProductActions('ticket')).toBe('cluster_rule')
  })

  it('detectProductActionsSource returns synth+manual when established action used in synthesis', () => {
    expect(
      detectProductActionsSource(['单条优化'], ['主题举措', '确立举措'], {
        usedClusterSynthesis: true,
        usedEstablishedActionInSynthesis: true,
      }),
    ).toBe('synth+manual')
  })

  it('detectProductActionsSource returns synth when cluster synthesis used', () => {
    expect(
      detectProductActionsSource(['单条优化'], ['针对群组痛点合成举措一', '合成举措二'], {
        usedClusterSynthesis: true,
      }),
    ).toBe('synth')
  })
})
