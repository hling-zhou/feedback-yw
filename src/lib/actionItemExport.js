import * as XLSX from 'xlsx'
import {
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_STATUS_LABELS,
  aggregateActionItemsByProductStatus,
  actionItemStatusLinkedFeedbackLabel,
  createEmptyActionItemStatusCounts,
} from '../domain/actionItem.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { linkedTicketIdsInPeriod } from '../domain/actionItemPeriodFilter.js'
import {
  formatLinkedTicketIdsGroupedForExport,
  groupLinkedTicketIdsByMonth,
} from './actionItemLinkedFeedback.js'
import {
  formatActionItemUpdatedAtDisplay,
  formatActionItemUpdatedByDisplay,
} from '../domain/actionItemRevision.js'
import { listActionItems } from './actionItemClient.js'
import {
  formatDerivedRequirementStatusLabel,
  getActionItemDisplayScheduleAt,
  isActionItemInRequirementLinkMode,
} from '../domain/requirementTicketProgress.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('./actionItemClient.js').ActionItemListQuery} ActionItemListQuery */
/** @typedef {import('./actionItemClient.js').ActionItemProductStatusRow} ActionItemProductStatusRow */

export const ACTION_ITEM_STATS_SHEET_NAME = '分产品统计'
export const ACTION_ITEM_LIST_SHEET_NAME = '举措清单'

export const ACTION_ITEM_STATS_HEADERS = [
  '产品名称',
  ...ACTION_ITEM_STATUSES.flatMap((status) => [
    ACTION_ITEM_STATUS_LABELS[status],
    actionItemStatusLinkedFeedbackLabel(status),
  ]),
  '合计',
  '关联反馈合计',
]

export const ACTION_ITEM_LIST_HEADERS = [
  '产品名称',
  '问题',
  '问题类型',
  '来源',
  '举措',
  '举措详情',
  '关联反馈(本周期)',
  '需求工单',
  '排期时间',
  '状态',
  '首次提出时间',
  '最近更新时间',
  '最近更新人员',
]

/**
 * @param {ActionItemListQuery} query
 * @returns {Promise<{ items: ActionItem[]; total: number }>}
 */
export async function fetchAllActionItems(query) {
  const batchSize = 500
  /** @type {ActionItem[]} */
  const items = []
  let offset = 0
  let total = 0

  while (true) {
    const result = await listActionItems({ ...query, limit: batchSize, offset })
    total = result.total
    items.push(...result.items)
    if (items.length >= total || result.items.length === 0) break
    offset += batchSize
  }

  return { items, total }
}

/**
 * @param {ActionItemProductStatusRow[]} byProduct
 * @returns {Record<string, string | number>[]}
 */
export function buildActionItemStatsRows(byProduct) {
  const rows = (byProduct || []).map((row) => {
    /** @type {Record<string, string | number>} */
    const out = {
      产品名称: row.productName || row.productKey || '未标注产品',
    }
    for (const status of ACTION_ITEM_STATUSES) {
      out[ACTION_ITEM_STATUS_LABELS[status]] = row.counts?.[status] ?? 0
      out[actionItemStatusLinkedFeedbackLabel(status)] = row.linkedFeedbackCounts?.[status] ?? 0
    }
    out.合计 = row.total ?? 0
    out.关联反馈合计 = row.linkedFeedbackTotal ?? 0
    return out
  })

  if (!rows.length) {
    return [
      {
        产品名称: '—',
        ...Object.fromEntries(
          ACTION_ITEM_STATUSES.flatMap((status) => [
            [ACTION_ITEM_STATUS_LABELS[status], 0],
            [actionItemStatusLinkedFeedbackLabel(status), 0],
          ]),
        ),
        合计: 0,
        关联反馈合计: 0,
      },
    ]
  }

  /** @type {Record<ActionItemStatus, number>} */
  const totals = createEmptyActionItemStatusCounts()
  /** @type {Record<ActionItemStatus, number>} */
  const feedbackTotals = createEmptyActionItemStatusCounts()
  let grandTotal = 0
  let linkedFeedbackGrandTotal = 0
  for (const row of byProduct || []) {
    for (const status of ACTION_ITEM_STATUSES) {
      totals[status] += row.counts?.[status] ?? 0
      feedbackTotals[status] += row.linkedFeedbackCounts?.[status] ?? 0
    }
    grandTotal += row.total ?? 0
    linkedFeedbackGrandTotal += row.linkedFeedbackTotal ?? 0
  }

  /** @type {Record<string, string | number>} */
  const summary = { 产品名称: '合计' }
  for (const status of ACTION_ITEM_STATUSES) {
    summary[ACTION_ITEM_STATUS_LABELS[status]] = totals[status]
    summary[actionItemStatusLinkedFeedbackLabel(status)] = feedbackTotals[status]
  }
  summary.合计 = grandTotal
  summary.关联反馈合计 = linkedFeedbackGrandTotal
  rows.push(summary)

  return rows
}

/**
 * @param {ActionItem[]} items
 * @param {Set<string> | null | undefined} periodTicketIdSet
 * @param {Map<string, import('./types.js').FeedbackRecord>} [feedbackByTicketId]
 * @returns {Record<string, string>[]}
 */
export function buildActionItemListRows(items, periodTicketIdSet, feedbackByTicketId) {
  return (items || []).map((item) => {
    const sources = (item.linkedDataSources || [])
      .map((s) => DATA_SOURCE_LABELS[s] || s)
      .join('、')
    const linkedInPeriod = linkedTicketIdsInPeriod(item.linkedTicketIds, periodTicketIdSet)
    const linkedGrouped = formatLinkedTicketIdsGroupedForExport(
      groupLinkedTicketIdsByMonth(linkedInPeriod, feedbackByTicketId),
    )

    const requirementLinked = isActionItemInRequirementLinkMode(item)
    const scheduleAt = getActionItemDisplayScheduleAt(item)
    const statusLabel = requirementLinked
      ? formatDerivedRequirementStatusLabel(item.derivedStatus)
      : ACTION_ITEM_STATUS_LABELS[item.status] || item.status || ''

    return Object.fromEntries(
      ACTION_ITEM_LIST_HEADERS.map((header) => {
        /** @type {Record<string, string>} */
        const row = {
          产品名称: item.productName || item.productKey || '',
          问题: item.painPointSnapshot || '',
          问题类型: item.problemTypeSnapshot || '',
          来源: sources,
          举措: item.content || '',
          举措详情: item.detail || '',
          '关联反馈(本周期)': linkedGrouped,
          需求工单: (item.linkedRequirementTicketIds || []).join('; '),
          排期时间: scheduleAt,
          状态: statusLabel,
          首次提出时间: item.firstProposedAt || '',
          最近更新时间: formatActionItemUpdatedAtDisplay(item),
          最近更新人员: formatActionItemUpdatedByDisplay(item),
        }
        return [header, row[header] ?? '']
      }),
    )
  })
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {Object} options
 * @param {ActionItem[]} options.items
 * @param {ActionItemProductStatusRow[]} [options.statsByProduct]
 * @param {Set<string> | null | undefined} [options.periodTicketIdSet]
 * @param {Map<string, import('./types.js').FeedbackRecord>} [options.feedbackByTicketId]
 * @param {string} [options.filename]
 */
export function downloadActionItemsExcel({
  items,
  statsByProduct,
  periodTicketIdSet,
  feedbackByTicketId,
  filename,
}) {
  const byProduct = statsByProduct?.length
    ? statsByProduct
    : aggregateActionItemsByProductStatus(items, { periodTicketIdSet })

  const statsRows = buildActionItemStatsRows(byProduct)
  const listRows = buildActionItemListRows(items, periodTicketIdSet, feedbackByTicketId)

  const wb = XLSX.utils.book_new()
  const statsSheet = XLSX.utils.json_to_sheet(statsRows, { header: ACTION_ITEM_STATS_HEADERS })
  const listSheet = XLSX.utils.json_to_sheet(
    listRows.length ? listRows : [{ 提示: '无数据' }],
    { header: ACTION_ITEM_LIST_HEADERS },
  )

  XLSX.utils.book_append_sheet(wb, statsSheet, ACTION_ITEM_STATS_SHEET_NAME)
  XLSX.utils.book_append_sheet(wb, listSheet, ACTION_ITEM_LIST_SHEET_NAME)

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  triggerDownload(
    blob,
    filename || `举措与进展-${new Date().toISOString().slice(0, 10)}.xlsx`,
  )
}

/**
 * @param {Object} options
 * @param {ActionItemListQuery} options.query
 * @param {ActionItemProductStatusRow[]} [options.statsByProduct]
 * @param {Set<string> | null | undefined} [options.periodTicketIdSet]
 * @param {Map<string, import('./types.js').FeedbackRecord>} [options.feedbackByTicketId]
 * @param {string} [options.scopeLabel]
 * @param {string} [options.periodLabel]
 */
export async function exportActionItemsWithQuery({
  query,
  statsByProduct,
  periodTicketIdSet,
  feedbackByTicketId,
  scopeLabel,
  periodLabel,
}) {
  const { items } = await fetchAllActionItems(query)
  const datePart = new Date().toISOString().slice(0, 10)
  const scopePart = scopeLabel ? scopeLabel.replace(/\s+/g, '') : '导出'
  const periodPart = periodLabel ? `-${periodLabel.replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')}` : ''
  downloadActionItemsExcel({
    items,
    statsByProduct,
    periodTicketIdSet,
    feedbackByTicketId,
    filename: `举措与进展-${scopePart}${periodPart}-${datePart}.xlsx`,
  })
  return items.length
}
