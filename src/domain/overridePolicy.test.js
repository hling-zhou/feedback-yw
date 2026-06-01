import { describe, expect, it } from 'vitest'
import {
  OVERRIDE_POLICY,
  applyForceAllHumanOverrides,
  applyImportReplace,
  applyOverridePolicy,
  applyPostProcessOverridePolicy,
  isForceOverridePolicy,
  parseImportSentiment,
  parseImportUrgency,
  resolveRootCauseReviewFallback,
  writeImportField,
} from './overridePolicy.js'

const baseRecord = {
  id: '1',
  rawText: '受理原文',
  handlingText: '处理原文',
  customerQuote: '',
  requestScene: '咨询',
  problemType: '使用问题',
  journeyL1: '开通',
  journeyL2: '激活',
  problemSummary: '旧痛点',
  painPoint: '旧痛点',
  customerRequest: '旧请求',
  sentiment: 'neutral_inquiry',
  urgencyLevel: 'none',
  themes: ['激活'],
  status: 'open',
  note: '备注保留',
  manualTagFields: ['journey', 'optimization'],
  manualReviewRootCause: 'legacy根因',
  manualReviewSolution: 'legacy方案',
  manualReviewAction: 'legacy举措',
  manualReviewOptimization: '人工举措',
  establishedAction: '确立A',
  actionId: 'act-1',
  actionSchedule: '2026-07-01',
  productGroupOptimization: '产品组建议',
  designerOptimization: '设计师建议',
  rootCauseReview: '人工根因排查',
  rootCause: '结构化根因',
  sourceColumns: { 问题原因: '列快照根因' },
  complaintCauseL1Final: '性能类',
  importedAt: '2026-01-01',
}

describe('overridePolicy', () => {
  it('resolveRootCauseReviewFallback prefers 问题原因 column', () => {
    expect(resolveRootCauseReviewFallback(baseRecord)).toBe('列快照根因')
    expect(
      resolveRootCauseReviewFallback({
        ...baseRecord,
        sourceColumns: {},
      }),
    ).toBe('结构化根因')
  })

  it('FORCE_ALL_HUMAN clears human fields and resets rootCauseReview', () => {
    const out = applyForceAllHumanOverrides(baseRecord)
    expect(out.manualTagFields).toEqual([])
    expect(out.manualReviewOptimization).toBe('')
    expect(out.establishedAction).toBe('')
    expect(out.actionId).toBe('')
    expect(out.actionSchedule).toBe('')
    expect(out.productGroupOptimization).toBe('')
    expect(out.designerOptimization).toBe('')
    expect(out.manualReviewRootCause).toBe('')
    expect(out.rootCauseReview).toBe('列快照根因')
    expect(out.note).toBe('备注保留')
    expect(out.rawText).toBe('受理原文')
    expect(out.complaintCauseL1Final).toBe('性能类')
  })

  it('applyOverridePolicy FORCE delegates to force helper', () => {
    const out = applyOverridePolicy(baseRecord, OVERRIDE_POLICY.FORCE_ALL_HUMAN)
    expect(out.manualTagFields).toEqual([])
    expect(out.rootCauseReview).toBe('列快照根因')
  })

  it('RESPECT_MANUAL returns record unchanged', () => {
    const out = applyOverridePolicy(baseRecord, OVERRIDE_POLICY.RESPECT_MANUAL)
    expect(out).toEqual(baseRecord)
  })

  it('isForceOverridePolicy identifies force policy', () => {
    expect(isForceOverridePolicy(OVERRIDE_POLICY.FORCE_ALL_HUMAN)).toBe(true)
    expect(isForceOverridePolicy(OVERRIDE_POLICY.RESPECT_MANUAL)).toBe(false)
  })

  it('parseImportSentiment and urgency from Chinese labels', () => {
    expect(parseImportSentiment('不满')).toBe('negative')
    expect(parseImportSentiment('')).toBe('neutral_inquiry')
    expect(parseImportUrgency('加急')).toBe('high')
    expect(parseImportUrgency('')).toBe('none')
  })

  it('applyImportReplace overwrites fields including empty cells', () => {
    const out = applyImportReplace(baseRecord, {
      工单号: 'T-100',
      客户请求内容: '新请求',
      需求痛点: '新痛点',
      请求场景: '投诉',
      问题类型: '故障',
      用户旅程一级: '使用',
      用户旅程二级: '监控',
      用户情绪: '不满',
      是否加急: '加急',
      产品技术优化: '产品优化',
      服务流程改进: '服务优化',
      确立举措: '新举措',
      排期: '',
      受理内容: '新受理',
      处理意见: '新处理',
      根因排查: '新根因排查',
    })

    expect(out.ticketId).toBe('T-100')
    expect(out.customerRequest).toBe('新请求')
    expect(out.painPoint).toBe('新痛点')
    expect(out.problemSummary).toBe('新痛点')
    expect(out.sentiment).toBe('negative')
    expect(out.urgencyLevel).toBe('high')
    expect(out.establishedAction).toBe('新举措')
    expect(out.manualReviewOptimization).toBe('新举措')
    expect(out.actionSchedule).toBe('')
    expect(out.rawText).toBe('新受理')
    expect(out.handlingText).toBe('新处理')
    expect(out.rootCauseReview).toBe('新根因排查')
    expect(out.customerRequestSource).toBe('import')
    expect(out.painPointSource).toBe('import')
    expect(out.optimizationSource).toBe('import')
    expect(out.manualTagFields).toContain('customerRequest')
    expect(out.manualTagFields).toContain('painPoint')
    expect(out.manualTagFields).toContain('optimization')
    expect(out.note).toBe('备注保留')
  })

  it('IMPORT_REPLACE empty 排期 clears schedule', () => {
    const out = applyImportReplace(baseRecord, {
      工单号: 'T-1',
      客户请求内容: 'a',
      需求痛点: 'b',
      请求场景: 'c',
      问题类型: 'd',
      用户旅程一级: 'e',
      用户旅程二级: 'f',
      用户情绪: '中性·咨询',
      是否加急: '',
      产品技术优化: 'g',
      服务流程改进: 'h',
      确立举措: 'i',
      排期: '',
      受理内容: 'j',
      处理意见: 'k',
      根因排查: 'l',
    })
    expect(out.actionSchedule).toBe('')
  })

  it('applyOverridePolicy IMPORT_REPLACE requires importRow', () => {
    expect(() => applyOverridePolicy(baseRecord, OVERRIDE_POLICY.IMPORT_REPLACE)).toThrow(
      /importRow/,
    )
  })

  it('applyPostProcessOverridePolicy preserves manual tags when RESPECT_MANUAL', () => {
    const processed = {
      ...baseRecord,
      journeyL1: '重算一级',
      manualTagFields: [],
    }
    const out = applyPostProcessOverridePolicy(baseRecord, processed, OVERRIDE_POLICY.RESPECT_MANUAL)
    expect(out.journeyL1).toBe('开通')
    expect(out.manualTagFields).toContain('journey')
  })

  it('applyPostProcessOverridePolicy skips preserve when FORCE', () => {
    const processed = {
      ...baseRecord,
      journeyL1: '重算一级',
      manualTagFields: [],
    }
    const out = applyPostProcessOverridePolicy(
      baseRecord,
      processed,
      OVERRIDE_POLICY.FORCE_ALL_HUMAN,
    )
    expect(out.journeyL1).toBe('重算一级')
  })

  it('writeImportField syncs journey themes', () => {
    const out = writeImportField(baseRecord, 'journeyL2', '新二级')
    expect(out.journeyL2).toBe('新二级')
    expect(out.themes).toEqual(['新二级'])
  })
})
