import { ACTION_ITEM_STATUS_LABELS } from './actionItem.js'
import {
  daysBetweenDates,
  parseActionItemDate,
} from './actionItemWarning.js'

/** @typedef {import('./actionItem.js').ActionItem} ActionItem */
/** @typedef {import('./actionItem.js').ActionItemStatus} ActionItemStatus */
/** @typedef {import('./actionItem.js').ActionItemWarningLevel} ActionItemWarningLevel */

/**
 * @typedef {Object} RequirementTicketProgressRow
 * @property {string} ticketId
 * @property {string} product
 * @property {string} scheduleAt
 * @property {string} workflowStatus
 * @property {string} importedAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} RequirementStatusMappingRow
 * @property {string} workflowStatus
 * @property {ActionItemStatus} mapsToActionStatus
 * @property {number} [sortOrder]
 */

/**
 * @typedef {Object} RequirementTicketDetail
 * @property {string} ticketId
 * @property {string} [product]
 * @property {string} [scheduleAt]
 * @property {string} [workflowStatus]
 * @property {ActionItemStatus | null} mappedStatus
 * @property {'synced' | 'missing'} syncState
 */

/**
 * @typedef {Object} RequirementLinkedEnrichment
 * @property {boolean} requirementLinkMode
 * @property {RequirementTicketDetail[]} requirementTickets
 * @property {string} [derivedScheduleAt]
 * @property {ActionItemStatus | null} [derivedStatus]
 * @property {ActionItemWarningLevel} [derivedWarningLevel]
 */

/** 状态聚合：最严重优先（数字越小越严重） */
/** @type {Record<ActionItemStatus, number>} */
export const REQUIREMENT_STATUS_SEVERITY = {
  in_progress: 1,
  pending_evaluation: 2,
  suspended: 3,
  completed: 4,
  not_implemented: 5,
  abnormal_terminated: 6,
}

export const REQUIREMENT_PROGRESS_SHEET_NAME = '需求工单进展'
export const REQUIREMENT_PROGRESS_IMPORT_HEADERS = [
  '需求工单号',
  '产品',
  '排期时间',
  '状态',
]

/**
 * @param {string | undefined | null} id
 */
export function normalizeRequirementTicketId(id) {
  return String(id ?? '').trim()
}

/**
 * @param {Pick<ActionItem, 'linkedRequirementTicketIds'>} item
 */
export function hasRequirementTicketLinks(item) {
  return (item.linkedRequirementTicketIds || []).some((id) => normalizeRequirementTicketId(id))
}

/**
 * @param {string | undefined | null} raw
 */
export function normalizeRequirementScheduleAt(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const parsed = parseActionItemDate(text)
  if (!parsed) return ''
  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * @param {string[]} ticketIds
 * @param {Map<string, RequirementTicketProgressRow>} progressById
 * @param {Map<string, RequirementStatusMappingRow>} mappingByWorkflowStatus
 * @returns {RequirementTicketDetail[]}
 */
export function resolveRequirementTicketDetails(ticketIds, progressById, mappingByWorkflowStatus) {
  const uniqueIds = [...new Set((ticketIds || []).map(normalizeRequirementTicketId).filter(Boolean))]
  return uniqueIds.map((ticketId) => {
    const row = progressById.get(ticketId)
    if (!row) {
      return {
        ticketId,
        syncState: 'missing',
        mappedStatus: null,
      }
    }
    const workflowStatus = String(row.workflowStatus || '').trim()
    const mapping = workflowStatus ? mappingByWorkflowStatus.get(workflowStatus) : undefined
    return {
      ticketId,
      product: String(row.product || '').trim() || undefined,
      scheduleAt: normalizeRequirementScheduleAt(row.scheduleAt) || undefined,
      workflowStatus: workflowStatus || undefined,
      mappedStatus: mapping?.mapsToActionStatus ?? null,
      syncState: 'synced',
    }
  })
}

/**
 * @param {RequirementTicketDetail[]} details
 * @returns {ActionItemStatus | null}
 */
export function pickMostSevereMappedStatus(details) {
  let best = /** @type {ActionItemStatus | null} */ (null)
  let bestRank = Number.POSITIVE_INFINITY

  for (const detail of details) {
    if (!detail.mappedStatus) continue
    const rank = REQUIREMENT_STATUS_SEVERITY[detail.mappedStatus]
    if (rank < bestRank) {
      bestRank = rank
      best = detail.mappedStatus
    }
  }

  return best
}

/**
 * @param {string | undefined} scheduleAt
 * @param {Date} today
 * @returns {ActionItemWarningLevel}
 */
export function computeRequirementScheduleWarningLevel(scheduleAt, today = new Date()) {
  const schedule = parseActionItemDate(scheduleAt)
  if (!schedule) return 'none'
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const daysUntil = daysBetweenDates(todayStart, schedule)
  if (daysUntil < 0) return 'red'
  if (daysUntil <= 15) return 'orange'
  return 'none'
}

/**
 * 聚合排期：取与聚合状态一致的工单排期。
 * 有过去排期时优先过去（取距今天最远 / 最逾期）；仅未来时取距今天最近。
 *
 * @param {RequirementTicketDetail[]} details
 * @param {ActionItemStatus | null | undefined} derivedStatus
 * @param {Date} [today]
 * @returns {string | undefined}
 */
export function pickDerivedScheduleAtForAggregatedStatus(details, derivedStatus, today = new Date()) {
  if (!derivedStatus) return undefined

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  /** @type {{ scheduleAt: string; daysFromToday: number; date: Date; ticketId: string }[]} */
  const candidates = []

  for (const detail of details) {
    if (detail.syncState !== 'synced') continue
    if (detail.mappedStatus !== derivedStatus) continue
    const schedule = parseActionItemDate(detail.scheduleAt)
    if (!schedule) continue
    candidates.push({
      scheduleAt: detail.scheduleAt || '',
      daysFromToday: daysBetweenDates(todayStart, schedule),
      date: schedule,
      ticketId: detail.ticketId,
    })
  }

  if (!candidates.length) return undefined

  const past = candidates.filter((item) => item.daysFromToday < 0)
  const pool = past.length > 0 ? past : candidates.filter((item) => item.daysFromToday >= 0)
  if (!pool.length) return undefined

  pool.sort((a, b) => {
    if (a.daysFromToday !== b.daysFromToday) return a.daysFromToday - b.daysFromToday
    if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime()
    return a.ticketId.localeCompare(b.ticketId)
  })

  return pool[0].scheduleAt
}

/**
 * @param {ActionItem} item
 * @param {Map<string, RequirementTicketProgressRow>} progressById
 * @param {Map<string, RequirementStatusMappingRow>} mappingByWorkflowStatus
 * @param {Date} [today]
 * @returns {ActionItem & RequirementLinkedEnrichment}
 */
export function enrichActionItemWithRequirementProgress(
  item,
  progressById,
  mappingByWorkflowStatus,
  today = new Date(),
) {
  if (!hasRequirementTicketLinks(item)) {
    return {
      ...item,
      requirementLinkMode: false,
      requirementTickets: [],
    }
  }

  const requirementTickets = resolveRequirementTicketDetails(
    item.linkedRequirementTicketIds || [],
    progressById,
    mappingByWorkflowStatus,
  )
  const derivedStatus = pickMostSevereMappedStatus(requirementTickets)
  const derivedScheduleAt = pickDerivedScheduleAtForAggregatedStatus(
    requirementTickets,
    derivedStatus,
    today,
  )
  const derivedWarningLevel = computeRequirementScheduleWarningLevel(derivedScheduleAt, today)

  return {
    ...item,
    requirementLinkMode: true,
    requirementTickets,
    derivedScheduleAt,
    derivedStatus: derivedStatus ?? undefined,
    derivedWarningLevel,
    warningLevel: derivedWarningLevel,
  }
}

/**
 * @param {ActionItemStatus | null | undefined} status
 */
export function formatDerivedRequirementStatusLabel(status) {
  if (!status) return '待同步'
  return ACTION_ITEM_STATUS_LABELS[status] || status
}

/**
 * @param {Pick<ActionItem, 'requirementLinkMode' | 'linkedRequirementTicketIds'>} item
 */
export function isActionItemInRequirementLinkMode(item) {
  return Boolean(item.requirementLinkMode || hasRequirementTicketLinks(item))
}

/**
 * 列表/选库/工单副本：需求工单关联时读聚合排期，否则读库内排期。
 *
 * @param {Pick<ActionItem, 'requirementLinkMode' | 'linkedRequirementTicketIds' | 'scheduleAt' | 'derivedScheduleAt'>} item
 */
export function getActionItemDisplayScheduleAt(item) {
  if (isActionItemInRequirementLinkMode(item)) {
    return item.derivedScheduleAt?.trim() || ''
  }
  return item.scheduleAt?.trim() || ''
}

/**
 * 列表/选库展示：需求工单关联时读聚合状态，否则读库内状态。
 *
 * @param {Pick<ActionItem, 'requirementLinkMode' | 'linkedRequirementTicketIds' | 'status' | 'derivedStatus'>} item
 * @returns {ActionItemStatus | null | undefined}
 */
export function getActionItemDisplayStatus(item) {
  if (isActionItemInRequirementLinkMode(item)) {
    return item.derivedStatus ?? null
  }
  return item.status
}
