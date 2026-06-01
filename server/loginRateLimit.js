const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_WINDOW_MS = 15 * 60 * 1000

/** @type {Map<string, { count: number; resetAt: number }>} */
const buckets = new Map()

function resolveMaxAttempts() {
  const n = Number(process.env.LOGIN_RATE_LIMIT_MAX)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_ATTEMPTS
}

function resolveWindowMs() {
  const n = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_WINDOW_MS
}

/**
 * @param {import('fastify').FastifyRequest} request
 */
export function resolveClientIp(request) {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return request.ip || 'unknown'
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {string} username
 */
function bucketKey(request, username) {
  return `${resolveClientIp(request)}:${username.trim().toLowerCase()}`
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {string} username
 * @returns {{ blocked: boolean; retryAfterSec?: number }}
 */
export function checkLoginRateLimit(request, username) {
  const key = bucketKey(request, username)
  const now = Date.now()
  const entry = buckets.get(key)
  if (!entry || now >= entry.resetAt) {
    return { blocked: false }
  }
  if (entry.count < resolveMaxAttempts()) {
    return { blocked: false }
  }
  return {
    blocked: true,
    retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  }
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {string} username
 */
export function recordLoginFailure(request, username) {
  const key = bucketKey(request, username)
  const now = Date.now()
  const windowMs = resolveWindowMs()
  const entry = buckets.get(key)
  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  entry.count += 1
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {string} username
 */
export function clearLoginFailures(request, username) {
  buckets.delete(bucketKey(request, username))
}

/** @param {import('fastify').FastifyInstance} app */
export function registerLoginRateLimitCleanup(app) {
  app.addHook('onClose', async () => {
    buckets.clear()
  })
}

/** 测试用 */
export function resetLoginRateLimitForTests() {
  buckets.clear()
}
