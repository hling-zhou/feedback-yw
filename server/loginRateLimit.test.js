import { afterEach, describe, expect, it } from 'vitest'
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
  resetLoginRateLimitForTests,
} from './loginRateLimit.js'

/** @returns {import('fastify').FastifyRequest} */
function mockRequest(ip = '127.0.0.1') {
  return /** @type {import('fastify').FastifyRequest} */ ({
    ip,
    headers: {},
  })
}

describe('loginRateLimit', () => {
  afterEach(() => {
    resetLoginRateLimitForTests()
    delete process.env.LOGIN_RATE_LIMIT_MAX
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_MS
  })

  it('blocks after repeated failures', () => {
    process.env.LOGIN_RATE_LIMIT_MAX = '3'
    const req = mockRequest()
    expect(checkLoginRateLimit(req, 'alice').blocked).toBe(false)
    recordLoginFailure(req, 'alice')
    recordLoginFailure(req, 'alice')
    expect(checkLoginRateLimit(req, 'alice').blocked).toBe(false)
    recordLoginFailure(req, 'alice')
    expect(checkLoginRateLimit(req, 'alice').blocked).toBe(true)
  })

  it('clears failures after successful login', () => {
    process.env.LOGIN_RATE_LIMIT_MAX = '2'
    const req = mockRequest()
    recordLoginFailure(req, 'bob')
    recordLoginFailure(req, 'bob')
    expect(checkLoginRateLimit(req, 'bob').blocked).toBe(true)
    clearLoginFailures(req, 'bob')
    expect(checkLoginRateLimit(req, 'bob').blocked).toBe(false)
  })
})
