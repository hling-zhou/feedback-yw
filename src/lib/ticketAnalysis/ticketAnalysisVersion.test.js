import { describe, expect, it } from 'vitest'
import {
  computeJourneyMeasuresFingerprintFromRecords,
  ticketAnalysisFieldsDigest,
  TICKET_ANALYSIS_PIPELINE_VERSION,
} from './ticketAnalysisVersion.js'

describe('ticketAnalysisVersion', () => {
  it('ticketAnalysisFieldsDigest includes pain and optimization fields', () => {
    const digest = ticketAnalysisFieldsDigest({
      painPoint: '安全组未放行端口',
      optimizationProduct: '增加端口检测',
      manualReviewOptimization: '',
    })
    expect(digest).toContain('安全组未放行端口')
    expect(digest).toContain('增加端口检测')
  })

  it('computeJourneyMeasuresFingerprintFromRecords changes when painPoint changes', () => {
    const base = [{ id: 'a', painPoint: '痛点A', optimizationProduct: '建议A' }]
    const changed = [{ id: 'a', painPoint: '痛点B', optimizationProduct: '建议A' }]
    const fp1 = computeJourneyMeasuresFingerprintFromRecords(base)
    const fp2 = computeJourneyMeasuresFingerprintFromRecords(changed)
    expect(fp1).not.toBe(fp2)
    expect(fp1.startsWith(TICKET_ANALYSIS_PIPELINE_VERSION)).toBe(true)
  })
})
