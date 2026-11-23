const TOKEN_KEY = 'fi_access_token'

// 11-23 拍板（方案 A）：token 迁 localStorage——sessionStorage 每 tab 独立 session，
// 报告页 target=_blank 链接（溯源/举措）新 tab 必丢会话跳登录页（真机报障）。
// localStorage 同 origin 跨 tab 共享：在线页新 tab 直达、邮件链接在常用浏览器直达。
// token 有效期不变（7 天 JWT）；退出登录 clearStoredToken 全局登出，其他 tab 刷新即跳登录。
export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

/** @param {string} token */
export function setStoredToken(token) {
  sessionStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
  if (!token) return
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken() {
  sessionStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function apiFetch(path, init = {}) {
  const token = getStoredToken()
  const headers = new Headers(init.headers || {})
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(path, { ...init, headers })
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { error: text }
    }
  }

  if (!res.ok) {
    const message =
      data?.error ||
      data?.message ||
      (typeof data === 'string' ? data : null) ||
      res.statusText ||
      '请求失败'
    const err = new Error(
      res.status === 404 && message === 'Not Found'
        ? '接口不存在（404）：请确认 API 已启动并已重启（npm run dev:all）'
        : message,
    )
    err.status = res.status
    err.data = data
    if (data && typeof data === 'object' && data.code) {
      err.code = data.code
    }
    throw err
  }
  return data
}
