import { describe, it, expect } from 'vitest'
import {
  canAccessRoute,
  hasPermission,
  ROLE_PERMISSIONS,
} from './permissions.js'

describe('auth permissions', () => {
  it('admin has all module permissions', () => {
    expect(hasPermission('admin', 'manageUsers')).toBe(true)
    expect(hasPermission('admin', 'deleteData')).toBe(true)
  })

  it('editor cannot manage users or delete data', () => {
    expect(hasPermission('editor', 'import')).toBe(true)
    expect(hasPermission('editor', 'manageUsers')).toBe(false)
    expect(hasPermission('editor', 'deleteData')).toBe(false)
    expect(hasPermission('editor', 'manageTeamSettings')).toBe(false)
    expect(hasPermission('editor', 'editOrderVolumes')).toBe(true)
    expect(hasPermission('editor', 'configureLlmPersonal')).toBe(true)
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
  })

  it('viewer hidden routes', () => {
    expect(canAccessRoute('viewer', '/import')).toBe(false)
    expect(canAccessRoute('viewer', '/users')).toBe(false)
    expect(canAccessRoute('viewer', '/feedbacks')).toBe(true)
  })

  it('role permission lists are defined', () => {
    expect(ROLE_PERMISSIONS.admin.length).toBeGreaterThan(ROLE_PERMISSIONS.viewer.length)
  })
})
