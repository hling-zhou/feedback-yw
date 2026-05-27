import { describe, expect, it } from 'vitest'
import { resolveJourneyDefinition, resolveTagDefinition } from './tagDefinitions.js'

describe('resolveTagDefinition', () => {
  const taxonomy = {
    requestScenes: [
      { label: '报障与恢复', description: '现网异常需恢复', keywords: ['故障'] },
    ],
    problemTypes: [{ label: '性能类', keywords: ['慢', '卡'] }],
    journeys: [
      {
        label: '日常运维',
        description: '一级说明',
        children: [{ label: '使用运维', description: '二级说明', keywords: [] }],
      },
    ],
  }

  it('reads request scene description from taxonomy', () => {
    const def = resolveTagDefinition({
      dimension: 'requestScene',
      label: '报障与恢复',
      taxonomy,
    })
    expect(def.body).toBe('现网异常需恢复')
    expect(def.source).toBe('taxonomy')
  })

  it('falls back to keywords when taxonomy has no description', () => {
    const def = resolveTagDefinition({
      dimension: 'problemType',
      label: '性能类',
      taxonomy,
    })
    expect(def.body).toContain('参考关键词')
    expect(def.source).toBe('keywords')
  })

  it('resolves sentiment from constants', () => {
    const def = resolveTagDefinition({
      dimension: 'sentiment',
      sentimentKey: 'negative',
    })
    expect(def.title).toContain('不满')
    expect(def.body.length).toBeGreaterThan(10)
    expect(def.source).toBe('sentiment')
  })

  it('resolves journey L2 description', () => {
    const def = resolveJourneyDefinition({
      taxonomy,
      journeyL1: '日常运维',
      journeyL2: '使用运维',
    })
    expect(def.title).toContain('日常运维')
    expect(def.body).toBe('二级说明')
  })
})
