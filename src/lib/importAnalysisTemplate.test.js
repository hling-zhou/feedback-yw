import { describe, expect, it } from 'vitest'
import { getExportV2Headers } from './ticketAnalysisExport.js'
import {
  getImportAnalysisRequiredHeaders,
  getImportAnalysisTemplateHeaders,
} from './importAnalysisTemplate.js'

describe('importAnalysisTemplate', () => {
  it('template headers match export v2 (16 columns)', () => {
    const headers = getImportAnalysisTemplateHeaders()
    expect(headers).toEqual(getExportV2Headers())
    expect(headers).toHaveLength(16)
    expect(headers[0]).toBe('工单号')
    expect(headers).toContain('确立举措')
    expect(headers).toContain('排期')
    expect(headers).toContain('根因排查')
  })

  it('required headers exclude 排期 (R1)', () => {
    const required = getImportAnalysisRequiredHeaders()
    expect(required).not.toContain('排期')
    expect(required).toContain('工单号')
    expect(required).toContain('确立举措')
  })
})
