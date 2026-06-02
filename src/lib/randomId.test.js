import { describe, expect, it } from 'vitest'
import { randomId } from './randomId.js'

describe('randomId', () => {
  it('returns a UUID v4 string', () => {
    const id = randomId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('falls back when randomUUID is unavailable', () => {
    const original = globalThis.crypto.randomUUID
    // @ts-expect-error test stub
    globalThis.crypto.randomUUID = undefined
    try {
      expect(randomId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
    } finally {
      globalThis.crypto.randomUUID = original
    }
  })

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 20 }, () => randomId()))
    expect(ids.size).toBe(20)
  })
})
