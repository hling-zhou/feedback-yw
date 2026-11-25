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
 * 排期写法归一（2026-11-25 拍板）：把 Excel 常见日期写法统一为平台标准 YYYY-MM-DD。
 * 识别的写法（分隔符支持 - . / 与中文"年月日"；月/日可补零可不补）：
 *   2026-9-30 / 2026.9.30 / 2026/09/30 / 2026年9月30日 → 2026-09-30
 * 越界日期（如 2026.13.40）、无法识别的写法 → 原样返回（保持自由文本语义，不阻塞导入）。
 * 真日期对象（XLSX cellDates 读出的 Date）→ 本地时区安全转换（避免 UTC 偏移差一天）。
 *
 * @param {string | Date | null | undefined} value
 * @returns {string}
 */
export function normalizeActionScheduleInput(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  // 年[分隔符或"年"]月[分隔符或"月"]日["日"?]：分隔符 - . / 允许混用（如 2026.9-30 也容忍）
  const m = raw.match(/^(\d{4})\s*(?:[-/.]|\s|年)\s*(\d{1,2})\s*(?:[-/.]|\s|月)\s*(\d{1,2})\s*日?$/)
  if (!m) return raw
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return raw
  // 真历法校验：2026-2-31 / 2026-02-30 这类要拦下（Date 滚动会算成 3 月）
  const check = new Date(year, month - 1, day)
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
    return raw
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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
