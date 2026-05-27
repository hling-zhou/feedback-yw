import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from '../../context/AuthContext.jsx'

/**
 * @param {{ permission?: import('../domain/auth/permissions.js').PermissionCode }} [props]
 */
export default function RequireAuth({ permission }) {
  const { loading, isAuthenticated, can, canRoute } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50">
        <Spin size="large" tip="验证登录状态…" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!canRoute(location.pathname)) {
    return <Navigate to="/workbench" replace />
  }

  if (permission && !can(permission)) {
    return <Navigate to="/workbench" replace />
  }

  return <Outlet />
}
