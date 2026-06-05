import { describe, expect, it } from 'vitest'
import {
  EXPORT_ANALYSIS_VERSION,
  formatExportSourceMonthSheetName,
  getExportV3Headers,
  groupRecordsBySourceAndMonth,
  recordToExportRowV3,
} from './ticketAnalysisExport.js'

const baseRecord = {
  id: '1',
  rawText: '【受理内容】客户报障端口不通',
  handlingText: '已协助排查并放行端口',
  customerQuote: '',
  requestScene: '报障与排错',
  problemType: '产品功能咨询',
  journeyL1: '使用',
  journeyL2: '监控告警',
  problemSummary: '端口不通',
  painPoint: '端口不通',
  customerRequest: '希望开通端口访问',
  sentiment: 'negative',
  urgencyLevel: 'high',
  themes: ['监控告警'],
  status: 'open',
  importedAt: '2026-01-01',
  ticketId: 'T-001',
  product: '云主机',
  optimizationProduct: '产品优化A',
  optimizationService: '流程优化B',
  manualReviewOptimization: '人工确立举措',
  actionSchedule: '2026-08-01',
  rootCause: '安全组未放行',
  sourceColumns: { 问题原因: '列快照根因' },
  dataSourceType: 'complaint_ticket',
  complaintCauseL1Final: '性能类',
}

describe('ticketAnalysisExport v3', () => {
  it('EXPORT_ANALYSIS_VERSION is 3', () => {
    expect(EXPORT_ANALYSIS_VERSION).toBe(3)
  })

  it('getExportV3Headers returns 21 columns in registry order', () => {
    expect(getExportV3Headers()).toEqual([
      '工单号',
      '产品名称',
      '客户请求内容',
      '需求痛点',
      '请求场景',
      '问题类型',
      '用户旅程一级',
      '用户旅程二级',
      '用户情绪',
      '是否加急',
      '回访满意度',
      '不满意原因',
      '产品技术优化',
      '服务流程改进',
      '产品组优化建议',
      '设计师优化建议',
      '确立举措',
      '排期',
      '受理内容',
      '处理意见',
      '根因排查',
    ])
  })

  it('recordToExportRowV3 maps fields with sentiment/urgency labels and no legacy columns', () => {
    const row = recordToExportRowV3(baseRecord)
    expect(Object.keys(row)).toEqual(getExportV3Headers())
    expect(row['工单号']).toBe('T-001')
    expect(row['产品名称']).toBe('云主机')
    expect(row['客户请求内容']).toBe('希望开通端口访问')
    expect(row['需求痛点']).toBe('端口不通')
    expect(row['用户情绪']).toBe('不满')
    expect(row['是否加急']).toBe('加急')
    expect(row['确立举措']).toBe('人工确立举措')
    expect(row['排期']).toBe('2026-08-01')
    expect(row['产品组优化建议']).toBe('')
    expect(row['设计师优化建议']).toBe('')
    expect(row['受理内容']).toContain('客户报障')
    expect(row['处理意见']).toBe('已协助排查并放行端口')
    expect(row['根因排查']).toBe('列快照根因')
    expect(row).not.toHaveProperty('投诉原因（终判）')
    expect(row).not.toHaveProperty('客户请求来源')
    expect(row).not.toHaveProperty('根因（人工复核）')
    expect(row).not.toHaveProperty('问题摘要')
  })

  it('exports follow-up satisfaction columns when present', () => {
    const row = recordToExportRowV3({
      ...baseRecord,
      followUpSatisfaction: {
        followUpTicketId: 'FH-1',
        followUpSuccessful: true,
        score: 10,
        problemResolved: 'resolved',
        dissatisfiedReasons: '无',
      },
    })
    expect(row['回访满意度']).toBe('10（已解决）')
    expect(row['不满意原因']).toBe('')
  })

  it('acceptanceContent prefers sourceColumns 受理内容 over structured rawText parsing', () => {
    const row = recordToExportRowV3({
      ...baseRecord,
      rawText: '',
      sourceColumns: { 受理内容: '20260506144725X450975120 受理原文' },
    })
    expect(row['受理内容']).toBe('20260506144725X450975120 受理原文')
  })

  it('consultation ticket export has no 终判 column and same v3 shape', () => {
    const row = recordToExportRowV3({
      ...baseRecord,
      dataSourceType: 'consultation_ticket',
      problemType: '计费与账单',
      complaintCauseL1Final: '不应导出',
    })
    expect(Object.keys(row)).toEqual(getExportV3Headers())
    expect(row).not.toHaveProperty('投诉原因（终判）')
    expect(row['问题类型']).toBe('计费与账单')
  })

  it('establishedAction prefers establishedAction over manualReviewOptimization', () => {
    expect(
      recordToExportRowV3({
        ...baseRecord,
        establishedAction: '新确立',
        manualReviewOptimization: '旧人工',
      })['确立举措'],
    ).toBe('新确立')
  })

  it('exports product group and designer optimization suggestions', () => {
    const row = recordToExportRowV3({
      ...baseRecord,
      productGroupOptimization: '统一交互规范',
      designerOptimization: '优化绑定成功页层级',
    })
    expect(row['产品组优化建议']).toBe('统一交互规范')
    expect(row['设计师优化建议']).toBe('优化绑定成功页层级')
  })

  it('empty optional fields export as empty strings', () => {
    const row = recordToExportRowV3({
      ...baseRecord,
      actionSchedule: '',
      optimizationService: '',
      manualReviewOptimization: '',
      establishedAction: '',
      rootCauseReview: '',
      sourceColumns: {},
      rootCause: '',
      urgencyLevel: 'none',
    })
    expect(row['排期']).toBe('')
    expect(row['服务流程改进']).toBe('')
    expect(row['确立举措']).toBe('')
    expect(row['是否加急']).toBe('')
    expect(row['根因排查']).toBe('')
  })

  it('rootCauseReview stored value takes precedence over fallback', () => {
    expect(
      recordToExportRowV3({
        ...baseRecord,
        rootCauseReview: '人工根因排查',
        sourceColumns: { 问题原因: '列根因' },
      })['根因排查'],
    ).toBe('人工根因排查')
  })

  it('groupRecordsBySourceAndMonth splits by data source and importMonth', () => {
    const groups = groupRecordsBySourceAndMonth([
      { ...baseRecord, id: '1', importMonth: '2026-05', dataSourceType: 'complaint_ticket' },
      { ...baseRecord, id: '2', importMonth: '2026-05', dataSourceType: 'consultation_ticket' },
      { ...baseRecord, id: '3', importMonth: '2026-04', dataSourceType: 'complaint_ticket' },
      { ...baseRecord, id: '4', dataSourceType: 'complaint_ticket' },
    ])
    expect(groups.size).toBe(4)
    expect(groups.get(`complaint_ticket\0${'2026-05'}`)).toHaveLength(1)
    expect(groups.get(`consultation_ticket\0${'2026-05'}`)).toHaveLength(1)
  })

  it('formatExportSourceMonthSheetName matches design labels', () => {
    expect(formatExportSourceMonthSheetName('complaint_ticket', '2026-05')).toBe(
      '投诉工单-2026年5月',
    )
    expect(formatExportSourceMonthSheetName('consultation_ticket', '')).toBe(
      '咨询工单-未知月份',
    )
  })
})
