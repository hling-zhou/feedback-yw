import { describe, expect, it } from 'vitest'
import {
  BACKUP_OMIT_FIELD_KEYS,
  FEEDBACK_BACKUP_VERSION,
  buildFeedbackBackupEnvelope,
  parseFeedbackBackupJson,
  sanitizeRecordForBackup,
} from './feedbackBackup.js'
import { EXPORT_ANALYSIS_VERSION } from './ticketAnalysisExport.js'
import { SCHEMA_VERSION } from '../domain/constants.js'

const baseRecord = {
  id: 'r1',
  rawText: '受理内容',
  customerQuote: '端口不通',
  requestScene: '报障',
  problemType: '连通',
  journeyL1: '使用',
  journeyL2: '访问',
  problemSummary: '端口不通',
  painPoint: '端口不通',
  customerRequest: '希望开通端口',
  rootCause: '安全组未放行',
  optimizationSuggestion: '优化引导',
  establishedAction: '确立举措 A',
  manualReviewOptimization: '过渡举措',
  sentiment: 'negative',
  themes: ['访问'],
  status: 'open',
  importedAt: '2026-01-15T00:00:00.000Z',
  ticketId: 'T-100',
}

describe('feedbackBackup', () => {
  it('sanitizeRecordForBackup removes deprecated manual review fields', () => {
    const sanitized = sanitizeRecordForBackup({
      ...baseRecord,
      manualReviewRootCause: 'legacy 根因',
      manualReviewSolution: 'legacy 方案',
      manualReviewAction: 'legacy 举措',
    })

    for (const key of BACKUP_OMIT_FIELD_KEYS) {
      expect(sanitized).not.toHaveProperty(key)
    }
    expect(sanitized.establishedAction).toBe('确立举措 A')
    expect(sanitized.rootCause).toBe('安全组未放行')
    expect(sanitized.problemSummary).toBe('端口不通')
    expect(sanitized.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('buildFeedbackBackupEnvelope includes version metadata', () => {
    const envelope = buildFeedbackBackupEnvelope([baseRecord])
    expect(envelope.backupVersion).toBe(FEEDBACK_BACKUP_VERSION)
    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION)
    expect(envelope.exportAnalysisVersion).toBe(EXPORT_ANALYSIS_VERSION)
    expect(envelope.recordCount).toBe(1)
    expect(envelope.records).toHaveLength(1)
    expect(envelope.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(envelope.records[0].ticketId).toBe('T-100')
  })

  it('parseFeedbackBackupJson accepts legacy array', () => {
    const parsed = parseFeedbackBackupJson([
      { ...baseRecord, manualReviewAction: '旧备份举措' },
    ])
    expect(parsed.format).toBe('legacy-array')
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).not.toHaveProperty('manualReviewAction')
  })

  it('parseFeedbackBackupJson accepts v1 envelope', () => {
    const envelope = buildFeedbackBackupEnvelope([baseRecord])
    const parsed = parseFeedbackBackupJson(envelope)
    expect(parsed.format).toBe('envelope-v1')
    expect(parsed.envelope?.backupVersion).toBe(FEEDBACK_BACKUP_VERSION)
    expect(parsed.records[0].id).toBe('r1')
  })

  it('parseFeedbackBackupJson rejects invalid payload', () => {
    expect(() => parseFeedbackBackupJson({ records: 'bad' })).toThrow(/JSON 格式/)
    expect(() => parseFeedbackBackupJson(null)).toThrow(/JSON 格式/)
  })
})
