import { describe, it, expect } from 'vitest'
import {
  canAccessRoute,
  canBulkRetagScope,
  hasPermission,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from './permissions.js'

describe('auth permissions', () => {
  it('displays business-facing role names', () => {
    expect(ROLE_LABELS.editor).toBe('体验运营角色')
    expect(ROLE_LABELS.partial_editor).toBe('工单分析角色')
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
    expect(hasPermission('editor', 'configureLlmPersonal')).toBe(true)
    expect(canAccessRoute('editor', '/users')).toBe(true)
  })

  it('partial_editor can edit records but not import, retag, tags, users, or delete', () => {
    expect(hasPermission('partial_editor', 'view')).toBe(true)
    expect(hasPermission('partial_editor', 'editRecord')).toBe(true)
    expect(hasPermission('partial_editor', 'export')).toBe(true)
    expect(hasPermission('partial_editor', 'import')).toBe(false)
    expect(hasPermission('partial_editor', 'retag')).toBe(false)
    expect(hasPermission('partial_editor', 'manageTags')).toBe(false)
    expect(hasPermission('partial_editor', 'manageUsers')).toBe(false)
    expect(hasPermission('partial_editor', 'deleteData')).toBe(false)
    expect(hasPermission('viewer', 'deleteData')).toBe(false)
    expect(hasPermission('admin', 'deleteData')).toBe(true)
    expect(hasPermission('editor', 'deleteData')).toBe(true)
  })

  it('viewer is read-only except export and personal llm', () => {
    expect(hasPermission('viewer', 'export')).toBe(true)
    expect(hasPermission('viewer', 'import')).toBe(false)
    expect(hasPermission('viewer', 'retag')).toBe(false)
    expect(hasPermission('viewer', 'manageTags')).toBe(false)
    expect(hasPermission('viewer', 'configureLlmPersonal')).toBe(true)
    expect(hasPermission('viewer', 'editOrderVolumes')).toBe(false)
    expect(hasPermission('viewer', 'manageTeamSettings')).toBe(false)
  })

  it('period write and bootstrap align with import/admin roles', () => {
    expect(hasPermission('viewer', 'import')).toBe(false)
    expect(hasPermission('editor', 'import')).toBe(true)
    expect(hasPermission('admin', 'import')).toBe(true)
    expect(hasPermission('partial_editor', 'import')).toBe(false)
  })

  it('viewer hidden routes', () => {
    expect(canAccessRoute('viewer', '/import')).toBe(false)
    expect(canAccessRoute('viewer', '/users')).toBe(false)
    expect(canAccessRoute('viewer', '/feedbacks')).toBe(true)
  })

  it('partial_editor hidden routes', () => {
    expect(canAccessRoute('partial_editor', '/import')).toBe(false)
    expect(canAccessRoute('partial_editor', '/users')).toBe(false)
    expect(canAccessRoute('partial_editor', '/feedbacks')).toBe(true)
    expect(canAccessRoute('partial_editor', '/tags')).toBe(true)
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
})
