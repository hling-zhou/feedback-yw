import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Import customer visit upload rules', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'Import.jsx'), 'utf8')

  it('allows multi-file customer visit upload and shows the new template hint', () => {
    expect(source).toContain("const singleFileEnrichImport = followUpImport")
    expect(source).toContain('省代表回访支持最多')
    // 2026-11-09 锚点改为稳定前缀：可选列说明文案多次演进，具体列举不再锚定
    expect(source).toContain(
      '模板需含数据月份、客户名称、客户编码、产品名称、回访结果',
    )
    expect(source).toContain('拖拽或点击选择省代表回访文件（可多选）')
  })
})
