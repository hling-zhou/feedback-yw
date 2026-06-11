import { describe, expect, it } from 'vitest'
import {
  matchesMyReviewFilter,
  parseMyReviewFilterParam,
} from './userTicketReview.js'

describe('userTicketReview', () => {
  it('parseMyReviewFilterParam accepts done and pending', () => {
    expect(parseMyReviewFilterParam('done')).toBe('done')
    expect(parseMyReviewFilterParam('pending')).toBe('pending')
    expect(parseMyReviewFilterParam('')).toBe('')
    expect(parseMyReviewFilterParam('invalid')).toBe('')
  })

  it('matchesMyReviewFilter filters by done set', () => {
    const done = new Set(['r1'])
    expect(matchesMyReviewFilter('', 'r1', done)).toBe(true)
    expect(matchesMyReviewFilter('done', 'r1', done)).toBe(true)
    expect(matchesMyReviewFilter('done', 'r2', done)).toBe(false)
    expect(matchesMyReviewFilter('pending', 'r1', done)).toBe(false)
    expect(matchesMyReviewFilter('pending', 'r2', done)).toBe(true)
  })
})
