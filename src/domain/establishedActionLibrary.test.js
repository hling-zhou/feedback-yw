import { describe, expect, it } from 'vitest'
import {
  buildActionItemSnapshotsFromRecord,
  buildClearEstablishedActionRecordPatch,
  buildFirstTicketSnapshotSyncPatch,
  buildLinkedEstablishedActionRecordPatch,
  buildManualEstablishedActionUpsertPayload,
  buildSnapshotPatchForEmptyFields,
  buildSnapshotPatchOnTicketLink,
  formatActionItemOptionLabel,
} from './establishedActionLibrary.js'

describe('establishedActionLibrary', () => {
  const record = {
    id: 'r1',
    ticketId: 'T-100',
    dataSourceType: 'complaint_ticket',
    productKey: 'vpc',
    productSpec: '虚拟私有云',
    problemType: '故障',
    journeyL1: '使用',
    painPoint: '连接失败',
    problemSummary: '连接失败',
  }

  it('buildManualEstablishedActionUpsertPayload includes snapshots and status', () => {
    const payload = buildManualEstablishedActionUpsertPayload(record, {
      content: '  优化预检  ',
      scheduleAt: '2026-09-01',
    })
    expect(payload.content).toBe('优化预检')
    expect(payload.status).toBe('in_progress')
    expect(payload.productKey).toBe('vpc')
    expect(payload.painPointSnapshot).toBe('连接失败')
    expect(payload.problemTypeSnapshot).toBe('故障')
    expect(payload.journeyL1Snapshot).toBe('使用')
  })

  it('empty schedule maps to pending_evaluation', () => {
    const payload = buildManualEstablishedActionUpsertPayload(record, {
      content: '举措',
      scheduleAt: '',
    })
    expect(payload.status).toBe('pending_evaluation')
  })

  it('buildLinkedEstablishedActionRecordPatch writes R4 fields', () => {
    const patch = buildLinkedEstablishedActionRecordPatch({
      id: 'act-1',
      content: '库内举措',
      status: 'in_progress',
      scheduleAt: '2026-10-01',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(patch).toEqual({
      establishedAction: '库内举措',
      manualReviewOptimization: '库内举措',
      actionId: 'act-1',
      actionSchedule: '2026-10-01',
    })
  })

  it('buildClearEstablishedActionRecordPatch clears link fields', () => {
    expect(buildClearEstablishedActionRecordPatch()).toEqual({
      establishedAction: '',
      manualReviewOptimization: '',
      actionId: '',
      actionSchedule: '',
    })
  })

  it('formatActionItemOptionLabel includes status and schedule hint', () => {
    const label = formatActionItemOptionLabel({
      id: 'a',
      content: '测试举措',
      status: 'pending_evaluation',
      scheduleAt: '',
      createdAt: '',
      updatedAt: '',
    })
    expect(label).toContain('待评估')
    expect(label).toContain('测试举措')
  })

  it('buildActionItemSnapshotsFromRecord reads pain point display path', () => {
    expect(buildActionItemSnapshotsFromRecord(record).painPointSnapshot).toBe('连接失败')
  })

  it('buildFirstTicketSnapshotSyncPatch only for first linked ticket', () => {
    const item = {
      id: 'act-1',
      content: '举措',
      status: 'pending_evaluation',
      linkedTicketIds: ['T-100', 'T-200'],
      createdAt: '',
      updatedAt: '',
    }
    expect(buildFirstTicketSnapshotSyncPatch(item, record)).toEqual({
      painPointSnapshot: '连接失败',
      problemTypeSnapshot: '故障',
      journeyL1Snapshot: '使用',
    })
    expect(
      buildFirstTicketSnapshotSyncPatch(item, { ...record, ticketId: 'T-200' }),
    ).toBeNull()
  })

  it('buildSnapshotPatchForEmptyFields only fills missing snapshot fields', () => {
    const item = {
      id: 'act-2',
      content: '举措',
      status: 'pending_evaluation',
      problemTypeSnapshot: '已有类型',
      linkedTicketIds: [],
      createdAt: '',
      updatedAt: '',
    }
    expect(buildSnapshotPatchForEmptyFields(item, record)).toEqual({
      painPointSnapshot: '连接失败',
      journeyL1Snapshot: '使用',
      productKey: 'vpc',
      productName: '虚拟私有云',
    })
  })

  it('buildSnapshotPatchOnTicketLink fills empty fields on first link', () => {
    const item = {
      id: 'act-3',
      content: '举措',
      status: 'pending_evaluation',
      linkedTicketIds: [],
      createdAt: '',
      updatedAt: '',
    }
    expect(buildSnapshotPatchOnTicketLink(item, record)).toEqual({
      painPointSnapshot: '连接失败',
      problemTypeSnapshot: '故障',
      journeyL1Snapshot: '使用',
      productKey: 'vpc',
      productName: '虚拟私有云',
    })
  })
})
