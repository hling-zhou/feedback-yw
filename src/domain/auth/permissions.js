/** @typedef {'admin' | 'editor' | 'partial_editor' | 'viewer'} UserRole */

/** @typedef {(
 *   | 'view'
 *   | 'import'
 *   | 'retag'
 *   | 'editRecord'
 *   | 'export'
 *   | 'manageTags'
 *   | 'deleteData'
 *   | 'manageUsers'
 *   | 'configureLlmPersonal'
 *   | 'editOrderVolumes'
 *   | 'manageTeamSettings'
 * )} PermissionCode */

export const ROLES = /** @type {const} */ (['admin', 'editor', 'partial_editor', 'viewer'])

export const ROLE_LABELS = {
  admin: '管理员',
  editor: '编辑者',
  partial_editor: '部分编辑者',
  viewer: '查看者',
}

/** @type {Record<UserRole, PermissionCode[]>} */
export const ROLE_PERMISSIONS = {
  admin: [
    'view',
    'import',
    'retag',
    'editRecord',
    'export',
    'manageTags',
    'deleteData',
    'manageUsers',
    'configureLlmPersonal',
    'editOrderVolumes',
    'manageTeamSettings',
  ],
  editor: [
    'view',
    'import',
    'retag',
    'editRecord',
    'export',
    'manageTags',
    'deleteData',
    'configureLlmPersonal',
    'editOrderVolumes',
  ],
  partial_editor: ['view', 'editRecord', 'export', 'configureLlmPersonal'],
  viewer: ['view', 'export', 'configureLlmPersonal'],
}

/** @type {Record<UserRole, string[]>} */
export const ROLE_HIDDEN_ROUTES = {
  admin: [],
  editor: ['/users'],
  partial_editor: ['/import', '/users'],
  viewer: ['/import', '/users'],
}

/**
 * @param {UserRole | string | undefined | null} role
 * @param {PermissionCode} permission
 */
export function hasPermission(role, permission) {
  if (!role) return false
  const list = ROLE_PERMISSIONS[/** @type {UserRole} */ (role)]
  return Array.isArray(list) && list.includes(permission)
}

/**
 * 批量重新打标范围：仅管理员可对当前周期内全部工单重打。
 *
 * @param {UserRole | string | undefined | null} role
 * @param {'period_all' | string} scope
 */
export function canBulkRetagScope(role, scope) {
  if (!hasPermission(role, 'retag')) return false
  if (scope === 'period_all') return role === 'admin'
  return true
}

/**
 * @param {UserRole | string | undefined | null} role
 * @param {string} path
 */
export function canAccessRoute(role, path) {
  if (!role) return path === '/login'
  const hidden = ROLE_HIDDEN_ROUTES[/** @type {UserRole} */ (role)] || []
  return !hidden.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}
