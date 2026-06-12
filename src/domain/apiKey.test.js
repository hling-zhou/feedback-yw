import { describe, expect, it } from 'vitest'
import {
  API_KEY_PREFIX,
  isApiKeyFormat,
  isApiKeyScope,
  normalizeApiKeyScopes,
} from './apiKey.js'

describe('apiKey domain', () => {
  it('detects api key format', () => {
    expect(isApiKeyFormat(`${API_KEY_PREFIX}${'a'.repeat(24)}`)).toBe(true)
    expect(isApiKeyFormat('eyJhbGciOiJIUzI1NiJ9.abc.def')).toBe(false)
  })

  it('normalizes scopes', () => {
    expect(
      normalizeApiKeyScopes([
        'requirement_ticket_progress:import',
        'invalid',
        'requirement_ticket_progress:import',
      ]),
    ).toEqual(['requirement_ticket_progress:import'])
    expect(isApiKeyScope('requirement_ticket_progress:import')).toBe(true)
  })
})
