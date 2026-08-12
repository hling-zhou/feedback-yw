import { describe, expect, it } from 'vitest'
import { mergeTicketImportOverExisting, preserveUserEditedTicketFields } from './ticketImportMerge.js'

const existing = {
  id: 'rec-existing',
  dataSourceType: 'complaint_ticket',
  ticketId: 'T-1',
  tenantId: 'local',
  rawText: '旧受理',
  handlingText: '旧处理',
  requestScene: '人工场景',
  problemType: '人工类型',
  journeyL1: '人工旅程',
  journeyL2: '人工子旅程',
  sentiment: 'negative',
  urgencyLevel: 'high',
  customerRequest: '人工请求',
  painPoint: '人工痛点',
  problemSummary: '人工痛点',
  customerRequestSource: 'manual',
  painPointSource: 'manual',
  note: '用户备注',
  status: 'in_progress',
  ticketTodo: { items: [{ id: 'td-1', text: '跟进', done: false }] },
  listeningReviewed: true,
  establishedAction: '确立举措A',
  establishedActionDetail: '详情',
  actionId: 'act-1',
  actionSchedule: '2026-08-01',
  productGroupOptimization: '产品组',
  designerOptimization: '设计',
  manualReviewOptimization: '人工优化',
  complaintCauseL1Final: '旧终判一级',
  complaintCauseL2Review: '复核二级',
  complaintCauseL3Review: '复核三级',
  followUpSatisfaction: { followUpTicketId: 'FH-1', score: 8, followUpSuccessful: true },
  manualTagFields: ['requestScene', 'problemType', 'customerRequest', 'painPoint', 'complaintCauseReview'],
  themes: ['人工旅程'],
}

const incoming = {
  id: 'rec-new',
  dataSourceType: 'complaint_ticket',
  ticketId: 'T-1',
  tenantId: 'other',
  rawText: '新受理',
  handlingText: '新处理',
  requestScene: '自动场景',
  problemType: '自动类型',
  journeyL1: '自动旅程',
  journeyL2: '自动子旅程',
  sentiment: 'neutral_inquiry',
  urgencyLevel: 'none',
  customerRequest: '自动请求',
  painPoint: '自动痛点',
  problemSummary: '自动痛点',
  customerRequestSource: 'llm',
  painPointSource: 'llm',
  complaintCauseL1Final: '客户体验类',
  complaintCauseL2Final: '新二级',
  note: '',
  status: 'open',
  themes: ['自动旅程'],
  importMonth: '2026-08',
}

describe('ticketImportMerge', () => {
  it('overwrites import/tagging fields but keeps user edits and identity', () => {
    const merged = mergeTicketImportOverExisting(existing, incoming)
    expect(merged.id).toBe('rec-existing')
    expect(merged.tenantId).toBe('local')
    expect(merged.rawText).toBe('新受理')
    expect(merged.handlingText).toBe('新处理')
    expect(merged.complaintCauseL1Final).toBe('客户体验类')
    expect(merged.complaintCauseL2Final).toBe('新二级')
    expect(merged.importMonth).toBe('2026-08')
    expect(merged.journeyL1).toBe('自动旅程')
    expect(merged.sentiment).toBe('neutral_inquiry')

    expect(merged.requestScene).toBe('人工场景')
    expect(merged.problemType).toBe('人工类型')
    expect(merged.customerRequest).toBe('人工请求')
    expect(merged.painPoint).toBe('人工痛点')
    expect(merged.complaintCauseL2Review).toBe('复核二级')
    expect(merged.complaintCauseL3Review).toBe('复核三级')
    expect(merged.note).toBe('用户备注')
    expect(merged.status).toBe('in_progress')
    expect(merged.ticketTodo).toEqual(existing.ticketTodo)
    expect(merged.listeningReviewed).toBe(true)
    expect(merged.establishedAction).toBe('确立举措A')
    expect(merged.actionId).toBe('act-1')
    expect(merged.followUpSatisfaction).toEqual(existing.followUpSatisfaction)
    expect(merged.manualTagFields).toEqual(existing.manualTagFields)
  })

  it('preserveUserEditedTicketFields keeps follow-up from existing when missing on processed', () => {
    const out = preserveUserEditedTicketFields(existing, { ...incoming, followUpSatisfaction: undefined })
    expect(out.followUpSatisfaction).toEqual(existing.followUpSatisfaction)
  })
})
