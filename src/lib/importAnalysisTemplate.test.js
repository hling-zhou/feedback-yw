import { describe, expect, it } from 'vitest'
import { getExportV2Headers } from './ticketAnalysisExport.js'
import {
  getImportAnalysisRequiredHeaders,
  getImportAnalysisTemplateHeaders,
} from './importAnalysisTemplate.js'
import { getImportRequiredDisplayNames } from '../domain/fieldRegistry.js'

describe('importAnalysisTemplate', () => {
  it('template headers match export v2 column order with * on required columns', () => {
    const headers = getImportAnalysisTemplateHeaders()
    const exportHeaders = getExportV2Headers()
    expect(headers).toHaveLength(16)
    expect(exportHeaders).toHaveLength(16)
    const required = new Set(getImportRequiredDisplayNames())
    expect(headers).toEqual(
      exportHeaders.map((name) => (required.has(name) ? `${name}*` : name)),
    )
    expect(headers[0]).toBe('工单号*')
    expect(headers).toContain('排期')
    expect(headers).not.toContain('排期*')
  })

  it('required headers exclude optional columns (R1 + 0601)', () => {
    const required = getImportAnalysisRequiredHeaders()
    expect(required).not.toContain('排期')
    expect(required).toContain('工单号')
    expect(required).toContain('确立举措')
    expect(required).not.toContain('根因排查')
    expect(required).not.toContain('受理内容')
    expect(required).not.toContain('是否加急')
  })
})
