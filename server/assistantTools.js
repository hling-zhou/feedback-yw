/**
 * AI 助手只读工具集合。
 *
 * 每个工具返回压成摘要后的 JSON（去掉 recordIds / isolatedRecordIds / 聚类 id 列表），
 * 单次结果体积封顶。全部只读，不调用任何业务写方法。
 */

import { storageRepository } from './storageRepository.js'
import { actionItemRepository } from './actionItemRepository.js'
import { ticketTodoRepository } from './ticketTodoRepository.js'
import { postUseJiraRepository } from './postUseJiraRepository.js'
import { searchRecords, searchRecordsRange, sanitizeSearchQuery } from './assistantSearchIndex.js'
import { buildWanTouByProducts } from '../src/lib/wanTouRatio.js'
import { listOrderVolumesSync } from './assistantOrderVolumeStore.js'
import { listWanTouTargetsSync } from './assistantWanTouTargetStore.js'
import { overviewSnapshotId, sourceSnapshotId } from '../src/domain/snapshot.js'
import { listMonthsInclusive } from '../src/domain/insightPeriod.js'

const DATA_SOURCE_TYPES = [
  'complaint_ticket',
  'consultation_ticket',
  'post_use_rating',
  'user_survey',
  'other',
]

const MAX_LIST = 30
const MAX_SEARCH = 15
const SNIPPET_LIMIT = 180
const RECORD_SNIPPET_LIMIT = 400

/** @param {string} text @param {number} limit */
function snippet(text, limit) {
  const s = String(text || '').trim()
  if (!s) return ''
  return s.length > limit ? `${s.slice(0, limit)}…` : s
}

/** @param {unknown} value */
function toCount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** @param {{ name?: string; label?: string; count?: number }[] | undefined} list */
function topCounts(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      name: String(item?.name || item?.label || '').trim(),
      count: toCount(item?.count),
    }))
    .filter((item) => item.name)
    .slice(0, MAX_LIST)
}

function listPeriods() {
  const periods = storageRepository.listInsightPeriods()
  return {
    periods: periods.map((p) => ({
      id: p.id,
      label: p.label,
      granularity: p.granularity || 'month',
      startDate: p.startDate,
      endDate: p.endDate,
    })),
  }
}

/** @param {{ insightPeriodId: string }} args */
function getPeriodOverview({ insightPeriodId }) {
  const periodId = String(insightPeriodId || '').trim()
  if (!periodId) return { error: '缺少 insightPeriodId' }
  const overview = storageRepository.getSnapshot(overviewSnapshotId(periodId))
  if (!overview) return { status: 'missing' }

  /** @type {Record<string, unknown>} */
  const sourceSummaries = {}
  const ss = overview.sourceSummaries || {}
  for (const type of DATA_SOURCE_TYPES) {
    const s = ss[type]
    if (!s) continue
    sourceSummaries[type] = {
      recordCount: toCount(s.recordCount),
      negativePct: s.negativePct ?? null,
      openCount: toCount(s.openCount),
    }
  }

  const conclusions = overview.conclusions || {}
  const recommendations = Array.isArray(conclusions.recommendations)
    ? conclusions.recommendations
        .map((/** @type {Record<string, unknown>} */ r) => ({
          id: r.id,
          priority: r.priority,
          category: r.category,
          summary: snippet(String(r.summary || r.text || ''), 200),
          scope: r.scope || undefined,
        }))
        .slice(0, MAX_LIST)
    : []

  return {
    status: overview.status || 'ready',
    generatedAt: overview.generatedAt || null,
    totalRecords: toCount(overview.crossSourceMetrics?.totalRecords),
    sourceSummaries,
    conclusions: {
      executiveSummary: snippet(String(conclusions.executiveSummary || ''), 400),
      highlights: Array.isArray(conclusions.highlights)
        ? conclusions.highlights
            .map((/** @type {Record<string, unknown>} */ h) => ({
              type: h.type,
              title: snippet(String(h.title || ''), 120),
              body: snippet(String(h.body || ''), 240),
            }))
            .slice(0, MAX_LIST)
        : [],
      recommendations,
    },
  }
}

/** @param {{ insightPeriodId: string; dataSourceType: string }} args */
function getSourceSnapshot({ insightPeriodId, dataSourceType }) {
  const periodId = String(insightPeriodId || '').trim()
  const source = String(dataSourceType || '').trim()
  if (!periodId || !DATA_SOURCE_TYPES.includes(source)) {
    return { error: '缺少 insightPeriodId 或 dataSourceType 不合法' }
  }
  const snap = storageRepository.getSnapshot(sourceSnapshotId(source, periodId))
  if (!snap) return { status: 'missing' }

  const summary = snap.summary || {}
  const aggregates = snap.aggregates || {}

  /** @type {Record<string, unknown>} */
  const out = {
    status: snap.status || 'ready',
    generatedAt: snap.generatedAt || null,
    dataSourceType: source,
    summary: {
      recordCount: toCount(summary.recordCount),
      negativePct: summary.negativePct ?? null,
      openCount: toCount(summary.openCount),
    },
    products: topCounts(aggregates.products),
    requestScenes: topCounts(aggregates.requestScenes),
    problemTypes: topCounts(aggregates.problemTypes),
    complaintCauseL1: topCounts(aggregates.complaintCauseL1),
    sentiment: Array.isArray(aggregates.sentiment)
      ? aggregates.sentiment
          .map((/** @type {Record<string, unknown>} */ s) => ({
            label: String(s.label || s.name || '').trim(),
            count: toCount(s.count),
          }))
          .slice(0, MAX_LIST)
      : [],
  }

  // 痛点簇：去掉 recordIds / isolatedRecordIds，只留标签、条数、代表句
  // 截断：产品按工单量取前 8 个，每个产品前 3 个簇，避免顶到 12000 字上限
  const clustering = aggregates.painPointClustering
  if (clustering && typeof clustering === 'object') {
    /** @type {{ ticketCount?: number; primaryClusters?: unknown[] }[]} */
    const productEntries = Object.entries(clustering.products || {})
      .map(([productKey, group]) => ({
        productKey,
        group,
        ticketCount: Array.isArray(group?.primaryClusters)
          ? group.primaryClusters.reduce(
              (sum, /** @type {Record<string, unknown>} */ c) => sum + toCount(c.ticketCount),
              0,
            )
          : 0,
      }))
      .sort((a, b) => b.ticketCount - a.ticketCount)
      .slice(0, 8)
    /** @type {Record<string, unknown>} */
    const products = {}
    for (const { productKey, group } of productEntries) {
      const clusters = Array.isArray(group?.primaryClusters)
        ? group.primaryClusters
            .map((/** @type {Record<string, unknown>} */ c) => ({
              label: snippet(String(c.label || ''), 120),
              journeyL1: c.journeyL1 || '',
              problemType: c.problemType || '',
              ticketCount: toCount(c.ticketCount),
              representativePainPoint: snippet(String(c.representativePainPoint || ''), 200),
              representativeCause: snippet(String(c.representativeCause || ''), 200),
            }))
            .slice(0, 3)
        : []
      products[productKey] = { clusters }
    }
    out.painPointClustering = { products }
  }

  return out
}

/** @param {{ insightPeriodId: string }} args */
function getWanTou({ insightPeriodId }) {
  const periodId = String(insightPeriodId || '').trim()
  if (!periodId) return { error: '缺少 insightPeriodId' }
  const period = storageRepository.getInsightPeriod(periodId)
  if (!period) return { status: 'missing' }

  const { records } = storageRepository.listRecords({
    insightPeriodId: periodId,
    dataSourceType: 'complaint_ticket',
    fields: 'list',
  })

  const rows = buildWanTouByProducts({
    period,
    records,
    orderVolumes: listOrderVolumesSync(),
    wanTouTargets: listWanTouTargetsSync(),
  })

  return {
    products: rows.map((row) => ({
      productName: row.productName,
      productKey: row.productKey,
      granularityLabel: row.granularityLabel,
      displayRatio: row.displayRatio,
      totalComplaints: row.totalComplaints,
      totalCxComplaints: row.totalCxComplaints,
      missingOrderMonths: row.missingOrderMonths || [],
    })),
  }
}

/** @param {{ importMonth: string }} args */
function summarizePostUse({ importMonth }) {
  const month = String(importMonth || '').trim().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: 'importMonth 需为 YYYY-MM' }

  const { records: monthRecords } = storageRepository.listRecords({
    dataSourceType: 'post_use_rating',
    insightPeriodId: `period:month:${month}`,
    fields: 'list',
  })
  if (!monthRecords.length) return { status: 'missing', importMonth: month }

  const scores = monthRecords.map((r) => Number(r.ratingScore)).filter((n) => Number.isFinite(n))
  const total = scores.length
  const avg = total ? scores.reduce((s, n) => s + n, 0) / total : null

  /** @type {Record<string, number>} */
  const distribution = {}
  for (const n of scores) {
    const bucket = n < 7 ? 'low' : n < 9 ? 'mid' : 'high'
    distribution[bucket] = (distribution[bucket] || 0) + 1
  }

  /** @type {Map<string, { sum: number; count: number }>} */
  const byProduct = new Map()
  for (const r of monthRecords) {
    const score = Number(r.ratingScore)
    if (!Number.isFinite(score)) continue
    const name = String(r.product || '未标注产品').trim() || '未标注产品'
    const entry = byProduct.get(name) || { sum: 0, count: 0 }
    entry.sum += score
    entry.count += 1
    byProduct.set(name, entry)
  }
  const products = [...byProduct.entries()]
    .map(([name, e]) => ({
      product: name,
      avg: e.count ? Math.round((e.sum / e.count) * 100) / 100 : null,
      count: e.count,
    }))
    .filter((p) => p.count >= 3)
    .sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99))
    .slice(0, MAX_LIST)

  return {
    importMonth: month,
    recordCount: monthRecords.length,
    scoredCount: total,
    avgScore: avg != null ? Math.round(avg * 100) / 100 : null,
    distribution,
    products,
  }
}

/** @param {{ productKey?: string; status?: string }} [args] */
function listActions(args = {}) {
  const result = actionItemRepository.listActionItems({
    productKey: args.productKey,
    status: args.status,
    limit: MAX_LIST,
    offset: 0,
  })
  return {
    items: result.items.map((item) => ({
      id: item.id,
      title: snippet(String(item.content || item.title || ''), 120),
      status: item.status,
      product: item.productName || item.productKey,
      firstProposedAt: item.firstProposedAt || '',
      scheduleAt: item.scheduleAt || '',
    })),
    total: result.total,
    truncated: result.total > MAX_LIST,
  }
}

/** @param {{ insightPeriodId?: string; status?: string }} [args] */
function listTicketTodos(args = {}) {
  const result = ticketTodoRepository.listTicketTodos({
    insightPeriodId: args.insightPeriodId,
    status: args.status,
    limit: MAX_LIST,
    offset: 0,
  })
  return {
    items: result.items.map((row) => ({
      id: row.id || row.ticketTodoItemId,
      text: snippet(String(row.text || ''), 120),
      resolution: row.resolution,
      assignees: (row.assignees || []).map(
        (/** @type {{ userId: string; username: string }} */ a) => a.username || a.userId,
      ),
      ticketId: row.ticketId,
      linkedTicketIds: (row.linkedTicketIds || []).slice(0, 10),
      product: row.productName || row.productKey,
    })),
    total: result.total,
    truncated: result.total > MAX_LIST,
  }
}

/** @param {{ status?: string; productName?: string }} [args] */
function listPostUseJira(args = {}) {
  const result = postUseJiraRepository.list({
    status: args.status,
    productName: args.productName,
    limit: MAX_LIST,
    offset: 0,
  })
  return {
    items: result.items.map((item) => ({
      id: item.id,
      itemKey: item.itemKey,
      title: snippet(String(item.customerFeedback || item.customerName || ''), 120),
      status: item.status,
      productName: item.productName,
      jiraTicket: item.jiraTicket,
    })),
    total: result.total,
    truncated: result.total > MAX_LIST,
  }
}

function monthsCoveredByPeriod(insightPeriodId) {
  const periodId = String(insightPeriodId || '').trim()
  if (!periodId) return []
  const period = storageRepository.getInsightPeriod(periodId)
  if (!period?.startDate || !period?.endDate) return []
  return listMonthsInclusive(period.startDate.slice(0, 7), period.endDate.slice(0, 7))
}

/** @param {{ importMonth?: string; year?: string | number; importMonthFrom?: string; importMonthTo?: string; dataSourceType?: string; query: string; insightPeriodId?: string }} args */
function searchRecordsTool({ importMonth, year, importMonthFrom, importMonthTo, dataSourceType, query, insightPeriodId }) {
  const cleaned = sanitizeSearchQuery(query)
  if (cleaned.length < 3) {
    return {
      results: [],
      total: 0,
      truncated: false,
      error: '检索词至少 3 个字符，请换更长的关键词',
    }
  }
  // 范围检索（按年或起止月份）：一次查完，返回总数 + 最多 20 条
  if (year != null && year !== '') {
    const out = searchRecordsRange({ year, dataSourceType, query: cleaned, limit: 20 })
    return {
      total: out.total,
      truncated: out.truncated,
      needNarrowerScope: out.needNarrowerScope,
      error: out.error,
      results: out.results.map((r) => ({
        recordId: r.recordId,
        ticketId: r.ticketId,
        product: r.product,
        dataSourceType: r.dataSourceType,
        importMonth: r.importMonth,
        matchedField: r.matchedField,
        snippet: snippet(r.snippet, SNIPPET_LIMIT),
      })),
    }
  }
  if (importMonthFrom || importMonthTo) {
    const out = searchRecordsRange({ importMonthFrom, importMonthTo, dataSourceType, query: cleaned, limit: 20 })
    return {
      total: out.total,
      truncated: out.truncated,
      needNarrowerScope: out.needNarrowerScope,
      error: out.error,
      results: out.results.map((r) => ({
        recordId: r.recordId,
        ticketId: r.ticketId,
        product: r.product,
        dataSourceType: r.dataSourceType,
        importMonth: r.importMonth,
        matchedField: r.matchedField,
        snippet: snippet(r.snippet, SNIPPET_LIMIT),
      })),
    }
  }
  const month = String(importMonth || '').trim().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const months = monthsCoveredByPeriod(insightPeriodId)
    if (months.length > 3) {
      return {
        results: [],
        total: 0,
        truncated: false,
        needNarrowerScope: true,
        coveredMonths: months.length,
        error: '周期覆盖超过 3 个月，请改用 year（YYYY）一次查全年，或指定单个 importMonth（YYYY-MM）',
      }
    }
    return {
      results: [],
      total: 0,
      truncated: false,
      needNarrowerScope: true,
      error: 'search_records 一次只查一个月份，请传入 importMonth（YYYY-MM）或 year（YYYY）',
    }
  }
  const results = searchRecords({
    importMonth: month,
    dataSourceType,
    query: cleaned,
    limit: MAX_SEARCH,
  })
  return {
    total: results.length,
    truncated: false,
    results: results.map((r) => ({
      recordId: r.recordId,
      ticketId: r.ticketId,
      product: r.product,
      dataSourceType: r.dataSourceType,
      importMonth: r.importMonth,
      matchedField: r.matchedField,
      snippet: snippet(r.snippet, SNIPPET_LIMIT),
    })),
  }
}

/** @param {{ recordId: string }} args */
function getRecord({ recordId }) {
  const id = String(recordId || '').trim()
  if (!id) return { error: '缺少 recordId' }
  const record = storageRepository.getRecord(id)
  if (!record) return { status: 'missing' }

  return {
    recordId: record.id,
    ticketId: record.ticketId || '',
    product: record.product || '',
    dataSourceType: record.dataSourceType || '',
    importMonth: record.importMonth || '',
    customerRequest: snippet(String(record.customerRequest || ''), RECORD_SNIPPET_LIMIT),
    painPoint: snippet(
      String(record.painPoint || record.problemSummary || ''),
      RECORD_SNIPPET_LIMIT,
    ),
    rootCause: snippet(String(record.rootCause || ''), RECORD_SNIPPET_LIMIT),
    optimizationSuggestion: snippet(
      String(record.optimizationSuggestion || ''),
      RECORD_SNIPPET_LIMIT,
    ),
    ratingScore: record.ratingScore ?? null,
    followUpSatisfaction: record.followUpSatisfaction ?? null,
    sentiment: record.sentiment || '',
  }
}

/** 工具注册表。模型只能调用这里列出的工具。 */
export const ASSISTANT_TOOLS = {
  list_periods: {
    fn: listPeriods,
    description: '列出所有洞察周期（id、粒度、标签、起止日期），用于解析"上月"等相对周期。',
  },
  get_period_overview: {
    fn: getPeriodOverview,
    description: '取某周期的综合概览：各来源条数、要点、行动建议标题。不含万投比。',
  },
  get_source_snapshot: {
    fn: getSourceSnapshot,
    description:
      '取某周期单个数据源（complaint_ticket/consultation_ticket/post_use_rating/user_survey/other）的摘要与聚合：产品、问题类型、投诉原因、旅程、情绪、痛点簇。用后即评快照不含评分。',
  },
  get_wan_tou: {
    fn: getWanTou,
    description:
      '计算某周期各产品万投比（投诉工单/订单量×10000）。返回各产品万投比、缺订单月份。',
  },
  summarize_post_use: {
    fn: summarizePostUse,
    description:
      '按单月（YYYY-MM）聚合用后即评：条数、平均分、分数分布、分产品均分。一次只查一个月；跨多个月请按月各调一次，单轮最多 3 个月。',
  },
  list_actions: {
    fn: listActions,
    description: '列出产品举措：标题、状态、产品、时间。可按 productKey/status 过滤。',
  },
  list_ticket_todos: {
    fn: listTicketTodos,
    description:
      '列出会议待办：待办文本、处理状态、负责人、关联工单号。可按 insightPeriodId/status 过滤。',
  },
  list_post_use_jira: {
    fn: listPostUseJira,
    description:
      '列出来自用后即评的内部 JIRA 提单：标题、状态、产品、JIRA 号。可按 status/productName 过滤。',
  },
  search_records: {
    fn: searchRecordsTool,
    description:
      '按关键词检索工单/评价原文。支持三种范围：单月 importMonth（YYYY-MM，最多 15 条）、整年 year（YYYY，一次查完 12 个月，返回总数和最多 20 条）、起止月份 importMonthFrom/importMonthTo（YYYY-MM，最多 12 个月）。问"今年/全年"用 year，不要逐月调用。可按 dataSourceType 过滤来源。',
  },
  get_record: {
    fn: getRecord,
    description: '取单条记录的分析字段（客户请求、痛点、原因、建议、评分）加约 400 字引用。',
  },
}

/** 工具名白名单。 */
export const ASSISTANT_TOOL_NAMES = Object.keys(ASSISTANT_TOOLS)
