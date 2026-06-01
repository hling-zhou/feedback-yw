import { describe, expect, it } from 'vitest'
import {
  buildEstablishedActionSavePatch,
  ESTABLISHED_ACTION_MAX_LENGTH,
  getEstablishedActionDisplay,
  normalizeEstablishedActionInput,
} from './establishedAction.js'

describe('establishedAction', () => {
  it('getEstablishedActionDisplay prefers establishedAction over manualReviewOptimization', () => {
    expect(
      getEstablishedActionDisplay({
        establishedAction: '新确立',
        manualReviewOptimization: '旧人工',
      }),
    ).toBe('新确立')
  })

  it('getEstablishedActionDisplay falls back to manualReviewOptimization', () => {
    expect(
      getEstablishedActionDisplay({
        establishedAction: '',
        manualReviewOptimization: 'legacy 人工',
      }),
    ).toBe('legacy 人工')
  })

  it('buildEstablishedActionSavePatch dual-writes normalized text', () => {
    expect(buildEstablishedActionSavePatch('  举措  ')).toEqual({
      establishedAction: '举措',
      manualReviewOptimization: '举措',
    })
  })

  it('normalizeEstablishedActionInput caps length', () => {
    expect(normalizeEstablishedActionInput('x'.repeat(ESTABLISHED_ACTION_MAX_LENGTH + 3)).length).toBe(
      ESTABLISHED_ACTION_MAX_LENGTH,
    )
  })
})
