import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isComplaintTicket } from '../domain/complaintCause.js'
import { getActionScheduleDisplay } from '../domain/actionSchedule.js'
import { getEstablishedActionDisplay } from '../domain/establishedAction.js'
import {
  buildCustomerRequestManualSavePatch,
  buildCustomerRequestSavePatch,
  buildPainPointManualSavePatch,
  buildPainPointSavePatch,
  getCustomerRequestDraftDisplay,
  getPainPointDraftDisplay,
} from '../domain/ticketAnalysisManualFields.js'
import {
  getEffectiveRootCauseReview,
  getRootCauseReviewDraftDisplay,
  shouldIncludeRootCauseReviewInSave,
} from '../domain/rootCauseReview.js'
import { buildEstablishedActionSavePatch } from '../domain/establishedAction.js'
import { buildActionScheduleSavePatch } from '../domain/actionSchedule.js'
import { buildDetailOptimizationSavePatch } from '../domain/detailOptimizationFields.js'
import { mergeManualTagFieldsOnUserEdit } from '../lib/manualTagFields.js'
import { recordToExportRowV2 } from '../lib/ticketAnalysisExport.js'
import {
  getAutoOptimizationSource,
  getCustomerRequestSource,
  getOptimizationSourceLabel,
  getPainPointSource,
  getTicketAnalysisSourceLabel,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'
import {
  DETAIL_DRAWER_UAT_ALL_SAMPLES,
  DETAIL_DRAWER_UAT_COMPLAINT_SAMPLES,
  DETAIL_DRAWER_UAT_CONSULTATION_SAMPLES,
} from '../lib/ticketAnalysis/fixtures/detailDrawerUatSamples.js'

/**
 * P2-7 工单详情 UAT：样例 + 保存/导出/来源 Tag 一致性（无 DOM 渲染 harness）。
 * @see docs/FEEDBACK-DRAWER-UAT.md
 */

function simulateDetailSave(existing, patch) {
  const manualTagFields = mergeManualTagFieldsOnUserEdit(existing, patch)
  return { ...existing, ...patch, manualTagFields }
}

function buildDetailSavePatchFromRecord(record) {
  const customerRequest = getCustomerRequestDraftDisplay(record)
  const painPoint = getPainPointDraftDisplay(record)
  const establishedAction = getEstablishedActionDisplay(record)
  const patch = {
    note: record.note || '',
    requestScene: record.requestScene || '',
    problemType: record.problemType || '',
    ...buildCustomerRequestSavePatch(record, customerRequest),
    ...buildPainPointSavePatch(record, painPoint),
    ...buildEstablishedActionSavePatch(establishedAction),
    ...buildActionScheduleSavePatch(record.actionSchedule || ''),
    ...buildDetailOptimizationSavePatch({
      productGroupOptimization: record.productGroupOptimization || '',
      designerOptimization: record.designerOptimization || '',
    }),
  }
  if (shouldIncludeRootCauseReviewInSave(record, Boolean(record.rootCauseReview?.trim()))) {
    patch.rootCauseReview = record.rootCauseReview || ''
  }
  return patch
}

describe('FeedbackDrawer UAT (P2-7)', () => {
  const drawerSrc = readFileSync(
    resolve(import.meta.dirname, 'FeedbackDrawer.jsx'),
    'utf8',
  )

  describe('sample coverage', () => {
    it('includes 5 complaint + 5 consultation fixtures', () => {
      expect(DETAIL_DRAWER_UAT_COMPLAINT_SAMPLES).toHaveLength(5)
      expect(DETAIL_DRAWER_UAT_CONSULTATION_SAMPLES).toHaveLength(5)
      expect(DETAIL_DRAWER_UAT_ALL_SAMPLES).toHaveLength(10)
    })

    it('complaint samples are complaint tickets; consultation are not', () => {
      for (const record of DETAIL_DRAWER_UAT_COMPLAINT_SAMPLES) {
        expect(isComplaintTicket(record)).toBe(true)
        expect(record.dataSourceType).toBe('complaint_ticket')
      }
      for (const record of DETAIL_DRAWER_UAT_CONSULTATION_SAMPLES) {
        expect(isComplaintTicket(record)).toBe(false)
        expect(record.dataSourceType).toBe('consultation_ticket')
      }
    })
  })

  describe('B2 终判 vs 咨询无终判', () => {
    it('shows final complaint cause in classification section only when isComplaintTicket', () => {
      expect(drawerSrc).toMatch(/isComplaintTicket\(feedback\) \? \([\s\S]*投诉原因（终判）/)
      expect(drawerSrc).toMatch(/一级（终判）/)
      expect(drawerSrc).not.toMatch(/getComplaintCauseFinalDisplay\(feedback\)/)
    })
  })

  describe('canEdit vs read-only paths', () => {
    it('editable fields use TextArea/Input under canEdit', () => {
      expect(drawerSrc).toMatch(
        /shrink-0">客户请求内容<[\s\S]*?\{canEdit \? \([\s\S]*?Input\.TextArea/,
      )
      expect(drawerSrc).toMatch(
        /shrink-0">需求痛点挖掘<[\s\S]*?\{canEdit \? \([\s\S]*?Input\.TextArea/,
      )
      expect(drawerSrc).toMatch(/canEdit \? \([\s\S]*确立举措/)
      expect(drawerSrc).toMatch(/title="根因排查"[\s\S]*自动生成/)
      expect(drawerSrc).toMatch(/title="根因排查"[\s\S]*getAutoRootCauseDisplay\(feedback\)/)
      expect(drawerSrc).toMatch(
        /getRecordRevision\(cachedFeedback\) > getRecordRevision\(fullFeedback\)/,
      )
      expect(drawerSrc).toMatch(
        /title="根因排查"[\s\S]*?\{canEdit \? \([\s\S]*rootCauseReview/,
      )
    })

    it('read-only path uses display helpers in canEdit else branches', () => {
      expect(drawerSrc).toMatch(
        /shrink-0">客户请求内容<[\s\S]*?\{canEdit \? \([\s\S]*?\) : \([\s\S]*getDisplayCustomerRequest\(feedback\)/,
      )
      expect(drawerSrc).toMatch(
        /shrink-0">需求痛点挖掘<[\s\S]*?\{canEdit \? \([\s\S]*?\) : \([\s\S]*getDisplayPainPoint\(feedback\)/,
      )
      expect(drawerSrc).toMatch(
        /title="根因排查"[\s\S]*getRootCauseReviewDraftDisplay\(feedback\)/,
      )
    })
  })

  describe('detail save → export consistency', () => {
    it.each(DETAIL_DRAWER_UAT_ALL_SAMPLES.map((r) => [r.id, r]))(
      '%s save patch reflects in export v2 row',
      (_id, record) => {
        const patch = buildDetailSavePatchFromRecord(record)
        const saved = simulateDetailSave(record, patch)
        const row = recordToExportRowV2(saved)

        expect(row['客户请求内容']).toBe(saved.customerRequest || '')
        expect(row['需求痛点']).toBe(saved.painPoint || saved.problemSummary || '')
        expect(row['确立举措']).toBe(getEstablishedActionDisplay(saved))
        expect(row['排期']).toBe(saved.actionSchedule || '')
        expect(row['根因排查']).toBe(getEffectiveRootCauseReview(saved))
      },
    )
  })

  describe('P2 field behaviors on fixtures', () => {
    it('uat-c-01: stored rootCauseReview exports directly', () => {
      const record = DETAIL_DRAWER_UAT_COMPLAINT_SAMPLES[0]
      expect(getRootCauseReviewDraftDisplay(record)).toBe('安全组未放行 22 端口')
      expect(recordToExportRowV2(record)['根因排查']).toBe('安全组未放行 22 端口')
    })

    it('uat-c-03: root cause draft falls back without manual rootCauseReview', () => {
      const record = DETAIL_DRAWER_UAT_COMPLAINT_SAMPLES[2]
      expect(getRootCauseReviewDraftDisplay(record)).toBe('磁盘使用率 100%')
      expect(recordToExportRowV2(record)['根因排查']).toBe('磁盘使用率 100%')
    })

    it('uat-c-02: legacy manualReviewOptimization reads as 确立举措 without changing auto optimization source', () => {
      const record = DETAIL_DRAWER_UAT_COMPLAINT_SAMPLES[1]
      expect(getEstablishedActionDisplay(record)).toBe('legacy 人工复核举措文本')
      expect(getAutoOptimizationSource(record)).toBe('rule')
    })

    it('uat-z-05: import sources display as 人工 tags', () => {
      const record = DETAIL_DRAWER_UAT_CONSULTATION_SAMPLES.find((r) => r.id === 'uat-z-05')
      expect(record).toBeTruthy()
      expect(getCustomerRequestSource(record)).toBe('manual')
      expect(getPainPointSource(record)).toBe('manual')
      expect(getAutoOptimizationSource(record)).toBe('manual')
      expect(getTicketAnalysisSourceLabel('import')).toBe('人工')
    })

    it('uat-z-06: empty schedule displays 待评估 in read-only helper', () => {
      const record = DETAIL_DRAWER_UAT_CONSULTATION_SAMPLES.find((r) => r.id === 'uat-z-06')
      expect(record).toBeFalsy()
      expect(getActionScheduleDisplay('')).toBe('待评估')
    })
  })

  describe('detail edit simulation', () => {
    it('editing customerRequest marks dimension and preserves on merge', () => {
      const record = DETAIL_DRAWER_UAT_CONSULTATION_SAMPLES[0]
      const patch = buildCustomerRequestManualSavePatch('人工修改后的客户请求内容')
      const saved = simulateDetailSave(record, patch)
      expect(saved.manualTagFields).toContain('customerRequest')
      expect(saved.customerRequestSource).toBe('manual')
      expect(recordToExportRowV2(saved)['客户请求内容']).toBe('人工修改后的客户请求内容')
    })

    it('unchanged detail save does not re-mark request/pain as manual', () => {
      const record = {
        ...DETAIL_DRAWER_UAT_CONSULTATION_SAMPLES[0],
        customerRequestSource: 'llm',
        painPointSource: 'llm',
      }
      const patch = buildDetailSavePatchFromRecord(record)
      const saved = simulateDetailSave(record, patch)
      expect(saved.customerRequestSource).toBe('llm')
      expect(saved.painPointSource).toBe('llm')
      expect(saved.manualTagFields || []).not.toContain('customerRequest')
      expect(saved.manualTagFields || []).not.toContain('painPoint')
    })

    it('full detail save marks optimization when human optimization field changes', () => {
      const record = DETAIL_DRAWER_UAT_COMPLAINT_SAMPLES[0]
      const patch = buildDetailSavePatchFromRecord(record)
      patch.actionSchedule = '2026-12-01'
      const saved = simulateDetailSave(record, patch)
      expect(saved.manualTagFields).toContain('optimization')
      expect(getEstablishedActionDisplay(saved)).toBe('增加 ENI 连通性预检')
    })
  })
})
