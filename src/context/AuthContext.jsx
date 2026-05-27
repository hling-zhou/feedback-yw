import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { canAccessRoute, hasPermission } from '../domain/auth/permissions.js'
import { apiFetch, clearStoredToken, setStoredToken } from '../lib/apiClient.js'

/** @typedef {import('../domain/auth/permissions.js').PermissionCode} PermissionCode */
/** @typedef {import('../domain/auth/permissions.js').UserRole} UserRole */

/**
 * @typedef {Object} AuthUser
 * @property {string} id
 * @property {string} username
 * @property {string} team
 * @property {UserRole} role
 * @property {'active' | 'disabled'} status
 */

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(/** @type {AuthUser | null} */ (null))
  const [loading, setLoading] = useState(true)

  const refreshMe = useCallback(async () => {
    try {
      const data = await apiFetch('/api/auth/me')
      setUser(data.user)
      return data.user
    } catch {
      setUser(null)
      clearStoredToken()
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await refreshMe()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshMe])

  const login = useCallback(async (username, password, remember = false) => {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setStoredToken(data.accessToken, { remember })
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore
    }
    clearStoredToken()
    setUser(null)
  }, [])

  const can = useCallback(
    (permission) => hasPermission(user?.role, permission),
    [user],
  )

  const canRoute = useCallback(
    (path) => canAccessRoute(user?.role, path),
    [user],
  )

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshMe,
      can,
      canRoute,
      isAuthenticated: Boolean(user),
    }),
    [user, loading, login, logout, refreshMe, can, canRoute],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** @param {PermissionCode} permission */
export function usePermission(permission) {
  const { can } = useAuth()
  return can(permission)
}
