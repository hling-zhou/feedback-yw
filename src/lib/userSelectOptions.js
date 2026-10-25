import { resolveDisplayNameDisambiguated } from '../domain/userDisplayName.js'

/**
 * 构建人员下拉选项（antd Select options 元素）。
 *
 * label 中文名优先，无中文名回退账号；全局重名时用「中文名(账号)」消歧。
 * 额外挂 username / displayName 字段，供 userOptionFilterOption 做双字段搜索。
 *
 * @param {{ id?: string; username?: string; displayName?: string } | null | undefined} user
 * @param {Array<{ id?: string; username?: string; displayName?: string }>} [allUsers] 用于重名消歧的全量用户列表
 * @returns {{ value: string | undefined; label: string; username: string; displayName: string }}
 */
export function buildUserOption(user, allUsers = []) {
  const label = resolveDisplayNameDisambiguated(user, allUsers) || String(user?.id ?? '')
  return {
    value: user?.id,
    label,
    username: String(user?.username ?? '').trim(),
    displayName: String(user?.displayName ?? '').trim(),
  }
}

/**
 * antd Select filterOption：label / username / displayName 三路不区分大小写子串匹配。
 * 兼容 antd 内部把 option 原始数据包在 option.data 里的形态。
 *
 * @param {string} input
 * @param {Record<string, unknown> | null | undefined} option
 * @returns {boolean}
 */
export function userOptionFilterOption(input, option) {
  const kw = String(input ?? '').trim().toLowerCase()
  if (!kw) return true
  const record = /** @type {Record<string, unknown> | null | undefined} */ (option?.data ?? option)
  return [record?.label, record?.username, record?.displayName].some((field) =>
    String(field ?? '').toLowerCase().includes(kw),
  )
}
