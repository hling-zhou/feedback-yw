/**
 * 排期（actionSchedule）：可空字符串，常见格式 YYYY-MM-DD；空表示待评估（R1）。
 */

/** @type {number} */
export const ACTION_SCHEDULE_MAX_LENGTH = 64

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeActionSchedule(value) {
  return String(value ?? '').trim().slice(0, ACTION_SCHEDULE_MAX_LENGTH)
}

/**
 * 详情只读展示：空排期显示「待评估」。
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function getActionScheduleDisplay(value) {
  const normalized = normalizeActionSchedule(value)
  return normalized || '待评估'
}

/**
 * @param {string} value
 * @returns {{ actionSchedule: string }}
 */
export function buildActionScheduleSavePatch(value) {
  return { actionSchedule: normalizeActionSchedule(value) }
}
