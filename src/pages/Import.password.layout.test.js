import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Import password-protected excel flow', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'Import.jsx'), 'utf8')

  it('shows an excel password modal and keeps password only in memory state', () => {
    expect(source).toContain('IMPORT_PARSE_ERROR_CODES.PASSWORD_REQUIRED')
    expect(source).toContain('请输入 Excel 密码')
    expect(source).toContain('请输入 Excel 文件密码')
    expect(source).toContain('密码仅保存在当前页面内存中，不会写入系统或随导入数据上传')
    expect(source).toContain('entry.password')
    expect(source).toContain('item.requiresPassword')
    expect(source).toContain('clearUploadFilePasswords')
  })
})
