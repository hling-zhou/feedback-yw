import { describe, expect, it } from 'vitest'
import { getImportManualDimensions } from '../domain/fieldRegistry.js'
import {
  getCustomerRequestSource,
  getOptimizationSourceLabel,
  getPainPointSource,
  getTicketAnalysisSourceLabel,
} from './ticketAnalysis/ticketAnalysisSources.js'
import { recordToExportRowV2 } from './ticketAnalysisExport.js'
import {
  EXPORT_V2_UAT_COMPLAINT_SAMPLES,
} from './ticketAnalysis/fixtures/exportV2UatSamples.js'
import { getImportAnalysisTemplateHeaders } from './importAnalysisTemplate.js'
import {
  applyImportAnalysisToRecords,
  buildTicketIdIndex,
  coerceImportAnalysisRow,
  matchImportAnalysisHeaders,
  normalizeImportAnalysisRow,
  parseAndValidateImportAnalysisSheet,
  stripImportHeaderSuffix,
  validateImportAnalysisRow,
  validateImportFollowUpSatisfactionRaw,
  validateImportSentimentRaw,
  validateImportUrgencyRaw,
} from './importAnalysis.js'

const HEADERS = getImportAnalysisTemplateHeaders()

/** @param {Partial<Record<string, string>>} overrides */
function buildValidRow(overrides = {}) {
  /** @type {Record<string, string>} */
  const row = {
    工单号: 'T-100',
    产品名称: '云主机',
    客户请求内容: '请求内容',
    需求痛点: '痛点',
    请求场景: '投诉',
    问题类型: '故障',
    用户旅程一级: '使用',
    用户旅程二级: '监控',
    用户情绪: '不满',
    是否加急: '',
    回访满意度: '',
    不满意原因: '',
    产品技术优化: '产品优化',
    服务流程改进: '服务优化',
    确立举措: '举措',
    排期: '',
    产品组优化建议: '',
    设计师优化建议: '',
    受理内容: '',
    处理意见: '处理',
    问题原因: '',
  }
  return { ...row, ...overrides }
}

describe('importAnalysis', () => {
  it('matchImportAnalysisHeaders accepts template headers with required * suffix', () => {
    const match = matchImportAnalysisHeaders(HEADERS)
    expect(match.ok).toBe(true)
    expect(match.missingHeaders).toEqual([])
    expect(match.matchedHeaders).toHaveLength(HEADERS.length)
    expect(match.extraHeaders).toEqual([])
  })

  it('stripImportHeaderSuffix removes trailing asterisk', () => {
    expect(stripImportHeaderSuffix('工单号*')).toBe('工单号')
    expect(stripImportHeaderSuffix('  排期  ')).toBe('排期')
  })

  it('matchImportAnalysisHeaders accepts export v2 headers without *', () => {
    const exportHeaders = HEADERS.map((h) => stripImportHeaderSuffix(h))
    const match = matchImportAnalysisHeaders(exportHeaders)
    expect(match.ok).toBe(true)
  })

  it('matchImportAnalysisHeaders ignores extra columns', () => {
    const match = matchImportAnalysisHeaders([...HEADERS, '备注', '自定义列'])
    expect(match.ok).toBe(true)
    expect(match.extraHeaders).toEqual(['备注', '自定义列'])
  })

  it('matchImportAnalysisHeaders reports missing required columns', () => {
    const partial = HEADERS.filter((h) => h !== '工单号*' && h !== '问题原因')
    const match = matchImportAnalysisHeaders(partial)
    expect(match.ok).toBe(false)
    expect(match.missingHeaders).toContain('工单号')
    expect(match.missingHeaders).not.toContain('问题原因')
  })

  it('validateImportSentimentRaw and urgency enums', () => {
    expect(validateImportSentimentRaw('不满').ok).toBe(true)
    expect(validateImportSentimentRaw('negative').ok).toBe(true)
    expect(validateImportSentimentRaw('').ok).toBe(false)
    expect(validateImportSentimentRaw('未知情绪').ok).toBe(false)

    expect(validateImportUrgencyRaw('').ok).toBe(true)
    expect(validateImportUrgencyRaw('加急').ok).toBe(true)
    expect(validateImportUrgencyRaw('maybe').ok).toBe(false)
  })

  it('validateImportAnalysisRow passes when 排期 is empty (R1)', () => {
    const result = validateImportAnalysisRow(buildValidRow({ 排期: '' }), 1)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.row.byDisplayName['排期']).toBe('')
    }
  })

  it('validateImportAnalysisRow passes when 是否加急 is empty (export v2 non-urgent)', () => {
    const result = validateImportAnalysisRow(buildValidRow({ 是否加急: '' }), 1)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.row.byFieldKey.urgency).toBe('none')
    }
  })

  it('validateImportAnalysisRow passes when 确立举措 is empty', () => {
    const result = validateImportAnalysisRow(buildValidRow({ 确立举措: '' }), 2)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.row.byDisplayName['确立举措']).toBe('')
    }
  })

  it('validateImportAnalysisRow passes when detail optimization fields are empty', () => {
    const result = validateImportAnalysisRow(
      buildValidRow({ 产品组优化建议: '', 设计师优化建议: '' }),
      2,
    )
    expect(result.valid).toBe(true)
  })

  it('validateImportAnalysisRow rejects missing required fields', () => {
    const result = validateImportAnalysisRow(buildValidRow({ 处理意见: '' }), 2)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          rowIndex: 2,
          displayName: '处理意见',
          message: '不能为空',
        }),
      ])
    }
  })

  it('validateImportAnalysisRow rejects invalid sentiment', () => {
    const result = validateImportAnalysisRow(buildValidRow({ 用户情绪: '开心极了' }), 3)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]?.displayName).toBe('用户情绪')
    }
  })

  it('normalizeImportAnalysisRow ignores unknown columns', () => {
    const normalized = normalizeImportAnalysisRow({
      ...buildValidRow(),
      备注: '应忽略',
    })
    expect(normalized['工单号']).toBe('T-100')
    expect(normalized['备注']).toBeUndefined()
    expect(Object.keys(normalized)).toHaveLength(HEADERS.length)
  })

  it('coerceImportAnalysisRow parses sentiment and urgency', () => {
    const byDisplayName = normalizeImportAnalysisRow(buildValidRow({ 是否加急: '加急' }))
    const coerced = coerceImportAnalysisRow(byDisplayName)
    expect(coerced.sentiment).toBe('negative')
    expect(coerced.urgency).toBe('high')
  })

  it('parseAndValidateImportAnalysisSheet aggregates row errors', () => {
    const rows = [
      buildValidRow(),
      buildValidRow({ 工单号: '', 用户情绪: '无效' }),
    ]
    const result = parseAndValidateImportAnalysisSheet({ headers: HEADERS, rows })
    expect(result.ok).toBe(false)
    expect(result.validRows).toHaveLength(1)
    expect(result.rowErrors.length).toBeGreaterThanOrEqual(2)
    expect(result.rowErrors.some((e) => e.rowIndex === 2 && e.displayName === '工单号')).toBe(true)
  })

  it('parseAndValidateImportAnalysisSheet returns file error for bad headers', () => {
    const result = parseAndValidateImportAnalysisSheet({
      headers: ['工单号'],
      rows: [buildValidRow()],
    })
    expect(result.ok).toBe(false)
    expect(result.fileError).toMatch(/缺少必填列/)
    expect(result.validRows).toEqual([])
  })

  it('parseAndValidateImportAnalysisSheet succeeds for valid sheet', () => {
    const result = parseAndValidateImportAnalysisSheet({
      headers: [...HEADERS, '多余列'],
      rows: [buildValidRow(), buildValidRow({ 工单号: 'T-101', 排期: '2026-Q2' })],
    })
    expect(result.ok).toBe(true)
    expect(result.validRows).toHaveLength(2)
    expect(result.rowErrors).toEqual([])
    expect(result.headerMatch.extraHeaders).toEqual(['多余列'])
  })
})

describe('importAnalysis apply (P3-3)', () => {
  const existingRecord = {
    id: 'rec-1',
    ticketId: 'T-100',
    customerRequest: '旧请求',
    painPoint: '旧痛点',
    problemSummary: '旧痛点',
    requestScene: '咨询',
    problemType: '使用问题',
    journeyL1: '开通',
    journeyL2: '激活',
    sentiment: 'neutral_inquiry',
    urgencyLevel: 'none',
    optimizationProduct: '旧产品优化',
    optimizationService: '旧服务优化',
    establishedAction: '旧举措',
    manualReviewOptimization: '旧举措',
    actionSchedule: '2026-07-01',
    rawText: '旧受理',
    handlingText: '旧处理',
    rootCauseReview: '旧根因',
    manualTagFields: ['journey'],
    note: '保留备注',
    status: 'open',
  }

  it('applyImportAnalysisToRecords overwrites matched record via IMPORT_REPLACE', () => {
    const validation = parseAndValidateImportAnalysisSheet({
      headers: HEADERS,
      rows: [
        buildValidRow({
          客户请求内容: '新请求',
          需求痛点: '新痛点',
          确立举措: '新举措',
          排期: '2026-Q3',
        }),
      ],
    })
    const result = applyImportAnalysisToRecords([existingRecord], validation.validRows)
    expect(result.appliedRowCount).toBe(1)
    expect(result.skippedRowCount).toBe(0)
    expect(result.updatedRecordCount).toBe(1)
    const updated = result.updatedRecords[0]
    expect(updated.customerRequest).toBe('新请求')
    expect(updated.painPoint).toBe('新痛点')
    expect(updated.establishedAction).toBe('新举措')
    expect(updated.actionSchedule).toBe('2026-Q3')
    expect(updated.note).toBe('保留备注')
    expect(updated.customerRequestSource).toBe('import')
    expect(updated.manualTagFields).toContain('customerRequest')
  })

  it('applyImportAnalysisToRecords empty cells clear fields', () => {
    const validation = parseAndValidateImportAnalysisSheet({
      headers: HEADERS,
      rows: [buildValidRow()],
    })
    expect(validation.validRows).toHaveLength(1)
    const row = validation.validRows[0]
    row.byDisplayName['确立举措'] = ''
    row.byDisplayName['排期'] = ''
    row.byDisplayName['产品组优化建议'] = ''
    row.byDisplayName['设计师优化建议'] = ''
    row.byDisplayName['产品技术优化'] = ''
    row.byDisplayName['服务流程改进'] = ''

    const result = applyImportAnalysisToRecords([existingRecord], [row])
    const updated = result.updatedRecords[0]
    expect(updated.establishedAction).toBe('')
    expect(updated.manualReviewOptimization).toBe('')
    expect(updated.actionSchedule).toBe('')
    expect(updated.productGroupOptimization).toBe('')
    expect(updated.designerOptimization).toBe('')
    expect(updated.optimizationProduct).toBe('旧产品优化')
    expect(updated.optimizationService).toBe('旧服务优化')
  })

  it('applyImportAnalysisToRecords does not overwrite auto optimization columns', () => {
    const validation = parseAndValidateImportAnalysisSheet({
      headers: HEADERS,
      rows: [
        buildValidRow({
          产品技术优化: '导入不应写入',
          服务流程改进: '导入不应写入',
        }),
      ],
    })
    const result = applyImportAnalysisToRecords([existingRecord], validation.validRows)
    const updated = result.updatedRecords[0]
    expect(updated.optimizationProduct).toBe('旧产品优化')
    expect(updated.optimizationService).toBe('旧服务优化')
  })

  it('applyImportAnalysisToRecords skips unknown ticketId (R3)', () => {
    const validation = parseAndValidateImportAnalysisSheet({
      headers: HEADERS,
      rows: [buildValidRow({ 工单号: 'T-UNKNOWN' })],
    })
    const result = applyImportAnalysisToRecords([existingRecord], validation.validRows)
    expect(result.appliedRowCount).toBe(0)
    expect(result.skippedRowCount).toBe(1)
    expect(result.updatedRecords).toEqual([])
    expect(result.skippedUnknownTicketIds).toEqual(['T-UNKNOWN'])
  })

  it('applyImportAnalysisToRecords does not change records absent from import file', () => {
    const other = { ...existingRecord, id: 'rec-2', ticketId: 'T-200' }
    const validation = parseAndValidateImportAnalysisSheet({
      headers: HEADERS,
      rows: [buildValidRow()],
    })
    const result = applyImportAnalysisToRecords([existingRecord, other], validation.validRows)
    expect(result.updatedById.has('rec-1')).toBe(true)
    expect(result.updatedById.has('rec-2')).toBe(false)
  })

  it('buildTicketIdIndex normalizes ticket ids', () => {
    const index = buildTicketIdIndex([
      { id: 'a', ticketId: '  T-100 ' },
      { id: 'b', ticketId: 'T-100' },
    ])
    expect(index.get('T-100')).toHaveLength(2)
  })

  it('P3-4: IMPORT_REPLACE sets import sources and full manualTagFields', () => {
    const validation = parseAndValidateImportAnalysisSheet({
      headers: HEADERS,
      rows: [buildValidRow()],
    })
    const result = applyImportAnalysisToRecords([existingRecord], validation.validRows)
    const updated = result.updatedRecords[0]

    expect(updated.manualTagFields?.sort()).toEqual(getImportManualDimensions().sort())
    expect(updated.customerRequestSource).toBe('import')
    expect(updated.painPointSource).toBe('import')
    expect(updated.optimizationSource).toBe('import')
    expect(getCustomerRequestSource(updated)).toBe('manual')
    expect(getPainPointSource(updated)).toBe('manual')
    expect(getOptimizationSourceLabel(updated.optimizationSource)).toBe('人工')
    expect(getTicketAnalysisSourceLabel('import')).toBe('人工')
  })

  it('validateImportFollowUpSatisfactionRaw accepts display format', () => {
    expect(validateImportFollowUpSatisfactionRaw('10（已解决）').ok).toBe(true)
    expect(validateImportFollowUpSatisfactionRaw('9').ok).toBe(true)
    expect(validateImportFollowUpSatisfactionRaw('').ok).toBe(true)
    expect(validateImportFollowUpSatisfactionRaw('invalid').ok).toBe(false)
  })

  it('applyImportAnalysisToRecords patches follow-up columns without changing unrelated fields', () => {
    const record = {
      ...existingRecord,
      followUpSatisfaction: {
        followUpTicketId: 'FH-OLD',
        followUpSuccessful: true,
        score: 8,
        problemResolved: 'unresolved',
        dissatisfiedReasons: '旧原因',
      },
    }
    const validation = parseAndValidateImportAnalysisSheet({
      headers: HEADERS,
      rows: [
        buildValidRow({
          回访满意度: '10（已解决）',
          不满意原因: '响应慢',
        }),
      ],
    })
    const result = applyImportAnalysisToRecords([record], validation.validRows)
    const updated = result.updatedRecords[0]
    expect(updated.customerRequest).toBe('请求内容')
    expect(updated.followUpSatisfaction?.score).toBe(10)
    expect(updated.followUpSatisfaction?.problemResolved).toBe('resolved')
    expect(updated.followUpSatisfaction?.dissatisfiedReasons).toBe('响应慢')
    expect(updated.followUpSatisfaction?.followUpTicketId).toBe('FH-OLD')
  })
})

/**
 * @param {import('./types.js').FeedbackRecord} record
 * @param {(row: Record<string, string>) => Record<string, string>} [mutateExportRow]
 */
function roundTripThroughImportAnalysis(record, mutateExportRow) {
  let exportRow = recordToExportRowV2(record)
  if (mutateExportRow) exportRow = mutateExportRow(exportRow)

  const validation = parseAndValidateImportAnalysisSheet({
    headers: getImportAnalysisTemplateHeaders(),
    rows: [exportRow],
  })
  expect(validation.ok, validation.rowErrors.map((e) => `${e.displayName}: ${e.message}`).join('; ')).toBe(
    true,
  )

  const applied = applyImportAnalysisToRecords([record], validation.validRows)
  expect(applied.updatedRecords).toHaveLength(1)
  const imported = applied.updatedRecords[0]
  expect(recordToExportRowV2(imported)).toEqual(exportRow)
  return imported
}

describe('importAnalysis round-trip (P3-6)', () => {
  it('export v2 → import yields zero export diff for complaint fixture', () => {
    const record = {
      ...EXPORT_V2_UAT_COMPLAINT_SAMPLES[0],
      note: '应保留的备注',
    }
    const imported = roundTripThroughImportAnalysis(record)
    expect(imported.id).toBe(record.id)
    expect(imported.note).toBe('应保留的备注')
    expect(imported.complaintCauseL1Final).toBe(record.complaintCauseL1Final)
  })

  it('modified export columns round-trip through validate + apply', () => {
    const record = EXPORT_V2_UAT_COMPLAINT_SAMPLES[0]
    roundTripThroughImportAnalysis(record, (row) => ({
      ...row,
      客户请求内容: '往返修改后的客户请求',
      确立举措: '往返修改后的举措',
      用户情绪: '轻度不满',
    }))
  })

  it('empty 排期 round-trips after export edit (R1)', () => {
    const record = {
      ...EXPORT_V2_UAT_COMPLAINT_SAMPLES[0],
      actionSchedule: '',
    }
    const imported = roundTripThroughImportAnalysis(record)
    expect(imported.actionSchedule).toBe('')
    expect(recordToExportRowV2(imported)['排期']).toBe('')
  })

  it('follow-up satisfaction round-trips through export and import', () => {
    const record = {
      ...EXPORT_V2_UAT_COMPLAINT_SAMPLES[0],
      followUpSatisfaction: {
        followUpTicketId: 'FH-RT-1',
        followUpSuccessful: true,
        score: 9,
        problemResolved: 'unresolved',
        dissatisfiedReasons: '等待久',
      },
    }
    const imported = roundTripThroughImportAnalysis(record, (row) => ({
      ...row,
      回访满意度: '10（已解决）',
      不满意原因: '已改善',
    }))
    expect(imported.followUpSatisfaction?.score).toBe(10)
    expect(imported.followUpSatisfaction?.problemResolved).toBe('resolved')
    expect(imported.followUpSatisfaction?.dissatisfiedReasons).toBe('已改善')
    expect(imported.requestScene).toBe(record.requestScene)
  })

  it('unknown ticketId is skipped without mutating library record', () => {
    const record = EXPORT_V2_UAT_COMPLAINT_SAMPLES[0]
    const exportRow = recordToExportRowV2(record)
    exportRow['工单号'] = 'NOT-IN-LIBRARY-999'

    const validation = parseAndValidateImportAnalysisSheet({
      headers: getImportAnalysisTemplateHeaders(),
      rows: [exportRow],
    })
    expect(validation.ok).toBe(true)

    const applied = applyImportAnalysisToRecords([record], validation.validRows)
    expect(applied.updatedRecords).toEqual([])
    expect(applied.skippedUnknownTicketIds).toEqual(['NOT-IN-LIBRARY-999'])
    expect(recordToExportRowV2(record)).toEqual(recordToExportRowV2(EXPORT_V2_UAT_COMPLAINT_SAMPLES[0]))
  })
})
