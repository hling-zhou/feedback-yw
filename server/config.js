/** @type {string | null} */
let jwtSecretCache = null

/** @type {ReadonlySet<string>} */
const FORBIDDEN_JWT_SECRETS = new Set(['dev-only-change-me-in-production'])

const MIN_JWT_SECRET_LENGTH = 16

/** @type {ReadonlySet<string>} */
const FORBIDDEN_ADMIN_PASSWORDS = new Set(['admin123', 'password', '123456', 'admin'])

const MIN_ADMIN_INITIAL_PASSWORD_LENGTH = 12

/** 开发环境未配置 CORS_ORIGINS 时的默认前端地址 */
const DEFAULT_DEV_CORS_ORIGINS = ['http://127.0.0.1:5175', 'http://localhost:5175']

/**
 * 解析并校验 JWT 签名密钥（无默认值，禁止已知弱密钥）
 * @returns {string}
 */
export function resolveJwtSecret() {
  if (jwtSecretCache) return jwtSecretCache

  const raw = process.env.JWT_SECRET?.trim()
  if (!raw) {
    throw new Error(
      '[config] 未设置 JWT_SECRET。启动前请执行：export JWT_SECRET="<至少16字符的随机串>"\n' +
        '  可参考 .env.example，说明见 README.md「环境变量」。',
    )
  }
  if (FORBIDDEN_JWT_SECRETS.has(raw)) {
    throw new Error(
      '[config] JWT_SECRET 不能使用已废弃的内置默认值，请更换为强随机密钥（建议 ≥32 字符）。',
    )
  }
  if (raw.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `[config] JWT_SECRET 过短（当前 ${raw.length} 字符），至少需要 ${MIN_JWT_SECRET_LENGTH} 字符。`,
    )
  }

  jwtSecretCache = raw
  return jwtSecretCache
}

/** 启动时显式校验（与 resolveJwtSecret 等价，便于 index 调用） */
export function assertJwtConfig() {
  resolveJwtSecret()
}

/**
 * 空库首次启动时解析初始管理员密码（无默认值）
 * @returns {string}
 */
export function resolveAdminInitialPassword() {
  const raw = process.env.ADMIN_INITIAL_PASSWORD?.trim()
  if (!raw) {
    throw new Error(
      '[config] 数据库尚无用户，须设置 ADMIN_INITIAL_PASSWORD（≥12 字符）以创建首个管理员。\n' +
        '  示例：export ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 18)"\n' +
        '  说明见 README.md「环境变量」。',
    )
  }
  if (FORBIDDEN_ADMIN_PASSWORDS.has(raw)) {
    throw new Error(
      '[config] ADMIN_INITIAL_PASSWORD 不能使用常见弱口令（如 admin123），请设置强密码。',
    )
  }
  if (raw.length < MIN_ADMIN_INITIAL_PASSWORD_LENGTH) {
    throw new Error(
      `[config] ADMIN_INITIAL_PASSWORD 过短（当前 ${raw.length} 字符），至少需要 ${MIN_ADMIN_INITIAL_PASSWORD_LENGTH} 字符。`,
    )
  }
  return raw
}

/**
 * 空库时校验可创建管理员；已有用户则跳过
 * @param {boolean} hasUsers
 */
export function assertAdminSeedConfig(hasUsers) {
  if (hasUsers) return
  resolveAdminInitialPassword()
}

/**
 * 解析允许的浏览器 Origin 列表（逗号分隔）
 * @returns {string[]}
 */
export function resolveCorsOrigins() {
  const raw = process.env.CORS_ORIGINS?.trim()
  if (raw) {
    const origins = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!origins.length) {
      throw new Error('[config] CORS_ORIGINS 不能为空列表。')
    }
    for (const o of origins) {
      if (!/^https?:\/\//.test(o)) {
        throw new Error(`[config] CORS_ORIGINS 含无效地址 "${o}"，须为 http(s):// 开头。`)
      }
    }
    return origins
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[config] 生产环境须设置 CORS_ORIGINS（逗号分隔），例如：\n' +
        '  CORS_ORIGINS=https://insights.example.com',
    )
  }

  return [...DEFAULT_DEV_CORS_ORIGINS]
}

/** @returns {{ origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => void; credentials: boolean }} */
export function getCorsRegisterOptions() {
  const allowed = resolveCorsOrigins()
  const allowedSet = new Set(allowed)

  return {
    origin(origin, cb) {
      if (!origin || allowedSet.has(origin)) {
        cb(null, true)
        return
      }
      cb(new Error(`CORS: origin not allowed: ${origin}`), false)
    },
    credentials: true,
  }
}

export function assertCorsConfig() {
  resolveCorsOrigins()
}

/** 生产环境额外校验（须在 JWT / CORS 基础校验之后调用） */
export function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return

  const jwt = process.env.JWT_SECRET?.trim() || ''
  if (jwt.length < 32) {
    throw new Error(
      '[config] 生产环境 JWT_SECRET 至少 32 字符，请使用 openssl rand -base64 32 生成。',
    )
  }

  resolveCorsOrigins()

  const host = process.env.API_HOST || '127.0.0.1'
  if (host === '0.0.0.0' && process.env.ALLOW_BIND_ALL !== 'true') {
    throw new Error(
      '[config] 生产环境监听 0.0.0.0 须显式设置 ALLOW_BIND_ALL=true，并确保前方有反向代理与 TLS。',
    )
  }
}

/** 仅用于单元测试：清空缓存并可选择设置 process.env.JWT_SECRET */
export function resetJwtSecretCacheForTests() {
  jwtSecretCache = null
}

/**
 * 标签/产品目录保存后是否自动写 public/config（Excel/JSON 备份）。
 * 生产默认开；开发默认关。显式 AUTO_PUBLISH_CONFIG=true|false 优先。
 */
export function isAutoPublishConfigEnabled() {
  const raw = process.env.AUTO_PUBLISH_CONFIG?.trim().toLowerCase()
  if (raw === 'true' || raw === '1' || raw === 'yes') return true
  if (raw === 'false' || raw === '0' || raw === 'no') return false
  return process.env.NODE_ENV === 'production'
}
