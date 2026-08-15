import { buildFeedbacksUrl } from './feedbackFilters.js'

/** 可放进 URL `ticketIds=` 的上限，与规划建议页一致。 */
export const FEEDBACK_TICKET_ID_URL_LIMIT = 20

export const FEEDBACK_TICKET_ID_SET_PARAM = 'ticketIdSet'

const STORAGE_PREFIX = 'feedbacks:ticketIdSet:'

function uniqueTicketIds(ticketIds) {
  const seen = new Set()
  const ids = []
  for (const raw of ticketIds || []) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function storageKey(setId) {
  return `${STORAGE_PREFIX}${String(setId || '').trim()}`
}

function newSetId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * @param {string[]} ticketIds
 * @param {{ label?: string }} [options]
 * @returns {string | null} session key
 */
export function writeFeedbackTicketIdSet(ticketIds, options = {}) {
  const ids = uniqueTicketIds(ticketIds)
  if (!ids.length) return null
  const setId = newSetId()
  const label = String(options.label || '').trim() || `主题依据 ${ids.length} 条`
  try {
    sessionStorage.setItem(storageKey(setId), JSON.stringify({
      ticketIds: ids,
      label,
      createdAt: Date.now(),
    }))
  } catch {
    return null
  }
  return setId
}

/**
 * @param {string | null | undefined} setId
 * @returns {{ ticketIds: string[]; label: string } | null}
 */
export function readFeedbackTicketIdSet(setId) {
  const key = String(setId || '').trim()
  if (!key) return null
  try {
    const raw = sessionStorage.getItem(storageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const ticketIds = uniqueTicketIds(parsed?.ticketIds)
    if (!ticketIds.length) return null
    return {
      ticketIds,
      label: String(parsed?.label || '').trim() || `主题依据 ${ticketIds.length} 条`,
    }
  } catch {
    return null
  }
}

/**
 * @param {string | null | undefined} setId
 */
export function clearFeedbackTicketIdSet(setId) {
  const key = String(setId || '').trim()
  if (!key) return
  try {
    sessionStorage.removeItem(storageKey(key))
  } catch {
    /* ignore */
  }
}

/**
 * @param {number} ticketCount
 */
export function formatClusterEvidenceLinkLabel(ticketCount) {
  const count = Number(ticketCount)
  if (!Number.isFinite(count) || count <= 0) return '查看簇内工单'
  return `查看簇内 ${count} 条`
}

/**
 * 反馈库主题依据：筛选名单条数 vs 库内实际匹配条数（工单已删除时两者会分叉）。
 * @param {number} filterCount
 * @param {number} matchedCount
 */
export function formatClusterTicketSetChipLabel(filterCount, matchedCount) {
  const filter = Number(filterCount)
  const matched = Number(matchedCount)
  const n = Number.isFinite(filter) && filter > 0 ? filter : 0
  const m = Number.isFinite(matched) && matched >= 0 ? matched : 0
  return `筛选 ${n} / 库内匹配 ${m}`
}

/**
 * @param {Object} params
 * @param {string} [params.sourceType]
 * @param {string[]} params.ticketIds
 * @returns {{ href: string; usesSession: boolean; ticketIds: string[] }}
 */
export function resolveClusterFeedbacksNavigation({ sourceType, ticketIds } = {}) {
  const ids = uniqueTicketIds(ticketIds)
  const count = ids.length
  if (!ids.length) {
    return {
      href: buildFeedbacksUrl({ source: sourceType || '' }),
      usesSession: false,
      ticketIds: [],
    }
  }
  if (ids.length <= FEEDBACK_TICKET_ID_URL_LIMIT) {
    return {
      href: buildFeedbacksUrl({
        source: sourceType || '',
        ticketIds: ids.join(','),
      }),
      usesSession: false,
      ticketIds: ids,
    }
  }
  const setId = writeFeedbackTicketIdSet(ids, { label: `主题依据 ${count} 条` })
  if (!setId) {
    return {
      href: buildFeedbacksUrl({
        source: sourceType || '',
        ticketIds: ids.slice(0, FEEDBACK_TICKET_ID_URL_LIMIT).join(','),
      }),
      usesSession: false,
      ticketIds: ids,
    }
  }
  return {
    href: buildFeedbacksUrl({
      source: sourceType || '',
      [FEEDBACK_TICKET_ID_SET_PARAM]: setId,
    }),
    usesSession: true,
    ticketIds: ids,
  }
}
