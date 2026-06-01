/**
 * 确立举措 ↔ 举措库联动（P4-2 / P4-3）。
 */

import { normalizeActionSchedule } from './actionSchedule.js'
import {
  ACTION_ITEM_STATUS_LABELS,
  deriveActionItemStatusFromSchedule,
  linkTicketToActionItem,
  normalizeActionItem,
} from './actionItem.js'
import {
  buildEstablishedActionSavePatch,
  normalizeEstablishedActionInput,
} from './establishedAction.js'
import { getDisplayPainPoint } from '../lib/ticketAnalysis/ticketAnalysisSources.js'

/** @typedef {import('./actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * @param {FeedbackRecord | null | undefined} record
 */
export function buildActionItemProductFields(record) {
  return {
    productKey: String(record?.productKey || record?.taxonomyKey || '').trim(),
    productName: String(record?.productSpec || record?.product || '').trim(),
  }
}

/**
 * @param {FeedbackRecord | null | undefined} record
 */
export function buildActionItemSnapshotsFromRecord(record) {
  return {
    painPointSnapshot: getDisplayPainPoint(record).trim(),
    problemTypeSnapshot: String(record?.problemType ?? '').trim(),
    journeyL1Snapshot: String(record?.journeyL1 ?? '').trim(),
  }
}

/**
 * @param {FeedbackRecord} record
 * @param {{ content: string; scheduleAt?: string }} input
 * @returns {Partial<ActionItem>}
 */
export function buildManualEstablishedActionUpsertPayload(record, input) {
  const content = normalizeEstablishedActionInput(input.content)
  const scheduleAt = normalizeActionSchedule(input.scheduleAt)
  return {
    ...buildActionItemProductFields(record),
    content,
    scheduleAt,
    status: deriveActionItemStatusFromSchedule(scheduleAt),
    ...buildActionItemSnapshotsFromRecord(record),
  }
}

/**
 * 选库后写入工单的 patch（R4：文本副本 + actionId；排期来自库）。
 *
 * @param {ActionItem} actionItem
 */
export function buildLinkedEstablishedActionRecordPatch(actionItem) {
  return {
    ...buildEstablishedActionSavePatch(actionItem.content),
    actionId: actionItem.id,
    actionSchedule: normalizeActionSchedule(actionItem.scheduleAt),
  }
}

/**
 * 若 record 为举措首单，返回应同步到 ActionItem 的快照 patch。
 *
 * @param {ActionItem} item
 * @param {FeedbackRecord} record
 * @returns {Partial<ActionItem> | null}
 */
export function buildFirstTicketSnapshotSyncPatch(item, record) {
  const firstId = item.linkedTicketIds?.[0]?.trim()
  const ticketId = record.ticketId?.trim()
  if (!firstId || !ticketId || firstId !== ticketId) return null
  return buildActionItemSnapshotsFromRecord(record)
}

/**
 * 清空确立举措与库关联（不删除 ActionItem）。
 */
export function buildClearEstablishedActionRecordPatch() {
  return {
    establishedAction: '',
    manualReviewOptimization: '',
    actionId: '',
    actionSchedule: '',
  }
}

/**
 * @param {ActionItem} item
 * @param {string} [ticketId]
 * @param {import('./enums.js').DataSourceType} [dataSourceType]
 * @returns {ActionItem}
 */
export function ensureTicketLinkedOnActionItem(item, ticketId, dataSourceType) {
  return linkTicketToActionItem(normalizeActionItem(item), ticketId, dataSourceType)
}

/**
 * @param {ActionItem} item
 * @returns {string}
 */
export function formatActionItemOptionLabel(item) {
  const statusLabel = ACTION_ITEM_STATUS_LABELS[item.status] || item.status
  const scheduleHint = item.scheduleAt?.trim() ? `排期 ${item.scheduleAt.trim()}` : '待评估'
  const preview = item.content.length > 56 ? `${item.content.slice(0, 56)}…` : item.content
  return `${preview}（${statusLabel} · ${scheduleHint}）`
}
