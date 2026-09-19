import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseUserImportFile } from './userImport.js'
import { USER_IMPORT_SHEET_NAME } from './userImportTemplate.js'

function buildWorkbook(rows) {
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, sheet, USER_IMPORT_SHEET_NAME)
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}

describe('userImport', () => {
  it('parses valid user rows', () => {
    const buf = buildWorkbook([
      {
        '用户名*（必填）': 'alice',
        '密码（留空用默认）': 'SecurePass123!',
        '所属班组*（必填）': '产品运营组',
        '角色*（必填）': '编辑',
      },
    ])
    const { rows, errors } = parseUserImportFile(buf)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      username: 'alice',
      team: '产品运营组',
      role: 'editor',
    })
  })

  it('accepts legacy role labels', () => {
    const buf = buildWorkbook([
      {
        '用户名*（必填）': 'legacy',
        '密码（留空用默认）': 'SecurePass123!',
        '所属班组*（必填）': '云网测试组',
        '角色*（必填）': '编辑者',
      },
      {
        '用户名*（必填）': 'legacy2',
        '密码（留空用默认）': 'SecurePass123!',
        '所属班组*（必填）': '云网测试组',
        '角色*（必填）': '体验运营角色',
      },
      {
        '用户名*（必填）': 'legacy3',
        '密码（留空用默认）': 'SecurePass123!',
        '所属班组*（必填）': '云网测试组',
        '角色*（必填）': '工单分析角色',
      },
    ])
    const { rows, errors } = parseUserImportFile(buf)
    expect(errors).toHaveLength(0)
    expect(rows[0].role).toBe('editor')
    expect(rows[1].role).toBe('editor')
    expect(rows[2].role).toBe('partial_editor')
  })

  it('reports invalid role and weak password', () => {
    const buf = buildWorkbook([
      {
        '用户名*（必填）': 'bob',
        '密码（留空用默认）': 'short',
        '所属班组*（必填）': '云网测试组',
        '角色*（必填）': '未知角色',
      },
    ])
    const { rows, errors } = parseUserImportFile(buf)
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/角色/)
    expect(errors[0].message).toMatch(/密码/)
  })

  it('rejects team outside the enum', () => {
    const buf = buildWorkbook([
      {
        '用户名*（必填）': 'dave',
        '密码（留空用默认）': 'SecurePass123!',
        '所属班组*（必填）': '华东组',
        '角色*（必填）': '查看者',
      },
    ])
    const { rows, errors } = parseUserImportFile(buf)
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/所属班组/)
    expect(errors[0].message).toMatch(/综合管理组/)
  })

  it('reports empty team as an error', () => {
    const buf = buildWorkbook([
      {
        '用户名*（必填）': 'erin',
        '密码（留空用默认）': 'SecurePass123!',
        '所属班组*（必填）': '',
        '角色*（必填）': '查看者',
      },
    ])
    const { rows, errors } = parseUserImportFile(buf)
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/所属班组为空/)
  })

  it('accepts empty password (uses system default)', () => {
    const buf = buildWorkbook([
      {
        '用户名*（必填）': 'frank',
        '密码（留空用默认）': '',
        '所属班组*（必填）': 'SDN运维产品组',
        '角色*（必填）': '查看者',
      },
    ])
    const { rows, errors } = parseUserImportFile(buf)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].password).toBe('')
  })
})
