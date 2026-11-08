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
 *   | 'manageLlmConfig'
 *   | 'managePatrolMcpConfig'
 *   | 'editOrderVolumes'
 *   | 'manageTeamSettings'
 *   | 'viewAudit'
 *   | 'manageMessageBottles'
 *   | 'manageRequirementSync'
 *   | 'manageKnowledgeBase'
 * )} PermissionCode */

export const ROLES = /** @type {const} */ (['admin', 'editor', 'partial_editor', 'viewer'])

export const ROLE_LABELS = {
  admin: '管理员',
  editor: '编辑',
  partial_editor: '部分编辑',
  viewer: '查看者',
}

/** 导入等场景兼容旧角色中文名 */
export const ROLE_LABEL_ALIASES = {
  编辑者: 'editor',
  体验运营角色: 'editor',
  体验运行角色: 'editor',
  编辑: 'editor',
  部分编辑者: 'partial_editor',
  工单分析角色: 'partial_editor',
  部分编辑: 'partial_editor',
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
    'manageLlmConfig',
    'managePatrolMcpConfig',
    'editOrderVolumes',
    'manageTeamSettings',
    'viewAudit',
    'manageMessageBottles',
    'manageRequirementSync',
    'manageKnowledgeBase',
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
    'editOrderVolumes',
    'manageKnowledgeBase',
  ],
  partial_editor: ['view', 'viewAudit', 'import', 'editRecord', 'export'],
  viewer: ['view', 'viewAudit', 'export'],
}

/**
 * 角色隐藏路由清单（菜单可见性，11-02 拍板默认约定：**新增菜单默认对所有角色可见**，
 * 只有明确理由才加进隐藏清单；每条必须带 [HIDDEN-WHY] 理由注释，无注释即被
 * menuVisibilityGuard.test.js 守卫拦红）。
 *
 * @type {Record<UserRole, string[]>}
 */
export const ROLE_HIDDEN_ROUTES = {
  admin: [],
  editor: [
    '/operations', // [HIDDEN-WHY] 运维工具页为 admin 专属运维入口（含系统级操作），编辑者无此职责
  ],
  partial_editor: [
    '/users', // [HIDDEN-WHY] 部分编辑仅编辑工单内容，无用户管理职责（manageUsers 权限本就不授予）
    '/operations', // [HIDDEN-WHY] 同 editor：运维工具页为 admin 专属
  ],
  viewer: [
    '/import', // [HIDDEN-WHY] 查看者只读（import 权限本就不授予，菜单展示无意义徒增困惑）
    '/users', // [HIDDEN-WHY] 同 partial_editor：无用户管理职责
    '/operations', // [HIDDEN-WHY] 同 editor：运维工具页为 admin 专属
  ],
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

/**
 * 用后即评看板「建议回访/溯源清单」：管理员与体验运营可打开并处理。
 *
 * @param {UserRole | string | undefined | null} role
 */
export function canUsePostUseCallbackList(role) {
  return role === 'admin' || role === 'editor'
}
