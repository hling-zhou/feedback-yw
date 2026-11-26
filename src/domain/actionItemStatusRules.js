import {
  hasRequirementTicketLinks,
  normalizeRequirementTicketId,
} from './requirementTicketProgress.js'
import { ACTION_ITEM_STATUS_LABELS } from './actionItem.js'

/** @typedef {import('./actionItem.js').ActionItem} ActionItem */
/** @typedef {import('./actionItem.js').ActionItemStatus} ActionItemStatus */

/** 不可再改内容、排期、状态 */
export const ACTION_ITEM_LOCKED_STATUSES = /** @type {ActionItemStatus[]} */ ([
  'completed',
  'not_implemented',
  'abnormal_terminated',
])

/** 排期须为空（含待评估） */
export const ACTION_ITEM_NO_SCHEDULE_STATUSES = /** @type {ActionItemStatus[]} */ ([
  'pending_evaluation',
  'not_implemented',
  'abnormal_terminated',
])

/** 进入后清空排期与预警 */
export const ACTION_ITEM_TERMINAL_CLEAR_SCHEDULE_STATUSES = /** @type {ActionItemStatus[]} */ ([
  'not_implemented',
  'abnormal_terminated',
])

/** @type {Partial<Record<ActionItemStatus, ActionItemStatus[]>>} */
export const ACTION_ITEM_ALLOWED_STATUS_TRANSITIONS = {
  pending_evaluation: ['in_progress', 'not_implemented'],
  in_progress: ['completed', 'suspended', 'abnormal_terminated'],
  suspended: ['in_progress', 'completed', 'abnormal_terminated'],
  completed: [],
  not_implemented: [],
  abnormal_terminated: [],
}

/** @param {ActionItemStatus} status */
export function isActionItemLocked(status) {
  return ACTION_ITEM_LOCKED_STATUSES.includes(status)
}

/** @param {ActionItemStatus} status */
export function actionItemStatusRequiresEmptySchedule(status) {
  return ACTION_ITEM_NO_SCHEDULE_STATUSES.includes(status)
}

/** @param {ActionItemStatus} status */
export function actionItemStatusRequiresSchedule(status) {
  return status === 'in_progress'
}

/**
 * @param {ActionItemStatus} status
 * @param {string | undefined | null} scheduleAt
 * @returns {string | null}
 */
export function validateActionItemScheduleForStatus(status, scheduleAt) {
  if (!actionItemStatusRequiresSchedule(status)) return null
  if (!String(scheduleAt ?? '').trim()) {
    return '「进行中」须填写排期时间'
  }
  return null
}

/**
 * @param {ActionItemStatus} from
 * @param {ActionItemStatus} to
 */
export function isAllowedActionItemStatusTransition(from, to) {
  if (from === to) return true
  if (isActionItemLocked(from)) return false
  const allowed = ACTION_ITEM_ALLOWED_STATUS_TRANSITIONS[from] || []
  return allowed.includes(to)
}

/**
 * @param {ActionItemStatus} current
 * @returns {ActionItemStatus[]}
 */
export function listSelectableActionItemStatuses(current) {
  if (isActionItemLocked(current)) return [current]
  const next = ACTION_ITEM_ALLOWED_STATUS_TRANSITIONS[current] || []
  return [current, ...next.filter((s) => s !== current)]
}

/**
 * @param {ActionItem} existing
 * @param {Partial<ActionItem>} patch
 * @returns {string[]}
 */
export function resolvePatchedLinkedRequirementTicketIds(existing, patch) {
  if (patch.linkedRequirementTicketIds !== undefined) {
    return patch.linkedRequirementTicketIds
      .map((id) => normalizeRequirementTicketId(id))
      .filter(Boolean)
  }
  return (existing.linkedRequirementTicketIds || [])
    .map((id) => normalizeRequirementTicketId(id))
    .filter(Boolean)
}

/**
 * @param {ActionItem} existing
 * @param {Partial<ActionItem>} patch
 * @returns {boolean}
 */
export function willHaveRequirementTicketLinks(existing, patch) {
  return resolvePatchedLinkedRequirementTicketIds(existing, patch).length > 0
}

/**
 * @param {ActionItem} existing
 * @param {Partial<ActionItem>} patch
 * @returns {string | null}
 */
export function validateActionItemRequirementLinkPatchAllowed(existing, patch) {
  const wasLinked = hasRequirementTicketLinks(existing)
  const willBeLinked = willHaveRequirementTicketLinks(existing, patch)
  if (!wasLinked && !willBeLinked) return null

  const contentChanged =
    patch.content != null && String(patch.content).trim() !== String(existing.content ?? '').trim()
  const statusChanged = patch.status != null && patch.status !== existing.status
  const scheduleChanged =
    patch.scheduleAt !== undefined &&
    String(patch.scheduleAt ?? '').trim() !== String(existing.scheduleAt ?? '').trim()

  if (!contentChanged && !statusChanged && !scheduleChanged) return null

  if (wasLinked) {
    if (contentChanged) return '已关联需求工单，不能修改举措内容'
    if (statusChanged) return '已关联需求工单，不能修改状态（由进展同步维护）'
    if (scheduleChanged) return '已关联需求工单，不能修改排期（由进展同步维护）'
  }

  return '关联需求工单时不能同时修改举措内容、排期或状态'
}

/**
 * @param {ActionItem} existing
 * @param {Partial<ActionItem>} patch
 * @returns {string | null}
 */
export function validateActionItemPatchAllowed(existing, patch) {
  const requirementLinkError = validateActionItemRequirementLinkPatchAllowed(existing, patch)
  if (requirementLinkError) return requirementLinkError

  const completedAtError = validateActionItemCompletedAtPatchAllowed(existing, patch)
  if (completedAtError) return completedAtError

  if (!isActionItemLocked(existing.status)) return null

  if (patch.content != null && String(patch.content).trim() !== existing.content) {
    return '该举措已结束，不能修改内容'
  }
  if (patch.status != null && patch.status !== existing.status) {
    return '该举措已结束，不能修改状态'
  }
  if (patch.scheduleAt !== undefined) {
    const next = String(patch.scheduleAt ?? '').trim()
    const prev = String(existing.scheduleAt ?? '').trim()
    if (next !== prev) {
      return '该举措已结束，不能修改排期'
    }
  }
  return null
}

/**
 * completedAt 实际完成时间校验（2026-11-25 拍板）：
 * 仅 completed 态可填——
 *   ① 已是 completed：允许人工修正（B 通道），禁止清空（终态防误清）；
 *   ② 非 completed 态：任何 completedAt 传入即拒绝（完成时间只在完成时产生语义）；
 *   ③ patch.status === 'completed'（本次切换）：completedAt 可带可不带——
 *      不带由副作用自动写今天，带则作为人工修正值采纳（同一次 PATCH 允许）。
 * @param {ActionItem} existing
 * @param {Partial<ActionItem>} patch
 * @returns {string | null}
 */
export function validateActionItemCompletedAtPatchAllowed(existing, patch) {
  if (patch.completedAt === undefined) return null
  const value = String(patch.completedAt ?? '').trim()
  const nextStatus = patch.status ?? existing.status
  if (nextStatus !== 'completed') {
    return `「${ACTION_ITEM_STATUS_LABELS[nextStatus] ?? nextStatus}」不能填写实际完成时间（仅已完成举措可填）`
  }
  if (!value) {
    if (existing.status === 'completed') {
      return '已完成举措的实际完成时间不能清空'
    }
    return '实际完成时间不能为空'
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return '实际完成时间格式须为 YYYY-MM-DD'
  }
  return null
}

/**
 * @param {ActionItemStatus} from
 * @param {ActionItemStatus} to
 * @returns {string | null}
 */
export function validateActionItemStatusTransition(from, to) {
  if (from === to) return null
  if (!isAllowedActionItemStatusTransition(from, to)) {
    return 'INVALID_STATUS_TRANSITION'
  }
  return null
}

/**
 * @param {Partial<ActionItem>} patch
 * @param {ActionItemStatus} nextStatus
 * @returns {Partial<ActionItem>}
 */
export function applyActionItemStatusSideEffects(patch, nextStatus) {
  if (nextStatus === 'completed') {
    // 切入 completed 自动记录实际完成时间（A 通道，11-25 拍板）；
    // patch 显式带合法 completedAt 时不覆盖（同次 PATCH 的人工修正值优先）。
    const explicit = String(patch.completedAt ?? '').trim()
    return {
      ...patch,
      completedAt: /^\d{4}-\d{2}-\d{2}$/.test(explicit) ? explicit : localIsoDate(),
    }
  }
  if (!ACTION_ITEM_TERMINAL_CLEAR_SCHEDULE_STATUSES.includes(nextStatus)) {
    return patch
  }
  return {
    ...patch,
    scheduleAt: '',
    scheduleChanged: false,
    warningLevel: 'none',
  }
}

/** 本地时区 YYYY-MM-DD（禁 toISOString 当"今天"——UTC 在 CST 00:00-08:00 比本地早一天，11-21 实锤） */
function localIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
