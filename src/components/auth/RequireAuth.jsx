import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from '../../context/AuthContext.jsx'

/**
 * @param {{ permission?: import('../../domain/auth/permissions.js').PermissionCode }} [props]
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
    // 11-23 修复：登录回跳携带完整地址（pathname + search）——否则 /feedbacks?source=...&lane=...
    // 这类带视图参数的链接登录后只回 /feedbacks，溯源/举措视图状态丢失（邮件链接场景实测报障）
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  if (!canRoute(location.pathname)) {
    return <Navigate to="/workbench" replace />
  }

  if (permission && !can(permission)) {
    return <Navigate to="/workbench" replace />
  }

  return <Outlet />
}
