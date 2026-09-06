import { describe, expect, it } from 'vitest'
import { applyImportReplace } from '../domain/overridePolicy.js'
import { getExportV2Headers, recordToExportRowV2 } from './ticketAnalysisExport.js'
import {
  EXPORT_V2_UAT_ALL_SAMPLES,
  EXPORT_V2_UAT_COMPLAINT_SAMPLES,
  EXPORT_V2_UAT_CONSULTATION_SAMPLES,
} from './ticketAnalysis/fixtures/exportV2UatSamples.js'

const LEGACY_REMOVED_COLUMNS = [
  '投诉原因（终判）',
  '客户请求来源',
  '痛点来源',
  '优化建议来源',
  '问题摘要',
  '根因',
  '根因（人工复核）',
  '优化方案（人工复核）',
  '人工复核举措',
  '时间',
  '客户原话',
]

const REQUIRED_HEADERS = getExportV2Headers()

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
function assertV2RowShape(record) {
  const row = recordToExportRowV2(record)
  expect(Object.keys(row)).toEqual(REQUIRED_HEADERS)
  for (const legacy of LEGACY_REMOVED_COLUMNS) {
    expect(row).not.toHaveProperty(legacy)
  }
  for (const header of REQUIRED_HEADERS) {
    expect(typeof row[header]).toBe('string')
  }
  return row
}

describe('export v2 UAT fixtures (P1-4 / P1-5)', () => {
  it('has 10 complaint + 10 consultation samples', () => {
    expect(EXPORT_V2_UAT_COMPLAINT_SAMPLES).toHaveLength(10)
    expect(EXPORT_V2_UAT_CONSULTATION_SAMPLES).toHaveLength(10)
    expect(EXPORT_V2_UAT_ALL_SAMPLES).toHaveLength(20)
  })

  it('all complaint samples export v2 shape without 终判 column', () => {
    for (const record of EXPORT_V2_UAT_COMPLAINT_SAMPLES) {
      const row = assertV2RowShape(record)
      expect(row).not.toHaveProperty('投诉原因（终判）')
      expect(row['问题类型']).toBeTruthy()
    }
  })

  it('all consultation samples export v2 shape without 终判 column', () => {
    for (const record of EXPORT_V2_UAT_CONSULTATION_SAMPLES) {
      const row = assertV2RowShape(record)
      expect(row).not.toHaveProperty('投诉原因（终判）')
      expect(row['问题类型']).not.toBe(record.complaintCauseL1Final)
    }
  })

  describe('P1-4 schedule and rootCauseReview', () => {
    it('empty actionSchedule exports empty 排期 (R1)', () => {
      const emptySchedule = EXPORT_V2_UAT_ALL_SAMPLES.filter((r) => !r.actionSchedule?.trim())
      expect(emptySchedule.length).toBeGreaterThanOrEqual(5)
      for (const record of emptySchedule) {
        expect(recordToExportRowV2(record)['排期']).toBe('')
      }
    })

    it('问题原因 derives from auto rootCause when no manual review', () => {
      const c03 = EXPORT_V2_UAT_COMPLAINT_SAMPLES.find((r) => r.id === 'uat-c-03')
      expect(recordToExportRowV2(c03)['问题原因']).toBe('磁盘满')

      const c04 = EXPORT_V2_UAT_COMPLAINT_SAMPLES.find((r) => r.id === 'uat-c-04')
      expect(recordToExportRowV2(c04)['问题原因']).toBe('AccessKey 轮换未同步')

      const c08 = EXPORT_V2_UAT_COMPLAINT_SAMPLES.find((r) => r.id === 'uat-c-08')
      expect(recordToExportRowV2(c08)['问题原因']).toBe('')
    })

    it('stored rootCauseReview takes precedence', () => {
      const c01 = EXPORT_V2_UAT_COMPLAINT_SAMPLES.find((r) => r.id === 'uat-c-01')
      expect(recordToExportRowV2(c01)['问题原因']).toBe('安全组未放行 22 端口')
    })

    it('legacy manualReviewOptimization maps to 确立举措 when establishedAction empty', () => {
      const c02 = EXPORT_V2_UAT_COMPLAINT_SAMPLES.find((r) => r.id === 'uat-c-02')
      expect(recordToExportRowV2(c02)['确立举措']).toBe('legacy 人工复核举措文本')

      const c10 = EXPORT_V2_UAT_COMPLAINT_SAMPLES.find((r) => r.id === 'uat-c-10')
      expect(recordToExportRowV2(c10)['确立举措']).toBe('简化发票修改流程')
      expect(recordToExportRowV2(c10)).not.toHaveProperty('人工复核举措')
    })
  })

  describe('P1-4 import round-trip (export row → IMPORT_REPLACE)', () => {
    it('round-trips core fields for representative complaint record', () => {
      const record = EXPORT_V2_UAT_COMPLAINT_SAMPLES[0]
      const exportRow = recordToExportRowV2(record)
      const imported = applyImportReplace(record, exportRow)

      expect(imported.customerRequest).toBe(exportRow['客户请求内容'])
      expect(imported.painPoint).toBe(exportRow['需求痛点'])
      expect(imported.requestScene).toBe(exportRow['请求场景'])
      expect(imported.problemType).toBe(exportRow['问题类型'])
      expect(imported.journeyL1).toBe(exportRow['用户旅程一级'])
      expect(imported.journeyL2).toBe(exportRow['用户旅程二级'])
      expect(imported.optimizationProduct).toBe(exportRow['产品技术优化'])
      expect(imported.establishedAction).toBe(exportRow['确立举措'])
      expect(imported.actionSchedule).toBe(exportRow['排期'])
      expect(imported.rootCauseReview).toBe(exportRow['问题原因'])
      expect(imported.customerRequestSource).toBe('import')
    })

    it('round-trips consultation with empty 排期', () => {
      const record = EXPORT_V2_UAT_CONSULTATION_SAMPLES[0]
      const exportRow = recordToExportRowV2(record)
      const imported = applyImportReplace(record, exportRow)
      expect(imported.actionSchedule).toBe('')
      expect(imported.painPointSource).toBe('import')
    })
  })
})
