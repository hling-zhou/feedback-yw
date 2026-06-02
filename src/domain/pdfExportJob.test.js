import { describe, expect, it } from 'vitest'
import { createPdfExportJob, pdfExportScopeLabel } from './pdfExportJob.js'

describe('pdfExportJob', () => {
  it('labels overview scope', () => {
    expect(pdfExportScopeLabel('overview')).toBe('综合概述报告')
    expect(pdfExportScopeLabel('complaint_ticket')).toBe('投诉工单报告')
  })

  it('creates queued job with payload', () => {
    const job = createPdfExportJob({
      scope: 'overview',
      period: { label: '2025-06', granularity: 'month' },
      overview: null,
      sourceSnapshot: null,
      feedbacks: [],
    })
    expect(job.status).toBe('queued')
    expect(job.label).toBe('综合概述报告')
    expect(job.payload.scope).toBe('overview')
  })
})
