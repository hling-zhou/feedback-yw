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
 *   | 'viewAudit'
 *   | 'manageMessageBottles'
 *   | 'manageRequirementSync'
 * )} PermissionCode */

export const ROLES = /** @type {const} */ (['admin', 'editor', 'partial_editor', 'viewer'])

export const ROLE_LABELS = {
  admin: '管理员',
  editor: '体验运营角色',
  partial_editor: '工单分析角色',
  viewer: '查看者',
}

/** 导入等场景兼容旧角色中文名 */
export const ROLE_LABEL_ALIASES = {
  编辑者: 'editor',
  部分编辑者: 'partial_editor',
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
    'viewAudit',
    'manageMessageBottles',
    'manageRequirementSync',
  ],
  editor: [
    'view',
    'viewAudit',
    'import',
    'retag',
    'editRecord',
    'export',
    'manageTags',
    'manageUsers',
    'deleteData',
    'configureLlmPersonal',
    'editOrderVolumes',
  ],
  partial_editor: ['view', 'viewAudit', 'editRecord', 'export', 'configureLlmPersonal'],
  viewer: ['view', 'viewAudit', 'export', 'configureLlmPersonal'],
}

/** @type {Record<UserRole, string[]>} */
export const ROLE_HIDDEN_ROUTES = {
  admin: [],
  editor: [],
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
