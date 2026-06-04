/**
 * 举措超时预警规则 — 需求 §四.5
 * @see docs/DESIGN-20260601-1.md §3.4
 */

/** @typedef {import('./actionItem.js').ActionItem} ActionItem */
/** @typedef {import('./actionItem.js').ActionItemWarningLevel} ActionItemWarningLevel */

/**
 * @param {string | undefined | null} raw
 * @returns {Date | null}
 */
export function parseActionItemDate(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * @param {Date} a
 * @param {Date} b
 * @returns {number}
 */
export function daysBetweenDates(a, b) {
  const ms = b.getTime() - a.getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

/**
 * @param {ActionItem} item
 * @param {Date} [today]
 * @returns {ActionItemWarningLevel}
 */
export function computeActionItemWarningLevel(item, today = new Date()) {
  const status = item.status
  if (
    status === 'completed' ||
    status === 'suspended' ||
    status === 'not_implemented' ||
    status === 'abnormal_terminated'
  ) {
    return 'none'
  }

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  if (status === 'pending_evaluation') {
    const first = parseActionItemDate(item.firstProposedAt)
    if (!first) return 'none'
    const days = daysBetweenDates(first, todayStart)
    if (days >= 30) return 'red'
    if (days >= 15) return 'orange'
    return 'none'
  }

  if (status === 'in_progress') {
    const schedule = parseActionItemDate(item.scheduleAt)
    if (!schedule) return 'none'
    const daysUntil = daysBetweenDates(todayStart, schedule)
    if (daysUntil < 0) return 'red'
    if (daysUntil <= 15) return 'orange'
    return 'none'
  }

  return 'none'
}

/**
 * @param {ActionItem} item
 * @param {Date} [today]
 * @returns {ActionItem}
 */
export function applyActionItemWarningLevel(item, today = new Date()) {
  return {
    ...item,
    warningLevel: computeActionItemWarningLevel(item, today),
  }
}
