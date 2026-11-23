import jwt from 'jsonwebtoken'
import { resolveJwtSecret } from './config.js'

// 11-23 拍板：token 有效期 7 天 → 48 小时（token 迁 localStorage 后跨 tab 长效共享，
// 失窃窗口相应收紧；2 天覆盖工作日 + 周末补登录一次的频率，内网可接受）
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '48h'

function getJwtSecret() {
  return resolveJwtSecret()
}

/**
 * @param {import('./users.js').ReturnType<typeof import('./users.js').toPublicUser>} user
 * @param {number} sessionVersion
 */
export function signAccessToken(user, sessionVersion = 0) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      team: user.team,
      sv: sessionVersion,
    },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN },
  )
}

/**
 * @param {string} token
 */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, getJwtSecret())
    if (typeof payload !== 'object' || !payload || !payload.sub) return null
    const sv = Number(payload.sv)
    return {
      id: String(payload.sub),
      username: String(payload.username || ''),
      role: String(payload.role || ''),
      team: String(payload.team || ''),
      sessionVersion: Number.isFinite(sv) && sv >= 0 ? sv : -1,
    }
  } catch {
    return null
  }
}
