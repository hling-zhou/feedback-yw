import * as XLSX from 'xlsx'
/** @typedef {import('../domain/actionItem.js').ActionItemStatus} ActionItemStatus */
import {
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_STATUS_LABELS,
  ACTION_ITEM_SOURCE_LABELS,
  aggregateActionItemsByProductStatus,
  actionItemStatusLinkedFeedbackLabel,
  createEmptyActionItemStatusCounts,
  resolveActionItemProductDisplayName,
} from '../domain/actionItem.js'
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
 * @param {Map<string, string>} [productNameByKey]
 * @returns {Record<string, string>[]}
 */
export function buildActionItemListRows(items, periodTicketIdSet, feedbackByTicketId, productNameByKey) {
  return (items || []).map((item) => {
    // 来源列输出档名（11-24 拍板）：与「产品举措与进展」档名一致，导出→导入往返闭环
    const sources = ACTION_ITEM_SOURCE_LABELS[item.source || 'ticket'] || ACTION_ITEM_SOURCE_LABELS.ticket
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
          产品名称: resolveActionItemProductDisplayName(item, productNameByKey),
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
 * @param {Map<string, string>} [options.productNameByKey]
 * @param {string} [options.filename]
 */
export function downloadActionItemsExcel({
  items,
  statsByProduct,
  periodTicketIdSet,
  feedbackByTicketId,
  productNameByKey,
  filename,
}) {
  const byProduct = statsByProduct?.length
    ? statsByProduct
    : aggregateActionItemsByProductStatus(items, { periodTicketIdSet, productNameByKey })

  const statsRows = buildActionItemStatsRows(byProduct)
  const listRows = buildActionItemListRows(
    items,
    periodTicketIdSet,
    feedbackByTicketId,
    productNameByKey,
  )

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
 * Excel sheet 名安全化：禁字符（/ \ ? * [ ]）替换为全角斜杠，长度截 31（Excel 上限）。
 * @param {string} name
 */
function sheetNameSafe(name) {
  return String(name || '').replace(/[/\\?*[\]]/g, '／').slice(0, 31)
}

/**
 * 按来源档分 sheet 组装 workbook（纯函数，node 可直测）。
 * @param {Object} options
 * @param {ActionItem[]} options.items
 * @param {Set<string> | null | undefined} [options.periodTicketIdSet]
 * @param {Map<string, import('./types.js').FeedbackRecord>} [options.feedbackByTicketId]
 * @param {Map<string, string>} [options.productNameByKey]
 * @returns {XLSX.WorkBook} - 首个 sheet 为跨来源汇总「全部·分产品统计」（总览）；其后每个有数据的档一组「{档名}·分产品统计」「{档名}·举措清单」
 */
export function buildActionItemsWorkbookBySource({
  items,
  periodTicketIdSet,
  feedbackByTicketId,
  productNameByKey,
}) {
  const wb = XLSX.utils.book_new()
  /** @type {NonNullable<ActionItem['source']>[]} */
  const sourceOrder = ['ticket', 'post_use', 'observation', 'api_patrol']

  // 跨来源汇总总览 sheet（11-24 追加拍板）：全量举措分产品统计，置于首个位置
  const allByProduct = aggregateActionItemsByProductStatus(items || [], {
    periodTicketIdSet,
    productNameByKey,
  })
  const allStatsSheet = XLSX.utils.json_to_sheet(buildActionItemStatsRows(allByProduct), {
    header: ACTION_ITEM_STATS_HEADERS,
  })
  XLSX.utils.book_append_sheet(wb, allStatsSheet, sheetNameSafe('全部·分产品统计'))

  for (const source of sourceOrder) {
    const scoped = (items || []).filter((item) => (item.source || 'ticket') === source)
    if (!scoped.length) continue

    const label = ACTION_ITEM_SOURCE_LABELS[source]
    const byProduct = aggregateActionItemsByProductStatus(scoped, {
      periodTicketIdSet,
      productNameByKey,
    })
    const statsRows = buildActionItemStatsRows(byProduct)
    const listRows = buildActionItemListRows(
      scoped,
      periodTicketIdSet,
      feedbackByTicketId,
      productNameByKey,
    )

    const statsSheet = XLSX.utils.json_to_sheet(statsRows, { header: ACTION_ITEM_STATS_HEADERS })
    const listSheet = XLSX.utils.json_to_sheet(
      listRows.length ? listRows : [{ 提示: '无数据' }],
      { header: ACTION_ITEM_LIST_HEADERS },
    )
    XLSX.utils.book_append_sheet(wb, statsSheet, sheetNameSafe(`${label}·分产品统计`))
    XLSX.utils.book_append_sheet(wb, listSheet, sheetNameSafe(`${label}·举措清单`))
  }

  if (!wb.SheetNames.length) {
    const emptySheet = XLSX.utils.json_to_sheet([{ 提示: '无数据' }])
    XLSX.utils.book_append_sheet(wb, emptySheet, '举措清单')
  }
  return wb
}

/**
 * 按来源档分 sheet 导出（11-24 拍板：「所有来源全部」导出时每档一组 统计+清单 sheet）。
 * 档顺序固定（投诉/咨询 → 用后即评 → 留观问题 → API巡检），空档不出 sheet。
 *
 * @param {Object} options
 * @param {ActionItem[]} options.items - 全量举措（未按 source 过滤）
 * @param {Set<string> | null | undefined} [options.periodTicketIdSet]
 * @param {Map<string, import('./types.js').FeedbackRecord>} [options.feedbackByTicketId]
 * @param {Map<string, string>} [options.productNameByKey]
 * @param {string} [options.filename]
 */
export function downloadActionItemsExcelBySource({
  items,
  periodTicketIdSet,
  feedbackByTicketId,
  productNameByKey,
  filename,
}) {
  const wb = buildActionItemsWorkbookBySource({
    items,
    periodTicketIdSet,
    feedbackByTicketId,
    productNameByKey,
  })
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename || `举措与进展-按来源分表-${new Date().toISOString().slice(0, 10)}.xlsx`,
  )
  return (items || []).length
}

/**
 * @param {Object} options
 * @param {ActionItemListQuery} options.query
 * @param {ActionItemProductStatusRow[]} [options.statsByProduct]
 * @param {Set<string> | null | undefined} [options.periodTicketIdSet]
 * @param {Map<string, import('./types.js').FeedbackRecord>} [options.feedbackByTicketId]
 * @param {Map<string, string>} [options.productNameByKey]
 * @param {string} [options.scopeLabel]
 * @param {string} [options.periodLabel]
 * @param {boolean} [options.bySource] - true=按来源档分 sheet（忽略 statsByProduct，每档自带统计）
 */
export async function exportActionItemsWithQuery({
  query,
  statsByProduct,
  periodTicketIdSet,
  feedbackByTicketId,
  productNameByKey,
  scopeLabel,
  periodLabel,
  bySource,
}) {
  const { items } = await fetchAllActionItems(query)
  const datePart = new Date().toISOString().slice(0, 10)
  const scopePart = scopeLabel ? scopeLabel.replace(/\s+/g, '') : '导出'
  const periodPart = periodLabel ? `-${periodLabel.replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')}` : ''
  if (bySource) {
    return downloadActionItemsExcelBySource({
      items,
      periodTicketIdSet,
      feedbackByTicketId,
      productNameByKey,
      filename: `举措与进展-${scopePart}${periodPart}-${datePart}.xlsx`,
    })
  }
  downloadActionItemsExcel({
    items,
    statsByProduct,
    periodTicketIdSet,
    feedbackByTicketId,
    productNameByKey,
    filename: `举措与进展-${scopePart}${periodPart}-${datePart}.xlsx`,
  })
  return items.length
}
