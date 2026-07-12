import { describe, expect, it } from 'vitest'
import {
  FIELD_REGISTRY,
  getExportColumns,
  getFieldByKey,
  getFieldsByClusterRole,
  getImportColumns,
  getImportDisplayNameToFieldKey,
  getImportManualDimensions,
  getImportRequiredDisplayNames,
  getLegacyFields,
  isFieldApplicable,
  readFieldValue,
} from './fieldRegistry.js'

const EXPECTED_V2_HEADERS = [
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
  '未完成待办',
  '受理内容',
  '处理意见',
  '根因排查',
]

describe('fieldRegistry', () => {
  it('exports v2 column order matches design (22 columns)', () => {
    const cols = getExportColumns()
    expect(cols).toHaveLength(22)
    expect(cols.map((c) => c.displayName)).toEqual(EXPECTED_V2_HEADERS)
  })

  it('import columns match exportable importable v2 set', () => {
    const imp = getImportColumns()
    const exp = getExportColumns().filter((c) => c.importable)
    expect(imp.map((c) => c.fieldKey)).toEqual(exp.map((c) => c.fieldKey))
  })

  it('import required excludes 排期 (R1) and optional manual/source columns', () => {
    const required = getImportRequiredDisplayNames()
    expect(required).toContain('产品名称')
    expect(required).not.toContain('排期')
    expect(required).not.toContain('确立举措')
    expect(required).toContain('处理意见')
    expect(required).not.toContain('根因排查')
    expect(required).not.toContain('受理内容')
    expect(required).not.toContain('是否加急')
    expect(required).not.toContain('产品技术优化')
    expect(required).not.toContain('服务流程改进')
    expect(required).not.toContain('产品组优化建议')
    expect(required).not.toContain('设计师优化建议')
  })

  it('getFieldByKey returns definition', () => {
    const f = getFieldByKey('establishedAction')
    expect(f?.displayName).toBe('确立举措')
    expect(f?.recordPaths).toContain('manualReviewOptimization')
    expect(f?.clusterRole).toBe('optimizationCorpus')
  })

  it('legacy fields are excluded from export/import by default', () => {
    const legacy = getLegacyFields()
    expect(legacy.length).toBeGreaterThanOrEqual(5)
    expect(legacy.every((f) => f.legacy === true)).toBe(true)
    expect(legacy.map((f) => f.fieldKey)).toEqual(
      expect.arrayContaining([
        'manualReviewRootCause',
        'manualReviewSolution',
        'manualReviewAction',
        'problemSummaryLegacy',
      ]),
    )
    expect(getExportColumns().some((f) => f.legacy)).toBe(false)
    expect(getImportColumns().some((f) => f.legacy)).toBe(false)
  })

  it('complaint-only fields not applicable to consultation', () => {
    const l1 = getFieldByKey('complaintCauseL1Final')
    expect(l1).toBeDefined()
    expect(isFieldApplicable(l1, 'complaint_ticket')).toBe(true)
    expect(isFieldApplicable(l1, 'consultation_ticket')).toBe(false)
    expect(getExportColumns({ dataSourceType: 'consultation_ticket' })).toHaveLength(22)
  })

  it('follow-up fields apply to complaint and consultation only', () => {
    const followUp = getFieldByKey('followUpSatisfaction')
    expect(followUp?.exportOrder).toBe(11)
    expect(isFieldApplicable(followUp, 'complaint_ticket')).toBe(true)
    expect(isFieldApplicable(followUp, 'consultation_ticket')).toBe(true)
    expect(isFieldApplicable(followUp, 'post_use_rating')).toBe(false)
    expect(getExportColumns({ dataSourceType: 'post_use_rating' })).not.toContainEqual(
      expect.objectContaining({ fieldKey: 'followUpSatisfaction' }),
    )
  })

  it('readFieldValue formats follow-up satisfaction fields', () => {
    const record = {
      followUpSatisfaction: {
        followUpTicketId: 'FH-1',
        followUpSuccessful: true,
        score: 9,
        problemResolved: 'unresolved',
        dissatisfiedReasons: '响应慢',
      },
    }
    expect(readFieldValue(record, getFieldByKey('followUpSatisfaction'))).toBe('9（未解决）')
    expect(readFieldValue(record, getFieldByKey('followUpDissatisfiedReasons'))).toBe('响应慢')
  })

  it('cluster roles: pain primary and optimization corpus', () => {
    expect(getFieldsByClusterRole('painPrimary').map((f) => f.fieldKey)).toEqual(['painPoint'])
    const corpusKeys = getFieldsByClusterRole('optimizationCorpus').map((f) => f.fieldKey)
    expect(corpusKeys).toContain('establishedAction')
    expect(corpusKeys).toContain('optimizationProduct')
    expect(getFieldByKey('productGroupOptimization')?.clusterRole).toBe('none')
    expect(getFieldByKey('designerOptimization')?.clusterRole).toBe('none')
  })

  it('provenance fields are not exportable', () => {
    for (const key of ['customerRequestSource', 'painPointSource', 'optimizationSource']) {
      const f = getFieldByKey(key)
      expect(f?.exportable).toBe(false)
      expect(f?.importable).toBe(false)
    }
  })

  it('getImportManualDimensions includes import dimensions', () => {
    const dims = getImportManualDimensions()
    expect(dims).toContain('customerRequest')
    expect(dims).toContain('painPoint')
    expect(dims).toContain('optimization')
    expect(dims).toContain('rootCauseReview')
  })

  it('getImportDisplayNameToFieldKey maps headers', () => {
    const map = getImportDisplayNameToFieldKey()
    expect(map['需求痛点']).toBe('painPoint')
    expect(map['是否加急']).toBe('urgency')
  })

  it('readFieldValue uses recordPaths fallback', () => {
    expect(
      readFieldValue(
        { painPoint: '', problemSummary: '摘要痛点' },
        getFieldByKey('painPoint'),
      ),
    ).toBe('摘要痛点')
    expect(
      readFieldValue(
        { manualReviewOptimization: '人工举措', establishedAction: '' },
        getFieldByKey('establishedAction'),
      ),
    ).toBe('人工举措')
  })

  it('FIELD_REGISTRY has unique fieldKeys', () => {
    const keys = Object.keys(FIELD_REGISTRY)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
