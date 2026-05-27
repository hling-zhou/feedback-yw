import jwt from 'jsonwebtoken'
import { resolveJwtSecret } from './config.js'

const JWT_SECRET = resolveJwtSecret()
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

/**
 * @param {import('./users.js').ReturnType<typeof import('./users.js').toPublicUser>} user
 */
export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      team: user.team,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  )
}

/**
 * @param {string} token
 */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (typeof payload !== 'object' || !payload || !payload.sub) return null
    return {
      id: String(payload.sub),
      username: String(payload.username || ''),
      role: String(payload.role || ''),
      team: String(payload.team || ''),
    }
  } catch {
    return null
  }
}
