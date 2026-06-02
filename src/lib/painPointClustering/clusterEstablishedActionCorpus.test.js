import { describe, expect, it } from 'vitest'
import { randomId } from '../randomId.js'
import {
  CLUSTER_ESTABLISHED_ACTION_MIN_TICKETS,
  aggregateEstablishedActionsFromRecords,
  collectClusterEstablishedActions,
  pickClusterEstablishedActionForSynthesis,
} from './clusterEstablishedActionCorpus.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    product: '弹性公网 IP',
    journeyL2: '公网访问不通',
    problemType: '配置与操作',
    createdAt: '2026-03-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('clusterEstablishedActionCorpus', () => {
  it('pickClusterEstablishedActionForSynthesis requires at least 3 tickets', () => {
    const text = '增加 ENI 连通性预检与一键放行引导，降低重复协查。'
    const pool = [
      makeRecord({ establishedAction: text }),
      makeRecord({ id: randomId(), establishedAction: text }),
    ]
    expect(pickClusterEstablishedActionForSynthesis(pool)).toBeNull()

    pool.push(makeRecord({ id: randomId(), establishedAction: text }))
    const picked = pickClusterEstablishedActionForSynthesis(pool)
    expect(picked?.text).toBe(text)
    expect(picked?.count).toBe(CLUSTER_ESTABLISHED_ACTION_MIN_TICKETS)
  })

  it('collectClusterEstablishedActions ignores service-oriented and ticket metadata', () => {
    const pool = [
      makeRecord({ establishedAction: '优化工单流转 SLA 与回访机制，缩短响应时效。' }),
      makeRecord({
        id: randomId(),
        establishedAction: '请求节点：计费咨询--工单标题：测试详细内容：配额提升',
      }),
      makeRecord({
        id: randomId(),
        establishedAction: '完善控制台端口连通性一键检测与放行提示说明。',
      }),
    ]
    const rows = collectClusterEstablishedActions(pool)
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toMatch(/端口连通性/)
  })

  it('aggregateEstablishedActionsFromRecords requires cross-period distinct months', () => {
    const text = '完善控制台端口连通性一键检测与放行提示说明。'
    const sameMonth = [
      makeRecord({ establishedAction: text, createdAt: '2026-03-01T00:00:00.000Z' }),
      makeRecord({ id: randomId(), establishedAction: text, createdAt: '2026-03-10T00:00:00.000Z' }),
      makeRecord({ id: randomId(), establishedAction: text, createdAt: '2026-03-20T00:00:00.000Z' }),
    ]
    expect(aggregateEstablishedActionsFromRecords(sameMonth)).toHaveLength(0)

    const crossMonth = [
      ...sameMonth.slice(0, 2),
      makeRecord({ id: randomId(), establishedAction: text, createdAt: '2026-04-01T00:00:00.000Z' }),
    ]
    const promoted = aggregateEstablishedActionsFromRecords(crossMonth)
    expect(promoted).toHaveLength(1)
    expect(promoted[0].count).toBe(3)
    expect(promoted[0].distinctMonths).toBe(2)
  })
})
