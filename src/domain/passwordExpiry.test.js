import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MAX_AGE_DAYS,
  daysUntilPasswordExpiry,
  isPasswordExpired,
} from './passwordExpiry.js'

describe('passwordExpiry', () => {
  const now = new Date('2026-06-01T12:00:00.000Z')

  it('expires after 90 days', () => {
    const changedAt = '2026-03-01T12:00:00.000Z'
    expect(isPasswordExpired(changedAt, now)).toBe(true)
    expect(daysUntilPasswordExpiry(changedAt, now)).toBe(0)
  })

  it('does not expire within 90 days', () => {
    const changedAt = '2026-03-04T12:00:00.000Z'
    expect(isPasswordExpired(changedAt, now)).toBe(false)
    expect(daysUntilPasswordExpiry(changedAt, now)).toBeGreaterThan(0)
  })

  it('treats missing or invalid changedAt as expired', () => {
    expect(isPasswordExpired('', now)).toBe(true)
    expect(isPasswordExpired(null, now)).toBe(true)
    expect(isPasswordExpired('not-a-date', now)).toBe(true)
  })

  it('PASSWORD_MAX_AGE_DAYS is 90 (3 months)', () => {
    expect(PASSWORD_MAX_AGE_DAYS).toBe(90)
  })
})
