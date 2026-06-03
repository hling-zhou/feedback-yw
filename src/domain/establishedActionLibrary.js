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
  buildEstablishedActionFullSavePatch,
  normalizeEstablishedActionInput,
  normalizeEstablishedActionDetailInput,
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
  }
}

/**
 * @param {FeedbackRecord} record
 * @param {{ content: string; detail?: string; scheduleAt?: string }} input
 * @returns {Partial<ActionItem>}
 */
export function buildManualEstablishedActionUpsertPayload(record, input) {
  const content = normalizeEstablishedActionInput(input.content)
  const detail = normalizeEstablishedActionDetailInput(input.detail)
  const scheduleAt = normalizeActionSchedule(input.scheduleAt)
  return {
    ...buildActionItemProductFields(record),
    content,
    detail,
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
    ...buildEstablishedActionFullSavePatch(actionItem.content, actionItem.detail),
    actionId: actionItem.id,
    actionSchedule: normalizeActionSchedule(actionItem.scheduleAt),
  }
}

/**
 * 举措库字段为空时，从工单补齐快照 / 产品（不覆盖已有值）。
 *
 * @param {ActionItem} item
 * @param {FeedbackRecord} record
 * @returns {Partial<ActionItem> | null}
 */
export function buildSnapshotPatchForEmptyFields(item, record) {
  const snapshots = buildActionItemSnapshotsFromRecord(record)
  const product = buildActionItemProductFields(record)
  /** @type {Partial<ActionItem>} */
  const patch = {}

  if (!String(item.painPointSnapshot ?? '').trim() && snapshots.painPointSnapshot) {
    patch.painPointSnapshot = snapshots.painPointSnapshot
  }
  if (!String(item.problemTypeSnapshot ?? '').trim() && snapshots.problemTypeSnapshot) {
    patch.problemTypeSnapshot = snapshots.problemTypeSnapshot
  }
  if (!String(item.productKey ?? '').trim() && product.productKey) {
    patch.productKey = product.productKey
  }
  if (!String(item.productName ?? '').trim() && product.productName) {
    patch.productName = product.productName
  }

  return Object.keys(patch).length ? patch : null
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
 * 首次关联工单时：空字段从该工单补齐；若已是首单则保持全量同步。
 *
 * @param {ActionItem} item - 关联前的举措
 * @param {FeedbackRecord} record
 * @returns {Partial<ActionItem> | null}
 */
export function buildSnapshotPatchOnTicketLink(item, record) {
  const ticketId = record.ticketId?.trim()
  if (!ticketId) return null

  const wasFirstLink = !(item.linkedTicketIds || []).length
  if (wasFirstLink) {
    return buildSnapshotPatchForEmptyFields(item, record)
  }

  const linkedIds = [...(item.linkedTicketIds || [])]
  if (!linkedIds.includes(ticketId)) linkedIds.push(ticketId)
  return buildFirstTicketSnapshotSyncPatch({ ...item, linkedTicketIds: linkedIds }, record)
}

/**
 * 清空确立举措与库关联（不删除 ActionItem）。
 */
export function buildClearEstablishedActionRecordPatch() {
  return {
    establishedAction: '',
    manualReviewOptimization: '',
    establishedActionDetail: '',
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
