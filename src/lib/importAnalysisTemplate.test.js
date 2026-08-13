import { describe, expect, it } from 'vitest'
import { getExportV3Headers } from './ticketAnalysisExport.js'
import {
  getImportAnalysisRequiredHeaders,
  getImportAnalysisTemplateHeaders,
} from './importAnalysisTemplate.js'
import { getImportColumns, getImportRequiredDisplayNames } from '../domain/fieldRegistry.js'

describe('importAnalysisTemplate', () => {
  it('template headers follow export v3 order for importable columns with * on required', () => {
    const headers = getImportAnalysisTemplateHeaders()
    const exportHeaders = getExportV3Headers()
    const importable = getImportColumns()
    expect(exportHeaders).toHaveLength(30)
    expect(headers).toHaveLength(importable.length)
    expect(headers).toHaveLength(21)
    const required = new Set(getImportRequiredDisplayNames())
    expect(headers).toEqual(
      importable.map((field) =>
        required.has(field.displayName) ? `${field.displayName}*` : field.displayName,
      ),
    )
    // 可导入列在导出列序中保持相对顺序
    const exportIndex = new Map(exportHeaders.map((name, i) => [name, i]))
    const importNames = importable.map((f) => f.displayName)
    for (let i = 1; i < importNames.length; i += 1) {
      expect(exportIndex.get(importNames[i])).toBeGreaterThan(exportIndex.get(importNames[i - 1]))
    }
    expect(headers[0]).toBe('工单号*')
    expect(headers[1]).toBe('产品名称*')
    expect(headers).toContain('排期')
    expect(headers).not.toContain('排期*')
    expect(headers).not.toContain('未完成待办')
    expect(headers).not.toContain('集团名称')
  })

  it('required headers exclude optional columns (R1 + 0601)', () => {
    const required = getImportAnalysisRequiredHeaders()
    expect(required).not.toContain('排期')
    expect(required).not.toContain('确立举措')
    expect(required).toContain('产品名称')
    expect(required).toContain('工单号')
    expect(required).not.toContain('根因排查')
    expect(required).not.toContain('受理内容')
    expect(required).not.toContain('是否加急')
    expect(required).not.toContain('回访满意度')
    expect(required).not.toContain('不满意原因')
    expect(required).not.toContain('产品组优化建议')
    expect(required).not.toContain('设计师优化建议')
  })
})
