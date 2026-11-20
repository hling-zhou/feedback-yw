import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { getStoredToken } from '../lib/apiClient.js'
import { resolveUsageModule } from '../lib/usageModuleMap.js'

const API_BASE = import.meta.env.VITE_API_BASE || ''

/**
 * 发送页面访问记录到服务端。
 * 用 fetch + keepalive 替代 sendBeacon：既支持自定义 Authorization header，
 * 又能在页面卸载时可靠发出（keepalive 等效于 sendBeacon 的不阻塞行为）。
 * @param {string} pathname
 * @param {{ username?: string; team?: string; role?: string } | null} userInfo
 */
function trackPageView(pathname, userInfo) {
  try {
    const module = resolveUsageModule(pathname)
    if (module === 'other') return

    const payload = JSON.stringify({
      module,
      page: pathname,
      params: {},
      // 用户信息冗余发一份，服务端从 JWT 解析为准
      username: userInfo?.username,
      team: userInfo?.team,
      role: userInfo?.role,
    })

    const headers = { 'Content-Type': 'application/json' }
    const token = getStoredToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    fetch(`${API_BASE}/api/usage/track`, {
      method: 'POST',
      headers,
      body: payload,
      keepalive: true,
    }).catch(() => { /* 采集失败不影响用户使用 */ })
  } catch {
    // 采集失败不影响用户使用
  }
}

/**
 * 手动发送一条模块访问记录（用于非路由切换的场景，如打开 Drawer 详情）。
 * @param {string} module
 * @param {Record<string, unknown>} [params]
 */
export function trackUsage(module, params) {
  try {
    const payload = JSON.stringify({ module, params: params ?? {} })
    const headers = { 'Content-Type': 'application/json' }
    const token = getStoredToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    fetch(`${API_BASE}/api/usage/track`, {
      method: 'POST',
      headers,
      body: payload,
      keepalive: true,
    }).catch(() => { /* 静默失败 */ })
  } catch {
    // 静默失败
  }
}

/**
 * 在 AppShell 级别注入：监听路由变化，自动采集页面访问。
 * 需要传入 user 信息（从 AuthContext）。
 * @param {{ username?: string; team?: string; role?: string } | null} user
 */
export function useUsageTracking(user) {
  const location = useLocation()
  const userInfoRef = useRef(user)
  userInfoRef.current = user

  useEffect(() => {
    if (!user) return
    trackPageView(location.pathname, userInfoRef.current)
  }, [location.pathname, user])
}
