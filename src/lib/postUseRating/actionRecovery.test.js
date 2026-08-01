import { describe, expect, it } from 'vitest'
import { buildInsightEvidencePackage, evaluateActionRecovery, listCompletedButNotRecovered } from './actionRecovery.js'

describe('post-use action recovery', () => {
  const action = { id: 'a1', productName: '弹性公网IP', status: 'completed', triggerMetric: { period: '2026-05', value: 8.2, baseline: 9, unit: '分' } }

  it('distinguishes recovered and completed-but-not-recovered', () => {
    expect(evaluateActionRecovery(action, { period: '2026-06', value: 9.1 }).status).toBe('recovered')
    expect(listCompletedButNotRecovered([action], new Map([['弹性公网IP', { period: '2026-06', value: 8.6 }]]))).toHaveLength(1)
  })

  it('builds a traceable evidence package', () => {
    expect(buildInsightEvidencePackage({ productName: '弹性公网IP', need: '缺乏操作指引', evidenceIds: ['r1', 'r1', 'r2'], quotes: ['原话'] })).toMatchObject({ evidenceRecordIds: ['r1', 'r2'], theme: '缺乏操作指引' })
  })
})
