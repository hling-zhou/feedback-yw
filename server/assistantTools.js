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
import { searchRecords, sanitizeSearchQuery } from './assistantSearchIndex.js'
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
  const clustering = aggregates.painPointClustering
  if (clustering && typeof clustering === 'object') {
    /** @type {Record<string, unknown>} */
    const products = {}
    const cp = clustering.products || {}
    for (const [productKey, group] of Object.entries(cp)) {
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
            .slice(0, MAX_LIST)
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

/** @param {{ importMonth?: string; dataSourceType?: string; query: string; insightPeriodId?: string }} args */
function searchRecordsTool({ importMonth, dataSourceType, query, insightPeriodId }) {
  const cleaned = sanitizeSearchQuery(query)
  if (cleaned.length < 3) {
    return {
      results: [],
      truncated: false,
      error: '检索词至少 3 个字符，请换更长的关键词',
    }
  }
  const month = String(importMonth || '').trim().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const months = monthsCoveredByPeriod(insightPeriodId)
    if (months.length > 3) {
      return {
        results: [],
        needNarrowerScope: true,
        coveredMonths: months.length,
        error: '周期覆盖超过 3 个月，请指定单个 importMonth（YYYY-MM），不要扫全库',
      }
    }
    return {
      results: [],
      needNarrowerScope: true,
      error: 'search_records 一次只查一个月份，请传入 importMonth（YYYY-MM）',
    }
  }
  const results = searchRecords({
    importMonth: month,
    dataSourceType,
    query: cleaned,
    limit: MAX_SEARCH,
  })
  return {
    results: results.map((r) => ({
      recordId: r.recordId,
      ticketId: r.ticketId,
      product: r.product,
      dataSourceType: r.dataSourceType,
      importMonth: r.importMonth,
      matchedField: r.matchedField,
      snippet: snippet(r.snippet, SNIPPET_LIMIT),
    })),
    truncated: false,
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
      '在指定月份（YYYY-MM）和来源内按关键词检索工单/评价原文，返回最多 15 条片段。一次只查一个月份；季/年/自定义周期若覆盖超过 3 个月，请先让用户改问具体月份，不要逐月扫全库。',
  },
  get_record: {
    fn: getRecord,
    description: '取单条记录的分析字段（客户请求、痛点、原因、建议、评分）加约 400 字引用。',
  },
}

/** 工具名白名单。 */
export const ASSISTANT_TOOL_NAMES = Object.keys(ASSISTANT_TOOLS)
