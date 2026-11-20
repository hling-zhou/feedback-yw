import { describe, it, expect } from 'vitest'
import {
  canAccessRoute,
  canBulkRetagScope,
  canUsePostUseCallbackList,
  canViewPostUseCallbackListTab,
  hasPermission,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from './permissions.js'

describe('auth permissions', () => {
  it('displays business-facing role names', () => {
    expect(ROLE_LABELS.editor).toBe('编辑')
    expect(ROLE_LABELS.partial_editor).toBe('部分编辑')
  })

  it('admin has all module permissions', () => {
    expect(hasPermission('admin', 'manageUsers')).toBe(true)
    expect(hasPermission('admin', 'deleteData')).toBe(true)
  })

  it('editor can manage users and delete imported data', () => {
    expect(hasPermission('editor', 'import')).toBe(true)
    expect(hasPermission('editor', 'manageUsers')).toBe(true)
    expect(hasPermission('editor', 'deleteData')).toBe(true)
    expect(hasPermission('editor', 'manageTeamSettings')).toBe(false)
    expect(hasPermission('editor', 'editOrderVolumes')).toBe(true)
    // 大模型配置仅管理员；editor 不再有 configureLlmPersonal
    expect(hasPermission('editor', 'configureLlmPersonal')).toBe(false)
    expect(hasPermission('editor', 'manageLlmConfig')).toBe(false)
    expect(hasPermission('admin', 'manageLlmConfig')).toBe(true)
    expect(canAccessRoute('editor', '/users')).toBe(true)
  })

  it('partial_editor can import and edit records but not retag, tags, users, or delete', () => {
    expect(hasPermission('partial_editor', 'view')).toBe(true)
    expect(hasPermission('partial_editor', 'editRecord')).toBe(true)
    expect(hasPermission('partial_editor', 'export')).toBe(true)
    expect(hasPermission('partial_editor', 'import')).toBe(true)
    expect(hasPermission('partial_editor', 'retag')).toBe(false)
    expect(hasPermission('partial_editor', 'manageTags')).toBe(false)
    expect(hasPermission('partial_editor', 'manageUsers')).toBe(false)
    expect(hasPermission('partial_editor', 'deleteData')).toBe(false)
    expect(hasPermission('viewer', 'deleteData')).toBe(false)
    expect(hasPermission('admin', 'deleteData')).toBe(true)
    expect(hasPermission('editor', 'deleteData')).toBe(true)
  })

  it('viewer is read-only except export and audit', () => {
    expect(hasPermission('viewer', 'export')).toBe(true)
    expect(hasPermission('viewer', 'import')).toBe(false)
    expect(hasPermission('viewer', 'retag')).toBe(false)
    expect(hasPermission('viewer', 'manageTags')).toBe(false)
    // 大模型配置仅管理员；viewer 不再有 configureLlmPersonal
    expect(hasPermission('viewer', 'configureLlmPersonal')).toBe(false)
    expect(hasPermission('viewer', 'manageLlmConfig')).toBe(false)
    expect(hasPermission('viewer', 'editOrderVolumes')).toBe(false)
    expect(hasPermission('viewer', 'manageTeamSettings')).toBe(false)
  })

  it('period write and bootstrap align with import/admin roles', () => {
    expect(hasPermission('viewer', 'import')).toBe(false)
    expect(hasPermission('editor', 'import')).toBe(true)
    expect(hasPermission('admin', 'import')).toBe(true)
    expect(hasPermission('partial_editor', 'import')).toBe(true)
  })

  it('viewer hidden routes', () => {
    expect(canAccessRoute('viewer', '/import')).toBe(false)
    expect(canAccessRoute('viewer', '/users')).toBe(false)
    expect(canAccessRoute('viewer', '/operations')).toBe(false)
    expect(canAccessRoute('viewer', '/feedbacks')).toBe(true)
  })

  it('partial_editor hidden routes', () => {
    expect(canAccessRoute('partial_editor', '/import')).toBe(true)
    expect(canAccessRoute('partial_editor', '/users')).toBe(false)
    expect(canAccessRoute('partial_editor', '/operations')).toBe(false)
    expect(canAccessRoute('partial_editor', '/feedbacks')).toBe(true)
    expect(canAccessRoute('partial_editor', '/tags')).toBe(true)
  })

  it('operations route is admin-only', () => {
    expect(canAccessRoute('admin', '/operations')).toBe(true)
    expect(canAccessRoute('editor', '/operations')).toBe(false)
    expect(canAccessRoute('partial_editor', '/operations')).toBe(false)
    expect(canAccessRoute('viewer', '/operations')).toBe(false)
  })

  it('bulk retag period_all is admin-only', () => {
    expect(canBulkRetagScope('admin', 'period_all')).toBe(true)
    expect(canBulkRetagScope('editor', 'period_all')).toBe(false)
    expect(canBulkRetagScope('editor', 'filtered')).toBe(true)
    expect(canBulkRetagScope('partial_editor', 'filtered')).toBe(false)
  })

  it('role permission lists are defined', () => {
    expect(ROLE_PERMISSIONS.admin.length).toBeGreaterThan(ROLE_PERMISSIONS.viewer.length)
  })

  it('all roles can view audit log', () => {
    for (const role of ['admin', 'editor', 'partial_editor', 'viewer']) {
      expect(hasPermission(role, 'viewAudit')).toBe(true)
    }
  })

  it('post-use callback list is open to admin and 体验运营', () => {
    expect(canUsePostUseCallbackList('admin')).toBe(true)
    expect(canUsePostUseCallbackList('editor')).toBe(true)
    expect(canUsePostUseCallbackList('partial_editor')).toBe(false)
    expect(canUsePostUseCallbackList('viewer')).toBe(false)
  })

  it('post-use callback list tab: admin or username allowlist (2026-11-21 方案A)', () => {
    // admin 角色：任意用户名可见
    expect(canViewPostUseCallbackListTab({ role: 'admin', username: 'someone' })).toBe(true)
    expect(canViewPostUseCallbackListTab({ role: 'admin', username: '' })).toBe(true)
    // 白名单用户：各角色均可见（可见性只认用户名）
    for (const role of ['admin', 'editor', 'partial_editor', 'viewer']) {
      expect(canViewPostUseCallbackListTab({ role, username: 'liangdan' })).toBe(true)
    }
    // 白名单用户名 trim 后匹配
    expect(canViewPostUseCallbackListTab({ role: 'viewer', username: ' liangdan ' })).toBe(true)
    // 非白名单用户：仅 admin 可见，其余角色不可见
    expect(canViewPostUseCallbackListTab({ role: 'editor', username: 'editorA' })).toBe(false)
    expect(canViewPostUseCallbackListTab({ role: 'partial_editor', username: 'pp' })).toBe(false)
    expect(canViewPostUseCallbackListTab({ role: 'viewer', username: 'guest' })).toBe(false)
    // 空值与大小写：user 为空 / 用户名空白 / 大小写敏感（登录名精确匹配）
    expect(canViewPostUseCallbackListTab(null)).toBe(false)
    expect(canViewPostUseCallbackListTab(undefined)).toBe(false)
    expect(canViewPostUseCallbackListTab({ role: 'viewer', username: '   ' })).toBe(false)
    expect(canViewPostUseCallbackListTab({ role: 'viewer', username: 'Liangdan' })).toBe(false)
    expect(canViewPostUseCallbackListTab({})).toBe(false)
  })

  it('manageKnowledgeBase is admin + 体验运营 only', () => {
    expect(hasPermission('admin', 'manageKnowledgeBase')).toBe(true)
    expect(hasPermission('editor', 'manageKnowledgeBase')).toBe(true)
    expect(hasPermission('partial_editor', 'manageKnowledgeBase')).toBe(false)
    expect(hasPermission('viewer', 'manageKnowledgeBase')).toBe(false)
  })
})
