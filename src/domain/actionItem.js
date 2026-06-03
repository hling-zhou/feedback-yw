import { randomId } from '../lib/randomId.js'
/**
 * 举措库 ActionItem — 领域模型与状态规则。
 * @see docs/DESIGN-20260601-1.md §3.4
 */

/** @typedef {'pending_evaluation' | 'in_progress' | 'completed' | 'suspended'} ActionItemStatus */
/** @typedef {'none' | 'orange' | 'red'} ActionItemWarningLevel */

/**
 * @typedef {Object} ActionItem
 * @property {string} id
 * @property {string} [productKey]
 * @property {string} [productName]
 * @property {string} content
 * @property {string} [detail] - 举措详情（可选）
 * @property {ActionItemStatus} status
 * @property {string} [firstProposedAt] - ISO date (YYYY-MM-DD)
 * @property {string} [scheduleAt] - 排期展示文本
 * @property {string} [painPointSnapshot]
 * @property {string} [problemTypeSnapshot]
 * @property {string} [journeyL1Snapshot]
 * @property {string[]} [linkedTicketIds]
 * @property {string[]} [linkedRequirementTicketIds] - 关联需求工单号（可选，可多个）
 * @property {import('./enums.js').DataSourceType[]} [linkedDataSources]
 * @property {boolean} [scheduleChanged]
 * @property {ActionItemWarningLevel} [warningLevel]
 * @property {number} [recordRevision] - 乐观锁版本
 * @property {{ userId: string; username: string }} [updatedBy]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @type {ActionItemStatus[]} */
export const ACTION_ITEM_STATUSES = [
  'pending_evaluation',
  'in_progress',
  'completed',
  'suspended',
]

/** @type {Record<ActionItemStatus, string>} */
export const ACTION_ITEM_STATUS_LABELS = {
  pending_evaluation: '待评估',
  in_progress: '进行中',
  completed: '已完成',
  suspended: '挂起',
}

/** @type {ActionItemWarningLevel[]} */
export const ACTION_ITEM_WARNING_LEVELS = ['none', 'orange', 'red']

export const ACTION_ITEM_CONTENT_MAX_LENGTH = 500
export const ACTION_ITEM_DETAIL_MAX_LENGTH = 1000

/** POST /api/actions 请求体允许的字段 */
export const ACTION_ITEM_CREATE_BODY_KEYS = [
  'content',
  'detail',
  'productKey',
  'productName',
  'status',
  'firstProposedAt',
  'scheduleAt',
  'painPointSnapshot',
  'problemTypeSnapshot',
  'journeyL1Snapshot',
  'linkedTicketIds',
  'linkedRequirementTicketIds',
  'linkedDataSources',
  'scheduleChanged',
  'warningLevel',
]

/**
 * 裁剪为 API 创建 schema 允许的字段（去掉 id / createdAt 等）。
 *
 * @param {Partial<ActionItem>} input
 * @returns {Partial<ActionItem>}
 */
export function toActionItemCreateBody(input) {
  /** @type {Partial<ActionItem>} */
  const out = {}
  for (const key of ACTION_ITEM_CREATE_BODY_KEYS) {
    if (input[key] !== undefined) {
      // @ts-expect-error indexed assign
      out[key] = input[key]
    }
  }
  return out
}

/**
 * @param {string | undefined | null} scheduleAt
 * @returns {ActionItemStatus}
 */
export function deriveActionItemStatusFromSchedule(scheduleAt) {
  return String(scheduleAt ?? '').trim() ? 'in_progress' : 'pending_evaluation'
}

/**
 * 排期「变更」标签：仅当原排期非空且与新值不同时为 true（空→有值不算变更）。
 *
 * @param {string | undefined | null} previousScheduleAt
 * @param {string | undefined | null} nextScheduleAt
 */
export function computeScheduleChanged(previousScheduleAt, nextScheduleAt) {
  const previous = String(previousScheduleAt ?? '').trim()
  const next = String(nextScheduleAt ?? '').trim()
  if (!previous) return false
  return previous !== next
}

/**
 * @param {unknown} value
 * @returns {value is ActionItemStatus}
 */
export function isActionItemStatus(value) {
  return typeof value === 'string' && ACTION_ITEM_STATUSES.includes(/** @type {ActionItemStatus} */ (value))
}

/**
 * @param {unknown} value
 * @returns {value is ActionItemWarningLevel}
 */
export function isActionItemWarningLevel(value) {
  return (
    typeof value === 'string' &&
    ACTION_ITEM_WARNING_LEVELS.includes(/** @type {ActionItemWarningLevel} */ (value))
  )
}

/**
 * @param {Partial<ActionItem>} input
 * @returns {ActionItem}
 */
export function normalizeActionItem(input) {
  const now = new Date().toISOString()
  const scheduleAt = String(input.scheduleAt ?? '').trim()
  const status = isActionItemStatus(input.status)
    ? input.status
    : deriveActionItemStatusFromSchedule(scheduleAt)

  return {
    id: String(input.id ?? '').trim(),
    productKey: String(input.productKey ?? '').trim(),
    productName: String(input.productName ?? '').trim(),
    content: String(input.content ?? '').trim(),
    detail: String(input.detail ?? '').trim().slice(0, ACTION_ITEM_DETAIL_MAX_LENGTH),
    status,
    firstProposedAt: String(input.firstProposedAt ?? '').trim(),
    scheduleAt,
    painPointSnapshot: String(input.painPointSnapshot ?? '').trim(),
    problemTypeSnapshot: String(input.problemTypeSnapshot ?? '').trim(),
    journeyL1Snapshot: String(input.journeyL1Snapshot ?? '').trim(),
    linkedTicketIds: Array.isArray(input.linkedTicketIds)
      ? input.linkedTicketIds.map((id) => String(id).trim()).filter(Boolean)
      : [],
    linkedRequirementTicketIds: Array.isArray(input.linkedRequirementTicketIds)
      ? input.linkedRequirementTicketIds.map((id) => String(id).trim()).filter(Boolean)
      : [],
    linkedDataSources: Array.isArray(input.linkedDataSources)
      ? input.linkedDataSources.filter(Boolean)
      : [],
    scheduleChanged: Boolean(input.scheduleChanged),
    warningLevel: isActionItemWarningLevel(input.warningLevel) ? input.warningLevel : 'none',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  }
}

/**
 * @param {Partial<ActionItem>} input
 * @returns {{ ok: true; item: ActionItem } | { ok: false; error: string }}
 */
export function validateActionItemCreate(input) {
  const content = String(input.content ?? '').trim()
  if (!content) return { ok: false, error: '举措内容不能为空' }
  if (content.length > ACTION_ITEM_CONTENT_MAX_LENGTH) {
    return { ok: false, error: `举措内容不能超过 ${ACTION_ITEM_CONTENT_MAX_LENGTH} 字` }
  }
  if (input.status != null && !isActionItemStatus(input.status)) {
    return { ok: false, error: '无效的举措状态' }
  }
  const item = normalizeActionItem({
    ...input,
    id: input.id || randomId(),
    firstProposedAt: input.firstProposedAt || new Date().toISOString().slice(0, 10),
  })
  if (!item.id) return { ok: false, error: '缺少举措 ID' }
  return { ok: true, item }
}

/**
 * @param {ActionItem} existing
 * @param {Partial<ActionItem>} patch
 * @returns {{ ok: true; item: ActionItem } | { ok: false; error: string }}
 */
export function mergeActionItemPatch(existing, patch) {
  if (patch.content != null) {
    const content = String(patch.content).trim()
    if (!content) return { ok: false, error: '举措内容不能为空' }
    if (content.length > ACTION_ITEM_CONTENT_MAX_LENGTH) {
      return { ok: false, error: `举措内容不能超过 ${ACTION_ITEM_CONTENT_MAX_LENGTH} 字` }
    }
  }
  if (patch.status != null && !isActionItemStatus(patch.status)) {
    return { ok: false, error: '无效的举措状态' }
  }
  if (patch.warningLevel != null && !isActionItemWarningLevel(patch.warningLevel)) {
    return { ok: false, error: '无效的预警级别' }
  }

  const scheduleAt =
    patch.scheduleAt !== undefined ? String(patch.scheduleAt ?? '').trim() : existing.scheduleAt
  const scheduleChanged =
    patch.scheduleChanged !== undefined
      ? Boolean(patch.scheduleChanged)
      : patch.scheduleAt !== undefined
        ? Boolean(existing.scheduleChanged) ||
          computeScheduleChanged(existing.scheduleAt, scheduleAt)
        : Boolean(existing.scheduleChanged)

  let status = patch.status ?? existing.status
  if (patch.scheduleAt !== undefined && patch.status == null) {
    status = deriveActionItemStatusFromSchedule(scheduleAt)
  }
  if (patch.scheduleAt !== undefined && !scheduleAt) {
    status = 'pending_evaluation'
  }

  const linkedTicketIds =
    patch.linkedTicketIds !== undefined
      ? patch.linkedTicketIds.map((id) => String(id).trim()).filter(Boolean)
      : existing.linkedTicketIds

  const linkedRequirementTicketIds =
    patch.linkedRequirementTicketIds !== undefined
      ? patch.linkedRequirementTicketIds.map((id) => String(id).trim()).filter(Boolean)
      : existing.linkedRequirementTicketIds

  const item = normalizeActionItem({
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    scheduleAt,
    scheduleChanged,
    status,
    linkedTicketIds,
    linkedRequirementTicketIds,
    updatedAt: new Date().toISOString(),
  })

  return { ok: true, item }
}

/**
 * @param {ActionItem} item
 * @param {string} ticketId
 * @param {import('./enums.js').DataSourceType} [dataSourceType]
 * @returns {ActionItem}
 */
export function linkTicketToActionItem(item, ticketId, dataSourceType) {
  const tid = String(ticketId ?? '').trim()
  if (!tid) return item

  const linkedTicketIds = [...(item.linkedTicketIds || [])]
  if (!linkedTicketIds.includes(tid)) linkedTicketIds.push(tid)

  /** @type {import('./enums.js').DataSourceType[]} */
  const linkedDataSources = [...(item.linkedDataSources || [])]
  if (dataSourceType && !linkedDataSources.includes(dataSourceType)) {
    linkedDataSources.push(dataSourceType)
  }

  return normalizeActionItem({
    ...item,
    linkedTicketIds,
    linkedDataSources,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * @param {ActionItem} item
 * @param {string} ticketId
 * @returns {ActionItem}
 */
export function unlinkTicketFromActionItem(item, ticketId) {
  const tid = String(ticketId ?? '').trim()
  if (!tid) return item
  const previous = item.linkedTicketIds || []
  if (!previous.includes(tid)) return item

  const linkedTicketIds = previous.filter((id) => id !== tid)
  return applyActionItemTicketLinkState(item, linkedTicketIds, item.linkedDataSources)
}

/**
 * 解关联或重算关联工单后，同步 linkedDataSources 与快照字段。
 *
 * @param {ActionItem} item
 * @param {string[]} linkedTicketIds
 * @param {import('./enums.js').DataSourceType[]} [linkedDataSources]
 * @returns {ActionItem}
 */
export function applyActionItemTicketLinkState(item, linkedTicketIds, linkedDataSources) {
  const ids = linkedTicketIds.map((id) => String(id).trim()).filter(Boolean)
  if (!ids.length) {
    return normalizeActionItem({
      ...item,
      linkedTicketIds: [],
      linkedDataSources: [],
      painPointSnapshot: '',
      problemTypeSnapshot: '',
      journeyL1Snapshot: '',
      updatedAt: new Date().toISOString(),
    })
  }

  return normalizeActionItem({
    ...item,
    linkedTicketIds: ids,
    linkedDataSources: linkedDataSources ?? item.linkedDataSources ?? [],
    updatedAt: new Date().toISOString(),
  })
}

/**
 * 按仍关联的工单号重算来源列表。
 *
 * @param {ActionItem} item
 * @param {Map<string, import('./enums.js').DataSourceType>} ticketIdToSource
 * @returns {ActionItem}
 */
export function recomputeActionItemLinkedDataSources(item, ticketIdToSource) {
  const ids = item.linkedTicketIds || []
  /** @type {import('./enums.js').DataSourceType[]} */
  const linkedDataSources = []
  for (const id of ids) {
    const source = ticketIdToSource.get(id)
    if (source && !linkedDataSources.includes(source)) linkedDataSources.push(source)
  }
  return applyActionItemTicketLinkState(item, ids, linkedDataSources)
}

/**
 * 前端兜底：按产品 × 状态聚合（与 server/actionItemRepository 逻辑一致）。
 * @param {ActionItem[]} items
 * @returns {{ productKey: string; productName: string; counts: Record<ActionItemStatus, number>; total: number }[]}
 */
export function aggregateActionItemsByProductStatus(items) {
  /** @type {Map<string, { productKey: string; productName: string; counts: Record<ActionItemStatus, number>; total: number }>} */
  const map = new Map()

  for (const item of items || []) {
    const productKey = item.productKey?.trim() || '_unknown'
    const productName = item.productName?.trim() || item.productKey?.trim() || '未标注产品'
    let row = map.get(productKey)
    if (!row) {
      row = {
        productKey,
        productName,
        counts: {
          pending_evaluation: 0,
          in_progress: 0,
          completed: 0,
          suspended: 0,
        },
        total: 0,
      }
      map.set(productKey, row)
    }
    if (ACTION_ITEM_STATUSES.includes(item.status)) {
      row.counts[item.status] += 1
      row.total += 1
    }
  }

  return [...map.values()].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return a.productName.localeCompare(b.productName, 'zh-CN')
  })
}
