/**
 * 密码定期变更策略 — 使用满 3 个月须修改。
 */

export const PASSWORD_MAX_AGE_DAYS = 90

export const PASSWORD_EXPIRED_CODE = 'PASSWORD_EXPIRED'

export const PASSWORD_EXPIRED_MESSAGE = '密码已使用超过 3 个月，请先修改密码后再登录'

/** 仅「首次登录」须先改密：账号创建后从未成功登录过。管理员重置/代设密码不在此列 */
export const PASSWORD_MUST_CHANGE_CODE = 'PASSWORD_MUST_CHANGE'

export const PASSWORD_MUST_CHANGE_MESSAGE =
  '首次登录须先修改密码，修改完成后请使用新密码重新登录'

/** 毫秒 */
export const PASSWORD_MAX_AGE_MS = PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000

/**
 * @param {string | undefined | null} passwordChangedAt - ISO 8601
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isPasswordExpired(passwordChangedAt, now = new Date()) {
  const text = String(passwordChangedAt ?? '').trim()
  if (!text) return true
  const changed = new Date(text)
  if (Number.isNaN(changed.getTime())) return true
  return now.getTime() - changed.getTime() >= PASSWORD_MAX_AGE_MS
}

/**
 * @param {string | undefined | null} passwordChangedAt
 * @param {Date} [now]
 * @returns {number | null} 剩余天数；已过期返回 0；无效日期返回 null
 */
export function daysUntilPasswordExpiry(passwordChangedAt, now = new Date()) {
  const text = String(passwordChangedAt ?? '').trim()
  if (!text) return 0
  const changed = new Date(text)
  if (Number.isNaN(changed.getTime())) return null
  const expiresAt = changed.getTime() + PASSWORD_MAX_AGE_MS
  const remainingMs = expiresAt - now.getTime()
  if (remainingMs <= 0) return 0
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
}
