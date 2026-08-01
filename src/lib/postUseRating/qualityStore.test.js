import { describe, expect, it } from 'vitest'
import { buildPostUsePeriodQuality, loadPostUsePeriodQuality, persistPostUsePeriodQuality } from './qualityStore.js'

const catalog = [{ key: 'eip', name: '弹性公网IP', analysisPostUseRating: true, specs: [] }]

describe('post-use period quality', () => {
  it('accounts for dedupe, analysis scope, option evidence and versions', async () => {
    const snapshot = buildPostUsePeriodQuality({
      importMonth: '2026-06',
      catalogProducts: catalog,
      merged: {
        scored: [
          { channel: 'sms', productName: '弹性公网IP', score: 10, scene: '' },
          { channel: 'console', productName: '未启用产品', score: 8, rawComment: '功能有缺失' },
        ],
        options: [{ channel: 'option', productName: '弹性公网IP', rawComment: '缺乏操作指引' }],
        counts: { sourceRows: 5, beforeDedupe: 3, rejected: 1 },
      },
    })
    expect(snapshot.counts).toMatchObject({ raw: 5, rejected: 1, duplicate: 1, analysisScoped: 1, outOfScope: 1, optionEvidence: 1, missingOriginalScene: 2 })
    expect(snapshot.versions.catalog).toMatch(/^catalog-/)

    const meta = new Map()
    const adapter = { getMeta: async (key) => meta.get(key), putMeta: async (key, value) => meta.set(key, value) }
    await persistPostUsePeriodQuality(adapter, snapshot)
    expect(await loadPostUsePeriodQuality(adapter, '2026-06')).toEqual(snapshot)
  })
})
