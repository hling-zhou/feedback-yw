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
 * @returns {string | null}
 */
export function validateActionItemPatchAllowed(existing, patch) {
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
