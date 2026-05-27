import { describe, expect, it } from 'vitest'
import { chunkRecordsForUpload } from './recordUploadChunks.js'

describe('chunkRecordsForUpload', () => {
  it('splits when batch exceeds maxCount', () => {
    const records = Array.from({ length: 100 }, (_, i) => ({ id: String(i), t: 'x' }))
    const chunks = chunkRecordsForUpload(records, { maxBytes: 10_000_000, maxCount: 40, minCount: 1 })
    expect(chunks.length).toBe(3)
    expect(chunks[0].length).toBe(40)
    expect(chunks[1].length).toBe(40)
    expect(chunks[2].length).toBe(20)
  })

  it('splits oversized single record alone', () => {
    const big = { id: '1', body: 'a'.repeat(3_000_000) }
    const chunks = chunkRecordsForUpload([big, { id: '2' }], {
      maxBytes: 100_000,
      maxCount: 80,
      minCount: 1,
    })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0]).toHaveLength(1)
    expect(chunks[0][0].id).toBe('1')
  })
})
