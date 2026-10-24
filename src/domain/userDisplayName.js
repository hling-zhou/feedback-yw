/**
 * 用户展示名解析：中文名（display_name）优先，空值回退 username。
 * 重名时用「中文名(username)」消歧。
 *
 * 前后端共用，纯函数无副作用。
 */

/**
 * 基本展示名：优先 displayName，回退 username。
 * @param {{ displayName?: string; username?: string } | null | undefined} user
 * @returns {string}
 */
export function resolveDisplayName(user) {
  const dn = String(user?.displayName ?? '').trim()
  if (dn) return dn
  return String(user?.username ?? '').trim()
}

/**
 * 消歧展示名：全局同名 >1 时返回「中文名(username)」。
 *
 * @param {{ displayName?: string; username?: string; id?: string } | null | undefined} user
 * @param {Array<{ displayName?: string; username?: string; id?: string }> | null | undefined} allUsers
 * @returns {string}
 */
export function resolveDisplayNameDisambiguated(user, allUsers) {
  const name = resolveDisplayName(user)
  if (!name) return String(user?.username ?? '').trim()
  const uid = String(user?.id ?? '')
  const dupes = (allUsers || []).filter((u) => {
    const otherUid = String(u?.id ?? '')
    if (otherUid === uid) return false
    return resolveDisplayName(u) === name
  })
  if (dupes.length > 0) {
    const uname = String(user?.username ?? '').trim()
    return uname ? `${name}(${uname})` : name
  }
  return name
}
