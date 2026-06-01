const TOKEN_KEY = 'fi_access_token'

export function getStoredToken() {
  return sessionStorage.getItem(TOKEN_KEY) || ''
}

/** @param {string} token */
export function setStoredToken(token) {
  sessionStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
  if (!token) return
  sessionStorage.setItem(TOKEN_KEY, token)
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
