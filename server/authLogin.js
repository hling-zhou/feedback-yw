import {
  PASSWORD_EXPIRED_CODE,
  PASSWORD_EXPIRED_MESSAGE,
  PASSWORD_MUST_CHANGE_CODE,
  PASSWORD_MUST_CHANGE_MESSAGE,
} from '../src/domain/passwordExpiry.js'
import { logAudit } from './audit.js'
import { resolveUserInitialPassword } from './config.js'
import { signAccessToken } from './auth.js'
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
} from './loginRateLimit.js'
import { verifyPasswordCredentials } from './users.js'

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export async function handlePasswordLogin(request, reply) {
  const body = /** @type {{ username: string; password: string }} */ (request.body)
  const username = body.username.trim()
  const password = body.password

  const rate = checkLoginRateLimit(request, username)
  if (rate.blocked) {
    logAudit({
      username,
      action: 'auth.login_failed',
      detail: { username, reason: 'rate_limited' },
    })
    reply.code(429).send({ error: '登录尝试次数过多，请稍后再试' })
    return
  }

  const verified = await verifyPasswordCredentials(username, password)
  if (!verified) {
    recordLoginFailure(request, username)
    logAudit({
      username,
      action: 'auth.login_failed',
      detail: { username, reason: 'invalid_credentials' },
    })
    reply.code(401).send({ error: '用户名或密码错误' })
    return
  }

  clearLoginFailures(request, username)

  const passwordChangedAt =
    verified.row.password_changed_at || verified.row.created_at || ''

  // 首次登录（含管理员重置密码后）须先改密，不下发 token
  if (Number(verified.row.must_change_password) === 1) {
    logAudit({
      userId: verified.user.id,
      username: verified.user.username,
      action: 'auth.login_failed',
      detail: { username: verified.user.username, reason: 'password_must_change' },
    })
    // 凭据已校验通过才走到这里，故回传默认密码明文不会泄漏给未认证者
    reply.code(403).send({
      code: PASSWORD_MUST_CHANGE_CODE,
      error: PASSWORD_MUST_CHANGE_MESSAGE,
      username: verified.user.username,
      passwordChangedAt,
      ...(verified.user.usesDefaultPassword
        ? { defaultPassword: resolveUserInitialPassword() }
        : {}),
    })
    return
  }

  if (verified.user.passwordExpired) {
    logAudit({
      userId: verified.user.id,
      username: verified.user.username,
      action: 'auth.login_failed',
      detail: { username: verified.user.username, reason: 'password_expired' },
    })
    reply.code(403).send({
      code: PASSWORD_EXPIRED_CODE,
      error: PASSWORD_EXPIRED_MESSAGE,
      username: verified.user.username,
      passwordChangedAt,
    })
    return
  }

  const accessToken = signAccessToken(verified.user, verified.sessionVersion)
  logAudit({
    userId: verified.user.id,
    username: verified.user.username,
    action: 'auth.login',
    detail: { username: verified.user.username },
  })
  return { user: verified.user, accessToken }
}
