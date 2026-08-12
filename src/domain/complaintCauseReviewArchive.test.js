import { describe, expect, it } from 'vitest'
import {
  applyComplaintCauseReviewDecisionToRecord,
  buildComplaintCauseReviewArchiveRow,
  mergeComplaintCauseReviewImportRow,
  toComplaintCauseReviewAdminRow,
} from './complaintCauseReviewArchive.js'

const sample = {
  id: 'r1',
  ticketId: 'T-1',
  product: '云主机',
  complaintCauseL1Final: '云能问题',
  complaintCauseL2Final: '产品原因',
  complaintCauseL3Final: '计算部原因',
  complaintCauseL1Review: '客户体验类投诉',
  complaintCauseL2Review: '服务态度',
  complaintCauseL3Review: '某三级',
  complaintCauseReviewReason: '分类不准',
  manualTagFields: ['complaintCauseReview', 'requestScene'],
}

describe('complaintCauseReviewArchive', () => {
  it('agree updates Final from Review and clears pending', () => {
    const next = applyComplaintCauseReviewDecisionToRecord(sample, 'agree')
    expect(next.complaintCauseL1Final).toBe('客户体验类投诉')
    expect(next.complaintCauseL2Final).toBe('服务态度')
    expect(next.complaintCauseL3Final).toBe('某三级')
    expect(next.complaintCauseL1Review).toBe('')
    expect(next.complaintCauseReviewReason).toBe('')
    expect(next.manualTagFields).toEqual(['requestScene'])
  })

  it('reject keeps Final and clears pending', () => {
    const next = applyComplaintCauseReviewDecisionToRecord(sample, 'reject')
    expect(next.complaintCauseL1Final).toBe('云能问题')
    expect(next.complaintCauseL2Final).toBe('产品原因')
    expect(next.complaintCauseL1Review).toBe('')
    expect(next.complaintCauseReviewReason).toBe('')
  })

  it('archive row snapshots original Final before update', () => {
    const row = buildComplaintCauseReviewArchiveRow(sample, 'agree', {
      userId: 'u1',
      username: 'admin',
    }, '2026-08-13T00:00:00.000Z')
    expect(row.originalL1).toBe('云能问题')
    expect(row.reviewL1).toBe('客户体验类投诉')
    expect(row.decision).toBe('agree')
    expect(row.ticketId).toBe('T-1')
  })

  it('admin row and import merge by ticketId', () => {
    const adminRow = toComplaintCauseReviewAdminRow(sample)
    const map = new Map([['T-1', adminRow]])
    const merged = mergeComplaintCauseReviewImportRow({ 工单号: 'T-1', 复核结果: '同意' }, map)
    expect(merged.decision).toBe('agree')
  })
})
