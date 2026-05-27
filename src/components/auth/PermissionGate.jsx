import { useAuth } from '../../context/AuthContext.jsx'

/**
 * @param {{
 *   permission: import('../../domain/auth/permissions.js').PermissionCode
 *   children: import('react').ReactNode
 *   fallback?: import('react').ReactNode
 * }} props
 */
export default function PermissionGate({ permission, children, fallback = null }) {
  const { can } = useAuth()
  if (!can(permission)) return fallback
  return children
}
