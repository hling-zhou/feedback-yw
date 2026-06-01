import { describe, expect, it } from 'vitest'
import { validatePasswordPolicy } from './passwordPolicy.js'

describe('validatePasswordPolicy', () => {
  it('accepts a strong password', () => {
    expect(validatePasswordPolicy('Abcdef1!').ok).toBe(true)
  })

  it('rejects short passwords', () => {
    expect(validatePasswordPolicy('Ab1!').ok).toBe(false)
  })

  it('requires upper, lower, digit, and special', () => {
    expect(validatePasswordPolicy('abcdef1!').ok).toBe(false)
    expect(validatePasswordPolicy('ABCDEF1!').ok).toBe(false)
    expect(validatePasswordPolicy('Abcdefgh!').ok).toBe(false)
    expect(validatePasswordPolicy('Abcdefg1').ok).toBe(false)
  })
})
