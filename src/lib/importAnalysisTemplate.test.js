import { describe, expect, it } from 'vitest'
import { getExportV3Headers } from './ticketAnalysisExport.js'
import {
  getImportAnalysisRequiredHeaders,
  getImportAnalysisTemplateHeaders,
} from './importAnalysisTemplate.js'
import { getImportRequiredDisplayNames } from '../domain/fieldRegistry.js'

describe('importAnalysisTemplate', () => {
  it('template headers match export v3 30 columns with * on required', () => {
    const headers = getImportAnalysisTemplateHeaders()
    const exportHeaders = getExportV3Headers()
    expect(headers).toHaveLength(30)
    expect(exportHeaders).toHaveLength(30)
    const required = new Set(getImportRequiredDisplayNames())
    expect(headers).toEqual(
      exportHeaders.map((name) => (required.has(name) ? `${name}*` : name)),
    )
    expect(headers[0]).toBe('工单号*')
    expect(headers[1]).toBe('产品名称*')
    expect(headers).toContain('排期')
    expect(headers).not.toContain('排期*')
    expect(headers).toContain('未完成待办')
    expect(headers).toContain('集团名称')
    expect(headers).toContain('受理渠道')
    // 必填集与上一版一致：不含客户列 / 未完成待办 / 排期等
    expect(required.has('集团名称')).toBe(false)
    expect(required.has('未完成待办')).toBe(false)
    expect(required.has('排期')).toBe(false)
    expect(required.has('处理意见')).toBe(true)
  })

  it('required headers exclude optional columns (R1 + 0601)', () => {
    const required = getImportAnalysisRequiredHeaders()
    expect(required).not.toContain('排期')
    expect(required).not.toContain('确立举措')
    expect(required).toContain('产品名称')
    expect(required).toContain('工单号')
    expect(required).not.toContain('问题原因')
    expect(required).not.toContain('受理内容')
    expect(required).not.toContain('是否加急')
    expect(required).not.toContain('回访满意度')
    expect(required).not.toContain('不满意原因')
    expect(required).not.toContain('产品组优化建议')
    expect(required).not.toContain('设计师优化建议')
    expect(required).not.toContain('集团名称')
    expect(required).not.toContain('未完成待办')
  })
})
