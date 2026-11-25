import { describe, expect, it } from 'vitest'
import {
  areFeedbackDrawerFormSnapshotsEqual,
  isFeedbackDrawerFormDirty,
} from './feedbackDrawerDirty.js'

const baseRecord = {
  id: '1',
  rawText: 't',
  customerQuote: 't',
  note: '',
  requestScene: '咨询',
  problemType: '配额与权限申请',
  journeyL1: '产品订改续',
  journeyL2: '权限及配额限制',
  sentiment: 'neutral',
  urgencyLevel: 'none',
  themes: ['权限及配额限制'],
  problemSummary: '',
  solutionSummary: '',
  rootCause: '',
  optimizationSuggestion: '',
  status: 'open',
  importedAt: '2026-01-01',
  customerRequest: '',
  painPoint: '',
}

const baseForm = {
  note: '',
  sentiment: 'neutral',
  urgencyLevel: 'none',
  requestScene: '咨询',
  problemType: '配额与权限申请',
  journeyL1: '产品订改续',
  journeyL2: '权限及配额限制',
  customerRequest: '',
  painPoint: '',
  productGroupOptimization: '',
  designerOptimization: '',
  establishedAction: '',
  establishedActionDetail: '',
  actionSchedule: '',
  actionId: '',
  rootCauseReview: '',
  complaintCauseL2Review: '',
  complaintCauseL3Review: '',
  ticketTodoItems: [],
}

describe('isFeedbackDrawerFormDirty', () => {
  it('returns false when form matches stored record', () => {
    expect(isFeedbackDrawerFormDirty(baseRecord, baseForm)).toBe(false)
  })

  it('returns true when editable field changed', () => {
    expect(isFeedbackDrawerFormDirty(baseRecord, { ...baseForm, note: '新备注' })).toBe(true)
    expect(
      isFeedbackDrawerFormDirty(baseRecord, { ...baseForm, complaintCauseL2Review: '复核二级' }),
    ).toBe(true)
    expect(
      isFeedbackDrawerFormDirty(baseRecord, {
        ...baseForm,
        ticketTodoItems: [{ id: 't1', text: '跟进', done: false }],
      }),
    ).toBe(true)
    expect(
      isFeedbackDrawerFormDirty(baseRecord, {
        ...baseForm,
        ticketTodoIncoming: [
          {
            hostRecordId: 'host',
            hostTicketId: 'C-1',
            itemId: 't1',
            text: '挂入',
            resolution: 'open',
            assignees: [],
            linkedTicketIds: ['C-1'],
          },
        ],
      }),
    ).toBe(true)
    expect(
      isFeedbackDrawerFormDirty(
        { ...baseRecord, listeningReviewed: false },
        { ...baseForm, listeningReviewed: true },
      ),
    ).toBe(true)
  })

  it('areFeedbackDrawerFormSnapshotsEqual matches identical snapshots', () => {
    expect(areFeedbackDrawerFormSnapshotsEqual(baseForm, { ...baseForm })).toBe(true)
    expect(
      areFeedbackDrawerFormSnapshotsEqual(baseForm, { ...baseForm, note: 'changed' }),
    ).toBe(false)
  })

  // 2026-11-25 拍板：讨论状态三态单向——dirty 只认「推进」，表单态浅于记录态不算 dirty
  it('discussionStatus 单向 dirty：推进才算修改，浅于记录态不报 dirty', () => {
    // 推进：未标记 → 待讨论
    expect(
      isFeedbackDrawerFormDirty(
        { ...baseRecord, discussionStatus: '' },
        { ...baseForm, discussionStatus: 'pending' },
      ),
    ).toBe(true)
    // 推进：待讨论 → 已讨论
    expect(
      isFeedbackDrawerFormDirty(
        { ...baseRecord, discussionStatus: 'pending' },
        { ...baseForm, discussionStatus: 'done' },
      ),
    ).toBe(true)
    // 记录已是 done，表单保持 done（UI 不允许降级，保存链 max 兜底）→ 不 dirty
    expect(
      isFeedbackDrawerFormDirty(
        { ...baseRecord, discussionStatus: 'done' },
        { ...baseForm, discussionStatus: 'done' },
      ),
    ).toBe(false)
    // 防御形态：外部灌入更浅值（不可逆字段不因展示归一误报）
    expect(
      isFeedbackDrawerFormDirty(
        { ...baseRecord, discussionStatus: 'done' },
        { ...baseForm, discussionStatus: 'pending' },
      ),
    ).toBe(false)
    // 未标记对未标记（undefined 老数据归一）
    expect(
      isFeedbackDrawerFormDirty(
        { ...baseRecord },
        { ...baseForm, discussionStatus: '' },
      ),
    ).toBe(false)
  })

  it('discussionStatus 快照相等性按档位比较', () => {
    expect(
      areFeedbackDrawerFormSnapshotsEqual(
        { ...baseForm, discussionStatus: 'pending' },
        { ...baseForm, discussionStatus: 'pending' },
      ),
    ).toBe(true)
    expect(
      areFeedbackDrawerFormSnapshotsEqual(
        { ...baseForm, discussionStatus: 'pending' },
        { ...baseForm, discussionStatus: 'done' },
      ),
    ).toBe(false)
    // undefined 与 '' 同档（老数据 vs 归一）
    expect(
      areFeedbackDrawerFormSnapshotsEqual(
        { ...baseForm },
        { ...baseForm, discussionStatus: '' },
      ),
    ).toBe(true)
  })
})
