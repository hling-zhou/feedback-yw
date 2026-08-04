import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Import customer visit upload rules', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'Import.jsx'), 'utf8')

  it('allows multi-file customer visit upload and shows the new template hint', () => {
    expect(source).toContain("const singleFileEnrichImport = followUpImport")
    expect(source).toContain('客服部回访支持最多')
    expect(source).toContain('数据月份、客户名称、客户编码、产品名称、回访结果、内部评估')
    expect(source).toContain('拖拽或点击选择客服部回访文件（可多选）')
  })
})
