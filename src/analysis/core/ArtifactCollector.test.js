import { describe, it, expect } from 'vitest'
import { ArtifactCollector, excerptText } from './ArtifactCollector.js'

describe('ArtifactCollector', () => {
  it('excerpt truncates long text', () => {
    const long = 'a'.repeat(300)
    expect(excerptText(long).length).toBeLessThanOrEqual(201)
  })

  it('collects lean record artifact without llmRaw by default', async () => {
    const c = new ArtifactCollector('run-1', false)
    const art = await c.addRecordResult({
      recordId: 'r1',
      sourceText: '客户反馈无法访问 192.168.0.1',
      localTags: { journeyL1: '购买' },
      mergedTags: { journeyL1: '购买' },
      mergeReason: 'local',
      llmRaw: { journeyL1: '购买' },
    })
    expect(art.llmRaw).toBeUndefined()
    expect(art.inputTextHash).toBeTruthy()
    expect(art.excerpt).toContain('客户反馈')
  })

  it('stores llmRaw in debug mode', async () => {
    const c = new ArtifactCollector('run-2', true)
    const art = await c.addRecordResult({
      recordId: 'r2',
      sourceText: 'test',
      llmRaw: { x: 1 },
    })
    expect(art.llmRaw).toEqual({ x: 1 })
  })
})
