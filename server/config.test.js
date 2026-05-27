import { afterEach, describe, expect, it } from 'vitest'
import {
  assertJwtConfig,
  assertProductionConfig,
  isAutoPublishConfigEnabled,
  resetJwtSecretCacheForTests,
  resolveAdminInitialPassword,
  resolveCorsOrigins,
  resolveJwtSecret,
} from './config.js'

const ENV_KEY = 'JWT_SECRET'

describe('resolveJwtSecret', () => {
  afterEach(() => {
    delete process.env[ENV_KEY]
    resetJwtSecretCacheForTests()
  })

  it('throws when JWT_SECRET is missing', () => {
    delete process.env[ENV_KEY]
    resetJwtSecretCacheForTests()
    expect(() => resolveJwtSecret()).toThrow(/未设置 JWT_SECRET/)
  })

  it('rejects deprecated default secret', () => {
    process.env[ENV_KEY] = 'dev-only-change-me-in-production'
    expect(() => resolveJwtSecret()).toThrow(/已废弃/)
  })

  it('rejects secrets shorter than 16 characters', () => {
    process.env[ENV_KEY] = 'too-short'
    expect(() => resolveJwtSecret()).toThrow(/过短/)
  })

  it('accepts a sufficiently long secret', () => {
    const secret = 'local-test-secret-min-16-chars'
    process.env[ENV_KEY] = secret
    expect(resolveJwtSecret()).toBe(secret)
    expect(assertJwtConfig()).toBeUndefined()
  })
})

describe('resolveAdminInitialPassword', () => {
  const ENV_KEY = 'ADMIN_INITIAL_PASSWORD'

  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it('throws when password is missing', () => {
    expect(() => resolveAdminInitialPassword()).toThrow(/ADMIN_INITIAL_PASSWORD/)
  })

  it('rejects admin123', () => {
    process.env[ENV_KEY] = 'admin123'
    expect(() => resolveAdminInitialPassword()).toThrow(/弱口令/)
  })

  it('rejects passwords shorter than 12 characters', () => {
    process.env[ENV_KEY] = 'short10chr'
    expect(() => resolveAdminInitialPassword()).toThrow(/过短/)
  })

  it('accepts a strong password', () => {
    const password = 'Strong-Local-Dev-Pass-1'
    process.env[ENV_KEY] = password
    expect(resolveAdminInitialPassword()).toBe(password)
  })
})

describe('resolveCorsOrigins', () => {
  const ENV_KEY = 'CORS_ORIGINS'
  const NODE_ENV_KEY = 'NODE_ENV'

  afterEach(() => {
    delete process.env[ENV_KEY]
    delete process.env[NODE_ENV_KEY]
  })

  it('uses dev defaults when unset and not production', () => {
    expect(resolveCorsOrigins()).toEqual([
      'http://127.0.0.1:5175',
      'http://localhost:5175',
    ])
  })

  it('parses comma-separated origins', () => {
    process.env[ENV_KEY] = 'http://127.0.0.1:5175, https://app.example.com'
    expect(resolveCorsOrigins()).toEqual([
      'http://127.0.0.1:5175',
      'https://app.example.com',
    ])
  })

  it('requires CORS_ORIGINS in production', () => {
    process.env[NODE_ENV_KEY] = 'production'
    expect(() => resolveCorsOrigins()).toThrow(/生产环境须设置 CORS_ORIGINS/)
  })

  it('rejects invalid origin scheme', () => {
    process.env[ENV_KEY] = 'ftp://bad.example.com'
    expect(() => resolveCorsOrigins()).toThrow(/无效地址/)
  })
})

describe('assertProductionConfig', () => {
  const NODE_ENV_KEY = 'NODE_ENV'
  const JWT_KEY = 'JWT_SECRET'
  const CORS_KEY = 'CORS_ORIGINS'
  const HOST_KEY = 'API_HOST'
  const ALLOW_KEY = 'ALLOW_BIND_ALL'

  afterEach(() => {
    delete process.env[NODE_ENV_KEY]
    delete process.env[CORS_KEY]
    delete process.env[HOST_KEY]
    delete process.env[ALLOW_KEY]
    resetJwtSecretCacheForTests()
  })

  it('no-op when not production', () => {
    process.env[JWT_KEY] = 'local-test-secret-min-16-chars'
    expect(() => assertProductionConfig()).not.toThrow()
  })

  it('requires JWT_SECRET >= 32 chars in production', () => {
    process.env[NODE_ENV_KEY] = 'production'
    process.env[JWT_KEY] = 'only-sixteen-chars'
    process.env[CORS_KEY] = 'https://app.example.com'
    expect(() => assertProductionConfig()).toThrow(/至少 32 字符/)
  })

  it('requires CORS_ORIGINS in production', () => {
    process.env[NODE_ENV_KEY] = 'production'
    process.env[JWT_KEY] = 'production-jwt-secret-with-32-characters-min'
    delete process.env[CORS_KEY]
    expect(() => assertProductionConfig()).toThrow(/生产环境须设置 CORS_ORIGINS/)
  })

  it('passes with valid production env', () => {
    process.env[NODE_ENV_KEY] = 'production'
    process.env[JWT_KEY] = 'production-jwt-secret-with-32-characters-min'
    process.env[CORS_KEY] = 'https://app.example.com'
    expect(() => assertProductionConfig()).not.toThrow()
  })
})

describe('isAutoPublishConfigEnabled', () => {
  const AUTO_KEY = 'AUTO_PUBLISH_CONFIG'
  const NODE_ENV_KEY = 'NODE_ENV'

  afterEach(() => {
    delete process.env[AUTO_KEY]
    delete process.env[NODE_ENV_KEY]
  })

  it('defaults to true in production', () => {
    process.env[NODE_ENV_KEY] = 'production'
    expect(isAutoPublishConfigEnabled()).toBe(true)
  })

  it('defaults to false in development', () => {
    process.env[NODE_ENV_KEY] = 'development'
    expect(isAutoPublishConfigEnabled()).toBe(false)
  })

  it('respects explicit AUTO_PUBLISH_CONFIG', () => {
    process.env[NODE_ENV_KEY] = 'production'
    process.env[AUTO_KEY] = 'false'
    expect(isAutoPublishConfigEnabled()).toBe(false)
    process.env[NODE_ENV_KEY] = 'development'
    process.env[AUTO_KEY] = 'true'
    expect(isAutoPublishConfigEnabled()).toBe(true)
  })
})
