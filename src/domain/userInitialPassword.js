import { validatePasswordPolicy } from './passwordPolicy.js'

/**
 * 系统统一初始密码。
 *
 * 用途：新建/导入账号时密码留空 → 后端自动使用它，并把该账号标记为「仍在使用默认密码」；
 * 首次登录被拦截时，把这个明文回传给改密页展示（回传发生在用户名+密码已校验通过之后，
 * 未认证者拿不到），让用户知道该改的是哪一个密码。
 *
 * 可用环境变量 `USER_INITIAL_PASSWORD` 覆盖；覆盖值必须通过密码策略校验。
 */
export const DEFAULT_USER_PASSWORD = 'ywcpb2026@YW'

/**
 * 校验覆盖用的环境变量取值是否合规。
 *
 * @param {string | undefined} raw
 * @returns {{ ok: true; password: string } | { ok: false; message: string }}
 */
export function validateUserInitialPassword(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return { ok: true, password: DEFAULT_USER_PASSWORD }
  const policy = validatePasswordPolicy(value)
  if (!policy.ok) {
    return {
      ok: false,
      message: `[config] USER_INITIAL_PASSWORD ${policy.message}；不设置则使用系统默认密码 ${DEFAULT_USER_PASSWORD}`,
    }
  }
  return { ok: true, password: value }
}
