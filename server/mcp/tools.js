/**
 * MCP P0-P3 Tool handler 实现（11 个）。
 *
 * 每个 handler 接收 (params, apiKey) 两个参数：
 * - params: Agent 传入的 Tool 参数对象
 * - apiKey: 认证后得到的 ApiKeyRecord（用于判断 mcp:full scope）
 *
 * 返回值会被 JSON.stringify 后通过 SSE 回传给 Agent。
 */

import { storageRepository } from '../storageRepository.js'
import { ticketTodoRepository } from '../ticketTodoRepository.js'
import { actionItemRepository } from '../actionItemRepository.js'
import { postUseJiraRepository } from '../postUseJiraRepository.js'
import { readTaxonomyManagedMetaHydrated } from '../taxonomyMetaHygiene.js'
import { getCatalogProducts } from '../../src/lib/productCatalogLoader.js'
import { getPostUseRatingProductNames } from '../../src/lib/productCatalog/postUseRatingProducts.js'
import { META_KEY_POST_USE_VISITS } from '../../src/lib/postUseRating/visitRecords.js'
import { META_KEY_POST_USE_TREND } from '../../src/lib/postUseRating/trendStore.js'
import { loadHtmlReportOverlay } from '../../src/lib/postUseRating/htmlReportOverlay.js'
import { filterRecordsForScope } from '../../src/snapshots/recordScope.js'
import { resolveInsightPeriod, resolvePreviousInsightPeriod } from '../../src/domain/insightPeriod.js'
import { SCHEMA_VERSION } from '../../src/domain/constants.js'
import { normalizeDepartmentStatusTrends, clipDepartmentStatusTrends } from '../../src/lib/postUseRating/statusTrends.js'
import { buildPostUseReportV2Model } from '../../src/lib/postUseRating/reportV2Model.js'
import { postUsePeriodMonths } from '../../src/lib/postUseRating/periodScope.js'
import { getDb } from '../db.js'
import { productNameMap } from '../patrolReportBuilder.js'
import {
  createAllDesensitizeOptions,
  createNoDesensitizeOptions,
  desensitizeColumnValue,
  desensitizeText,
} from '../../src/lib/ticketAnalysisDesensitize.js'
import { canDisableDesensitize } from './auth.js'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

function clampLimit(limit) {
  const n = Number(limit) || DEFAULT_LIMIT
  return Math.min(Math.max(Math.floor(n), 1), MAX_LIMIT)
}

function clampOffset(offset) {
  const n = Number(offset) || 0
  return Math.max(Math.floor(n), 0)
}

/**
 * 解析脱敏选项：desensitize=true 用全脱敏，false 且有 mcp:full 才关闭。
 * @param {boolean | undefined} desensitize
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
function resolveDesensitizeOptions(desensitize, apiKey) {
  if (desensitize === false && canDisableDesensitize(apiKey)) {
    return createNoDesensitizeOptions()
  }
  return createAllDesensitizeOptions()
}

/**
 * 对工单记录做脱敏处理（列级 + 正文级）。
 * @param {Record<string, unknown>} record
 * @param {import('../../src/lib/ticketAnalysisDesensitize.js').DesensitizeOptions} opts
 */
function desensitizeRecord(record, opts) {
  if (!record || typeof record !== 'object') return record
  const r = { ...record }

  // 列级脱敏：loginAccountName / groupCustomerCode / groupName
  if (r.loginAccountName != null) {
    r.loginAccountName = desensitizeColumnValue(r.loginAccountName, 'loginAccountName', opts)
  }
  // sourceColumns 中的列级脱敏
  if (r.sourceColumns && typeof r.sourceColumns === 'object') {
    const sc = { ...r.sourceColumns }
    if (sc['登录账号名称'] != null) {
      sc['登录账号名称'] = desensitizeColumnValue(sc['登录账号名称'], 'loginAccountName', opts)
    }
    if (sc['集团客户编码'] != null) {
      sc['集团客户编码'] = desensitizeColumnValue(sc['集团客户编码'], 'groupCustomerCode', opts)
    }
    if (sc['集团名称'] != null) {
      sc['集团名称'] = desensitizeColumnValue(sc['集团名称'], 'groupName', opts)
    }
    r.sourceColumns = sc
  }

  // 正文级脱敏：rawText / handlingText / customerQuote / responseText
  const textFields = ['rawText', 'handlingText', 'customerQuote', 'responseText']
  for (const field of textFields) {
    if (typeof r[field] === 'string' && r[field]) {
      r[field] = desensitizeText(r[field], opts)
    }
  }

  // sourceColumns 中的正文脱敏
  if (r.sourceColumns && typeof r.sourceColumns === 'object') {
    const sc = { ...r.sourceColumns }
    const textCols = ['受理内容', '处理意见']
    for (const col of textCols) {
      if (typeof sc[col] === 'string' && sc[col]) {
        sc[col] = desensitizeText(sc[col], opts)
      }
    }
    r.sourceColumns = sc
  }

  // customerName / customerCode 脱敏
  if (r.customerName != null) {
    r.customerName = desensitizeColumnValue(r.customerName, 'groupName', opts)
  }
  if (r.customerCode != null) {
    r.customerCode = desensitizeColumnValue(r.customerCode, 'groupCustomerCode', opts)
  }

  return r
}

/**
 * 从记录中提取摘要字段（列表视图用）。
 * @param {Record<string, unknown>} record
 * @param {import('../../src/lib/ticketAnalysisDesensitize.js').DesensitizeOptions} opts
 */
function toTicketSummary(record, opts) {
  const r = desensitizeRecord(record, opts)
  return {
    id: r.id || '',
    ticketId: r.ticketId || '',
    dataSourceType: r.dataSourceType || '',
    product: r.product || r.productName || '',
    importMonth: r.importMonth || '',
    ticketScene: r.ticketScene || r.dimensionTagging?.ticketScene || '',
    ticketType: r.ticketType || r.dimensionTagging?.ticketType || '',
    customerName: r.customerName || '',
    customerCode: r.customerCode || '',
    loginAccountName: r.loginAccountName || '',
    summary: (r.rawText || r.sourceColumns?.['受理内容'] || '').slice(0, 200),
    handlingText: (r.handlingText || r.sourceColumns?.['处理意见'] || '').slice(0, 200),
    handlingResult: r.handlingResult || r.sourceColumns?.['处理结果'] || '',
    createdAt: r.createdAt || '',
  }
}

// ============================================================
// Tool 1: search_tickets
// ============================================================

/**
 * @param {{
 *   product?: string,
 *   dataSourceType?: string,
 *   dataSourceTypes?: string[],
 *   keyword?: string,
 *   customerName?: string,
 *   L1Tag?: string,
 *   L2Tag?: string,
 *   importMonths?: string[],
 *   limit?: number,
 *   offset?: number,
 *   desensitize?: boolean,
 * }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
export async function searchTickets(params, apiKey) {
  const limit = clampLimit(params.limit)
  const offset = clampOffset(params.offset)
  const opts = resolveDesensitizeOptions(params.desensitize, apiKey)

  // 不在 DB 层做 limit/offset，因为后续还有内存过滤（产品/客户/标签/关键词）
  // DB 层只做数据源和月份过滤，拿到全量后在内存做精细过滤再分页
  const query = {
    fields: 'list',
  }

  if (params.dataSourceType) query.dataSourceType = params.dataSourceType
  if (params.dataSourceTypes?.length) query.dataSourceTypes = params.dataSourceTypes
  else if (!params.dataSourceType) {
    // 默认查投诉+咨询
    query.dataSourceTypes = ['complaint_ticket', 'consultation_ticket']
  }

  // importMonths → 单个月用 importMonthFrom/To
  if (params.importMonths?.length === 1) {
    const m = params.importMonths[0].slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(m)) {
      query.importMonthFrom = m
      query.importMonthTo = m
    }
  } else if (params.importMonths?.length >= 2) {
    const sorted = [...params.importMonths].sort()
    query.importMonthFrom = sorted[0].slice(0, 7)
    query.importMonthTo = sorted[sorted.length - 1].slice(0, 7)
  }

  const result = storageRepository.listRecords(query)
  let records = result.records

  // 产品过滤（列表投影不含 product 字段，需从 payload 取）
  if (params.product) {
    records = records.filter(
      (r) => r.product === params.product || r.productName === params.product,
    )
  }

  // 客户名称过滤（搜索时用原名，不脱敏搜索条件）
  if (params.customerName) {
    const needle = params.customerName.trim().toLowerCase()
    records = records.filter((r) => {
      const name = String(r.customerName || r.sourceColumns?.['集团名称'] || '').toLowerCase()
      return name.includes(needle)
    })
  }

  // L1/L2 标签过滤
  if (params.L1Tag) {
    records = records.filter((r) => {
      const tag = r.ticketScene || r.dimensionTagging?.ticketScene || ''
      return tag === params.L1Tag
    })
  }
  if (params.L2Tag) {
    records = records.filter((r) => {
      const tag = r.ticketType || r.dimensionTagging?.ticketType || ''
      return tag === params.L2Tag
    })
  }

  // 关键词搜索（在 rawText / handlingText / sourceColumns 中匹配）
  if (params.keyword) {
    const needle = params.keyword.trim().toLowerCase()
    records = records.filter((r) => {
      const texts = [
        r.rawText,
        r.handlingText,
        r.sourceColumns?.['受理内容'],
        r.sourceColumns?.['处理意见'],
        r.customerQuote,
        r.responseText,
      ]
        .filter(Boolean)
        .map((t) => String(t).toLowerCase())
      return texts.some((t) => t.includes(needle))
    })
  }

  // 内存分页（在所有过滤完成后）
  const total = records.length
  const paged = records.slice(offset, offset + limit)

  const summaries = paged.map((r) => toTicketSummary(r, opts))
  return {
    total,
    records: summaries,
  }
}

// ============================================================
// Tool 2: get_ticket_detail
// ============================================================

/**
 * @param {{
 *   id?: string,
 *   ticketId?: string,
 *   desensitize?: boolean,
 * }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
export async function getTicketDetail(params, apiKey) {
  const opts = resolveDesensitizeOptions(params.desensitize, apiKey)

  let record = null
  if (params.id) {
    record = storageRepository.getRecord(params.id)
  } else if (params.ticketId) {
    // 通过 ticketId 查找：需遍历，因为 getRecord 只按 id 查
    // TODO: 优化为 DB 层按 ticket_id 索引查询（当前 records 表有 ticket_id 列）
    const result = storageRepository.listRecords({
      dataSourceTypes: ['complaint_ticket', 'consultation_ticket'],
      fields: 'full',
    })
    record = result.records.find((r) => r.ticketId === params.ticketId) || null
  }

  if (!record) {
    return { error: '记录不存在', record: null }
  }

  const desensitized = desensitizeRecord(record, opts)

  // 关联查询：actionItems
  let actionItems = []
  if (record.actionId) {
    const item = actionItemRepository.getActionItem(record.actionId)
    if (item) actionItems = [{ id: item.id, content: item.content, status: item.status }]
  }

  return {
    record: {
      ...desensitized,
      actionItems,
    },
  }
}

// ============================================================
// Tool 3: get_post_use_ratings
// ============================================================

/**
 * @param {{
 *   product?: string,
 *   customerName?: string,
 *   importMonth?: string,
 *   channel?: string,
 *   minScore?: number,
 *   maxScore?: number,
 *   limit?: number,
 *   offset?: number,
 *   desensitize?: boolean,
 * }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
export async function getPostUseRatings(params, apiKey) {
  const limit = clampLimit(params.limit)
  const offset = clampOffset(params.offset)
  const opts = resolveDesensitizeOptions(params.desensitize, apiKey)

  // 不在 DB 层做 limit/offset，因为后续还有内存过滤（产品/客户/渠道/分数）
  const query = {
    dataSourceType: 'post_use_rating',
    fields: 'list',
  }

  if (params.importMonth) {
    const m = params.importMonth.slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(m)) {
      query.importMonthFrom = m
      query.importMonthTo = m
    }
  }

  const result = storageRepository.listRecords(query)
  let records = result.records

  // 产品过滤
  if (params.product) {
    records = records.filter(
      (r) => r.product === params.product || r.productName === params.product,
    )
  }

  // 客户名称过滤
  if (params.customerName) {
    const needle = params.customerName.trim().toLowerCase()
    records = records.filter((r) =>
      String(r.customerName || '').toLowerCase().includes(needle),
    )
  }

  // 渠道过滤
  if (params.channel) {
    records = records.filter((r) => String(r.channel || '').toLowerCase().includes(params.channel.toLowerCase()))
  }

  // 分数过滤
  if (params.minScore != null) {
    records = records.filter((r) => Number(r.ratingScore) >= params.minScore)
  }
  if (params.maxScore != null) {
    records = records.filter((r) => Number(r.ratingScore) <= params.maxScore)
  }

  // 统计（在分页之前，对全部匹配记录做统计）
  const allScores = records.map((r) => Number(r.ratingScore)).filter((n) => Number.isFinite(n))
  const total = allScores.length
  const sum = allScores.reduce((a, b) => a + b, 0)
  const avgScore = total ? Math.round((sum / total) * 100) / 100 : 0
  const lowScoreCount = allScores.filter((s) => s <= 7).length

  /** @type {Record<string, number>} */
  const distribution = {}
  for (const s of allScores) {
    const key = String(s)
    distribution[key] = (distribution[key] || 0) + 1
  }

  // 内存分页
  const paged = records.slice(offset, offset + limit)

  const items = paged.map((r) => ({
    id: r.id || '',
    importMonth: r.importMonth || '',
    product: r.product || r.productName || '',
    createdAt: r.createdAt || '',
    channel: r.channel || '',
    ratingScore: r.ratingScore ?? null,
    customerName: desensitizeColumnValue(r.customerName, 'groupName', opts),
    customerCode: desensitizeColumnValue(r.customerCode, 'groupCustomerCode', opts),
    commentText: desensitizeText((r.commentText || r.rawText || '').slice(0, 500), opts),
  }))

  return {
    total: records.length,
    records: items,
    stats: {
      avgScore,
      total: records.length,
      lowScoreCount,
      lowScoreRatio: total ? Math.round((lowScoreCount / total) * 1000) / 1000 : 0,
      distribution,
    },
  }
}

// ============================================================
// Tool 4: get_insight_stats
// ============================================================

/**
 * @param {{
 *   metric?: 'month_summary' | 'rating_trend' | 'status_trends' | 'periods',
 *   product?: string,
 *   month?: string,
 * }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
export async function getInsightStats(params, apiKey) {
  const metric = params.metric || 'month_summary'

  if (metric === 'periods') {
    return { periods: storageRepository.listInsightPeriods() }
  }

  if (metric === 'month_summary') {
    return storageRepository.listImportMonthSummary()
  }

  if (metric === 'rating_trend') {
    const trends = storageRepository.listPostUseStatusTrends()
    // 如果指定了产品，过滤
    if (params.product && Array.isArray(trends)) {
      return {
        trends: trends.filter(
          (/** @type {Record<string, unknown>} */ t) =>
            t.product === params.product || t.productName === params.product,
        ),
      }
    }
    return { trends }
  }

  if (metric === 'status_trends') {
    const trends = storageRepository.listPostUseStatusTrends()
    if (params.product && Array.isArray(trends)) {
      return {
        trends: trends.filter(
          (/** @type {Record<string, unknown>} */ t) =>
            t.product === params.product || t.productName === params.product,
        ),
      }
    }
    return { trends }
  }

  return { error: `未知 metric: ${metric}` }
}

// ============================================================
// Tool 5: get_taxonomy
// ============================================================

/**
 * @param {{
 *   product?: string,
 *   type?: 'managed' | 'curated',
 * }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
export async function getTaxonomy(params, apiKey) {
  const type = params.type || 'managed'

  if (type === 'managed') {
    const taxonomy = readTaxonomyManagedMetaHydrated()
    if (!taxonomy) {
      return { error: '标签库为空', products: [] }
    }
    // 如果指定了产品，过滤
    if (params.product && Array.isArray(taxonomy.products)) {
      const products = taxonomy.products.filter(
        (/** @type {Record<string, unknown>} */ p) =>
          p.name === params.product || p.key === params.product,
      )
      return { ...taxonomy, products }
    }
    return taxonomy
  }

  // curated: 行动建议分类法（从文件读取）
  if (type === 'curated') {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const scriptsDir = process.env.SCRIPTS_DIR || path.resolve(__dirname, '..', '..', 'scripts')

    const PRODUCT_FILE_MAP = {
      '弹性公网IP': 'eip-taxonomy-curated.json',
      '云专线': 'ct-taxonomy-curated.json',
      '虚拟私有云': 'vpc-taxonomy-curated.json',
      '弹性负载均衡': 'elb-taxonomy-curated.json',
    }

    const products = []
    for (const [product, file] of Object.entries(PRODUCT_FILE_MAP)) {
      if (params.product && product !== params.product) continue
      const filePath = path.join(scriptsDir, file)
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        products.push({
          product,
          file,
          families: Array.isArray(raw.families) ? raw.families.length : 0,
          version: String(raw.version || ''),
          lastModified: fs.statSync(filePath).mtime.toISOString(),
          taxonomy: raw,
        })
      } catch {
        // file not found
      }
    }
    return { products }
  }

  return { error: `未知 type: ${type}` }
}

// ============================================================
// Tool 6: get_ticket_todos
// ============================================================

/**
 * @param {{
 *   product?: string,
 *   assigneeName?: string,
 *   resolution?: 'open' | 'resolved' | 'converted_to_action',
 *   insightPeriodId?: string,
 *   search?: string,
 *   limit?: number,
 *   offset?: number,
 * }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
export async function getTicketTodos(params, apiKey) {
  const limit = clampLimit(params.limit)
  const offset = clampOffset(params.offset)

  /** @type {import('../ticketTodoRepository.js').TicketTodoListQuery} */
  const query = {
    limit,
    offset,
  }

  if (params.resolution) query.status = params.resolution
  if (params.search) query.search = params.search
  if (params.insightPeriodId) query.insightPeriodId = params.insightPeriodId

  // product → productKey 需要通过 catalog 映射
  // 缓存刷新契约（11-08 会诊 #2）：本文件不经路由层，目录刷新由 mcp-server.mjs
  // 的 refreshProductCatalogForMcp 在每次 tools/call handler 前执行——
  // 守卫测试 catalogCacheCoverageGuard.test.js 凭此注释认可覆盖。
  if (params.product) {
    const catalogProducts = getCatalogProducts()
    const match = catalogProducts.find(
      (p) => p.name === params.product || p.key === params.product,
    )
    if (match?.key) query.productKey = match.key
  }

  // assigneeName → assigneeUserId 需要查 users 表
  if (params.assigneeName) {
    // ticketTodoRepository 按 userId 筛选，MCP 暂不支持按名字筛
    // TODO: 如果需要，可从 users 表查 displayName → userId
  }

  const result = ticketTodoRepository.listTicketTodos(query)

  return {
    total: result.total,
    items: result.items.map((item) => ({
      id: item.id || '',
      product: item.productName || '',
      productKey: item.productKey || '',
      dataSourceType: item.dataSourceType || '',
      ticketId: item.ticketId || '',
      resolution: item.resolution || '',
      assignees: Array.isArray(item.assignees)
        ? item.assignees.map((a) => ({ userId: a.userId || '', displayName: a.displayName || a.username || '' }))
        : [],
      text: item.text || '',
      priority: item.priority || '',
      linkedTicketIds: item.linkedTicketIds || [],
      updatedAt: item.updatedAt || '',
    })),
  }
}

// ============================================================
// P1 Tool: get_action_items
// ============================================================

/**
 * 产品名称 → productKey 映射（用于 actionItemRepository 查询）。
 * @param {string} productName
 * @returns {string | undefined}
 */
function productNameToKey(productName) {
  if (!productName) return undefined
  const catalog = getCatalogProducts()
  const match = catalog.find((p) => p.name === productName || p.key === productName)
  return match?.key
}

/**
 * @param {{
 *   product?: string,
 *   status?: string,
 *   source?: 'ticket' | 'post_use',
 *   ticketId?: string,
 *   search?: string,
 *   insightPeriodId?: string,
 *   limit?: number,
 *   offset?: number,
 * }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
export async function getActionItems(params, apiKey) {
  const limit = clampLimit(params.limit)
  const offset = clampOffset(params.offset)

  /** @type {import('../actionItemRepository.js').ActionItemListQuery} */
  const query = { limit, offset }

  if (params.product) {
    const key = productNameToKey(params.product)
    if (key) query.productKey = key
    else query.productKey = params.product // 可能直接传的是 key
  }
  if (params.status) query.status = params.status
  if (params.source) query.source = params.source
  if (params.ticketId) query.ticketId = params.ticketId
  if (params.search) query.search = params.search
  if (params.insightPeriodId) query.insightPeriodId = params.insightPeriodId

  const result = actionItemRepository.listActionItems(query)

  return {
    total: result.total,
    items: result.items.map((item) => ({
      id: item.id || '',
      productKey: item.productKey || '',
      productName: item.productName || '',
      content: item.content || '',
      detail: item.detail || '',
      status: item.status || '',
      source: item.source || '',
      firstProposedAt: item.firstProposedAt || '',
      scheduleAt: item.scheduleAt || '',
      warningLevel: item.warningLevel || 'none',
      linkedTicketIds: item.linkedTicketIds || [],
      linkedDataSources: item.linkedDataSources || [],
      problemTypeSnapshot: item.problemTypeSnapshot || '',
      journeyL1Snapshot: item.journeyL1Snapshot || '',
      revision: item.revision ?? 0,
    })),
  }
}

// ============================================================
// P1 Tool: get_action_stats
// ============================================================

/**
 * @param {{
 *   product?: string,
 *   insightPeriodId?: string,
 * }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
export async function getActionStats(params, apiKey) {
  /** @type {import('../actionItemRepository.js').ActionItemListQuery} */
  const query = {}

  if (params.product) {
    const key = productNameToKey(params.product)
    if (key) query.productKey = key
    else query.productKey = params.product
  }
  if (params.insightPeriodId) query.insightPeriodId = params.insightPeriodId

  const counts = actionItemRepository.countActionItemsByStatus(query)
  const byProduct = actionItemRepository.aggregateActionItemsByProductStatus(query)

  return {
    counts,
    byProduct: byProduct.map((row) => ({
      productKey: row.productKey || '',
      productName: row.productName || '',
      counts: row.counts,
      total: row.total,
    })),
  }
}

// ============================================================
// P1+P2 Tool: get_post_use_trace (visit + trace 模式)
// ============================================================

/**
 * 查询用后即评回访/溯源记录。
 * - visit 模式（P1）：省代表回访记录，从 meta.post_use_visits 读取
 * - trace 模式（P2）：产品部溯源记录，从 post_use_jira_items 表读取
 *
 * @param {{
 *   viewType?: 'visit' | 'trace',
 *   importMonth?: string,
 *   productName?: string,
 *   customerName?: string,
 *   assigneeName?: string,
 *   status?: string,
 *   search?: string,
 *   limit?: number,
 *   offset?: number,
 *   desensitize?: boolean,
 * }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
export async function getPostUseTrace(params, apiKey) {
  const viewType = params.viewType === 'trace' ? 'trace' : 'visit'
  const limit = clampLimit(params.limit)
  const offset = clampOffset(params.offset)
  const opts = resolveDesensitizeOptions(params.desensitize, apiKey)

  /** @param {unknown} value @param {string} fieldKey */
  const desensitizeCustomerField = (value, fieldKey) =>
    desensitizeColumnValue(value, fieldKey, opts)

  if (viewType === 'trace') {
    return getPostUseTraceMode(params, apiKey, limit, offset, opts, desensitizeCustomerField)
  }
  return getPostUseVisitMode(params, limit, offset, opts, desensitizeCustomerField)
}

// ---- visit 模式（省代表回访） ----

/**
 * @param {Record<string, unknown>} params
 * @param {number} limit
 * @param {number} offset
 * @param {import('../../src/lib/ticketAnalysisDesensitize.js').DesensitizeOptions} opts
 * @param {(value: unknown, fieldKey: string) => string} desensitizeCustomerField
 */
function getPostUseVisitMode(params, limit, offset, opts, desensitizeCustomerField) {
  // 从 meta.post_use_visits 读取回访记录
  const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  /** @type {any[]} */
  let records = Array.isArray(raw?.records) ? raw.records : []

  // 月份过滤
  if (params.importMonth) {
    const months = String(params.importMonth)
      .split('、')
      .map((m) => m.trim())
      .filter(Boolean)
    if (months.length) {
      const monthSet = new Set(months)
      records = records.filter(
        (r) => monthSet.has(r?.importMonth) || monthSet.has(r?.visitMonth),
      )
    }
  }

  // 产品过滤
  if (params.productName) {
    records = records.filter((r) => String(r?.productName || '') === params.productName)
  }

  // 客户名称过滤（搜索时用原名，不脱敏搜索条件）
  if (params.customerName) {
    const needle = String(params.customerName).trim().toLowerCase()
    records = records.filter((r) =>
      String(r?.customerName || '').toLowerCase().includes(needle),
    )
  }

  // 关键词搜索
  if (params.search) {
    const needle = String(params.search).trim().toLowerCase()
    records = records.filter((r) => {
      const haystack = [
        r?.customerName,
        r?.customerCode,
        r?.productName,
        r?.internalEvaluationDetail,
        r?.internalConclusion,
        r?.remark,
        r?.assigneeName,
      ]
        .filter(Boolean)
        .map((t) => String(t).toLowerCase())
        .join(' ')
      return haystack.includes(needle)
    })
  }

  const total = records.length
  const items = records.slice(offset, offset + limit)

  return {
    viewType: 'visit',
    total,
    items: items.map((r) => ({
      id: r.id || '',
      importMonth: r.importMonth || r.visitMonth || '',
      productName: r.productName || '',
      customerName: desensitizeCustomerField(r.customerName, 'groupName'),
      customerCode: desensitizeCustomerField(r.customerCode, 'groupCustomerCode'),
      loginAccountName: desensitizeCustomerField(r.loginAccountName, 'loginAccountName'),
      internalEvaluationDetail: r.internalEvaluationDetail || '',
      internalConclusion: r.internalConclusion || '',
      remark: r.remark || '',
      assigneeName: r.assigneeName || '',
      actionId: r.actionId || '',
      scoreSource: r.scoreSource || '',
      // 优化建议（自动生成，11-19 上线）：LLM 优先/规则兜底，来源如实标注（llm/rule）
      optimizationProduct: r.optimizationProduct || '',
      optimizationService: r.optimizationService || '',
      optimizationSource: r.optimizationSource || '',
      updatedAt: r.updatedAt || '',
    })),
  }
}

// ---- trace 模式（产品部溯源） ----

/**
 * @param {Record<string, unknown>} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 * @param {number} limit
 * @param {number} offset
 * @param {import('../../src/lib/ticketAnalysisDesensitize.js').DesensitizeOptions} opts
 * @param {(value: unknown, fieldKey: string) => string} desensitizeCustomerField
 */
function getPostUseTraceMode(params, apiKey, limit, offset, opts, desensitizeCustomerField) {
  // postUseJiraRepository.list() 支持 importMonth/productName/status/search，
  // 但不支持 assigneeName 和 customerName 筛选（repo 只按 assigneeId 筛），
  // 这两个条件在内存做
  const repoQuery = /** @type {any} */ ({
    limit: 0, // 0 = 不分页，拉全量后内存过滤再分页（避免 DB 分页+内存过滤导致丢数据）
    offset: 0,
  })

  if (params.importMonth) repoQuery.importMonth = params.importMonth
  if (params.productName) repoQuery.productName = params.productName
  if (params.status) repoQuery.status = params.status
  // search 交给内存过滤（repo 的 search 搜索范围不同，此处统一用 MCP 侧逻辑）

  const result = postUseJiraRepository.list(repoQuery)
  let items = result.items

  // assigneeName 筛选（repo 不支持，内存做）
  if (params.assigneeName) {
    const needle = String(params.assigneeName).trim().toLowerCase()
    items = items.filter((item) =>
      String(item.assigneeName || '').toLowerCase().includes(needle),
    )
  }

  // 客户名称筛选（搜索时用原名，不脱敏搜索条件）
  if (params.customerName) {
    const needle = String(params.customerName).trim().toLowerCase()
    items = items.filter((item) =>
      String(item.customerName || '').toLowerCase().includes(needle),
    )
  }

  // 关键词搜索
  if (params.search) {
    const needle = String(params.search).trim().toLowerCase()
    items = items.filter((item) => {
      const haystack = [
        item.customerName,
        item.customerCode,
        item.productName,
        item.customerFeedback,
        item.recommendedReason,
        item.assigneeName,
        item.progress,
      ]
        .filter(Boolean)
        .map((t) => String(t).toLowerCase())
        .join(' ')
      return haystack.includes(needle)
    })
  }

  const total = items.length
  const paged = items.slice(offset, offset + limit)

  // 对有 actionId 的记录，批量拉取关联举措
  const actionIds = [...new Set(
    paged.map((item) => item.actionId).filter(Boolean),
  )]
  /** @type {Map<string, { content: string; detail: string; scheduleAt: string; status: string }>} */
  const actionMap = new Map()
  for (const aid of actionIds) {
    const action = actionItemRepository.getActionItem(aid)
    if (action) {
      actionMap.set(aid, {
        content: action.content || '',
        detail: action.detail || '',
        scheduleAt: action.scheduleAt || '',
        status: action.status || '',
      })
    }
  }

  return {
    viewType: 'trace',
    total,
    items: paged.map((item) => {
      const action = item.actionId ? actionMap.get(item.actionId) : undefined
      return {
        id: item.id || '',
        importMonth: item.importMonth || '',
        productName: item.productName || '',
        customerName: desensitizeCustomerField(item.customerName, 'groupName'),
        customerCode: desensitizeCustomerField(item.customerCode, 'groupCustomerCode'),
        loginAccountName: desensitizeCustomerField(item.loginAccountName, 'loginAccountName'),
        customerFeedback: item.customerFeedback || '',
        recommendedReason: item.recommendedReason || '',
        originalTicketId: item.originalTicketId || '',
        scoreSource: item.scoreSource || '',
        assigneeName: item.assigneeName || '',
        status: item.status || '',
        progress: item.progress || '',
        actionId: item.actionId || '',
        actionItem: action || null,
        // 优化建议（自动生成，11-19 上线）：LLM 优先/规则兜底，来源如实标注（llm/rule）
        optimizationProduct: item.optimizationProduct || '',
        optimizationService: item.optimizationService || '',
        optimizationSource: item.optimizationSource || '',
        updatedAt: item.updatedAt || '',
      }
    }),
  }
}

// ============================================================
// P3 Tool：报告 V2 / 巡检诊断结果透出（2026-11-20 拍板）
// ============================================================

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const QUARTER_RE = /^\d{4}-Q[1-4]$/

/**
 * 报告期参数解析（与前端 PostUseHtmlReport.resolveReportRoute 同口径：YYYY-MM 月报 / YYYY-Qn 季报）。
 * schemaVersion 与页面同源 import（src/domain/constants.js SCHEMA_VERSION='2.0'）——
 * 手写 '2' 曾致 period 标识漂移（11-21 审计实锤），常量双写违例已纠。
 * @param {string} param
 * @returns {{ key: string, kind: 'month' | 'quarter', periodId: string, period: object } | null}
 */
function resolveReportRouteForMcp(param) {
  const p = String(param || '').trim()
  if (MONTH_RE.test(p)) {
    const periodId = `period:month:${p}`
    return { key: p, kind: 'month', periodId, period: resolveInsightPeriod(periodId, null, SCHEMA_VERSION) }
  }
  if (QUARTER_RE.test(p)) {
    const periodId = `period:quarter:${p}`
    return { key: p, kind: 'quarter', periodId, period: resolveInsightPeriod(periodId, null, SCHEMA_VERSION) }
  }
  return null
}

/**
 * storageRepository 适配为报告链所需 adapter 形态（getMeta/putMeta——htmlReportOverlay 与 trendStore 均此二法）。
 */
const metaAdapter = {
  getMeta: (key) => storageRepository.getMeta(key),
  putMeta: (key, value) => storageRepository.putMeta(key, value),
}

/**
 * P3 Tool：报告 V2 透出。
 *
 * 已保存报告（overlay.snapshot 存在）→ 直接投影快照（与页面显示优先级同口径：保存态即用户审阅过的定稿）。
 * 未保存 → 服务端拉齐与报告页相同的输入（records/visits/traces/actionItems/issueLinks/statusTrends），
 * 复用纯函数 buildPostUseReportV2Model 组装（同函数同参数，零口径分叉），投影结构化结果。
 * 叙事文本（结论/行动）：仅快照态透出已保存的 narratives——未保存态不服务端生成（LLM 文案批属页面交互产物）。
 *
 * @param {{ month?: string, desensitize?: boolean }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
async function getPostUseReportV2(params, apiKey) {
  const route = resolveReportRouteForMcp(params.month)
  if (!route) {
    return { error: 'month 参数格式非法：月报 YYYY-MM（如 2026-10），季报 YYYY-Qn（如 2026-Q3）' }
  }
  // 脱敏契约按密钥 scope 定（与数据来自快照还是实时组装无关）：默认脱敏，
  // mcp:full + 显式 desensitize:false 才关——与其他 Tool 走 resolveDesensitizeOptions 完全同构
  // （11-21 审计实锤：首版 params.desensitize 声明未读 + 快照路径裸透传 focus 泄漏客户原话，已纠）
  const opts = resolveDesensitizeOptions(params.desensitize, apiKey)

  const overlay = await loadHtmlReportOverlay(metaAdapter, route.key)
  const months = postUsePeriodMonths(route.period)
  if (months.length === 0) {
    return { error: `报告期 ${route.key} 无有效月份范围` }
  }
  const monthIds = new Set(months.map((m) => `period:month:${m}`))
  const previous = resolvePreviousInsightPeriod(route.period)
  for (const m of postUsePeriodMonths(previous)) monthIds.add(`period:month:${m}`)

  // records：用后即评分记录。窗口=本期+上期全部月份（报告页两期输入：filterRecordsForScope
  // 只负责 period 内过滤，历史趋势月份走 statusTrends 快照；allCompanyRecords 供趋势对比）。
  // parseRecordPagination 对 limit<1 置 DEFAULT 1000——上限 5000 足以覆盖单期用后即评量级。
  const windowMonths = [...monthIds].map((id) => id.replace('period:month:', '')).sort()
  const monthFrom = windowMonths[0]
  const monthTo = windowMonths[windowMonths.length - 1]
  const listResult = storageRepository.listRecords({
    dataSourceType: 'post_use_rating',
    importMonthFrom: monthFrom,
    importMonthTo: monthTo,
    limit: 5000,
  })
  const allRecords = listResult?.records || []
  const records = filterRecordsForScope(allRecords, route.period, 'post_use_rating')

  // visits / traces / actionItems / issueLinks：与页面 sideLoad 同源
  const visitStore = normalizeVisitStore(await storageRepository.getMeta(META_KEY_POST_USE_VISITS))
  const visits = visitStore.records || []
  const traces = postUseJiraRepository.list({ limit: 0 }).items
  const actionItems = actionItemRepository.listActionItems({ linkedDataSources: 'post_use_rating', limit: 500 })?.items || []
  const issueLinks = (await import('../postUseReportRepository.js')).postUseReportRepository.listLinks()

  // statusTrends：trendStore 单源（页面 adapter.listPostUseStatusTrends 的服务端同源数据）
  const endMonth = months.at(-1) || ''
  let statusTrends = null
  try {
    statusTrends = clipDepartmentStatusTrends(
      normalizeDepartmentStatusTrends(await storageRepository.getMeta(META_KEY_POST_USE_TREND)),
      endMonth,
    )
  } catch { /* 趋势缺失不阻塞报告主体（buildPostUseReportV2Model 允许 statusTrends=null） */ }

  if (overlay?.snapshot) {
    return projectReportSnapshot(route, overlay, opts)
  }

  const model = buildPostUseReportV2Model({
    reportKey: route.key,
    reportKind: route.kind,
    reportPeriod: route.period,
    records,
    companyRecords: records,
    allRecords: records,
    allCompanyRecords: allRecords,
    visits,
    traces,
    issueLinks,
    actionItems,
    statusTrends,
    overlay,
    catalogNames: getPostUseRatingProductNames(getCatalogProducts()),
  })
  return projectReportModel(route, model, overlay, opts)
}

/** visit meta store 归一化（与 getPostUseTrace visit 路径同口径）。 */
function normalizeVisitStore(raw) {
  if (!raw || typeof raw !== 'object') return { records: [] }
  const records = Array.isArray(raw.records) ? raw.records : []
  return { records }
}

/**
 * 报告快照投影（已保存态）：KPI/产品块/主题/关注项/待办 + 已保存叙事。
 * 文本字段（focus 引用/产品 quotes 样例）一律过 desensitizeText(opts)——脱敏按密钥 scope 定，
 * 与数据来自快照还是实时组装无关（11-21 审计实锤快照路径曾裸透传）。
 * @param {{ key: string, kind: string }} route
 * @param {{ snapshot?: Record<string, unknown> | null, narratives?: Record<string, unknown>, updatedAt?: string, updatedBy?: string }} overlay
 * @param {import('../../src/lib/ticketAnalysisDesensitize.js').DesensitizeOptions} opts
 */
function projectReportSnapshot(route, overlay, opts) {
  const snap = /** @type {Record<string, unknown>} */ (overlay.snapshot) || {}
  const narratives = overlay.narratives || {}
  const products = Array.isArray(snap.products) ? snap.products : []
  return {
    reportKey: route.key,
    kind: route.kind,
    saved: true,
    updatedAt: overlay.updatedAt || '',
    updatedBy: overlay.updatedBy || '',
    title: String(snap.title || `用后即评${route.kind === 'quarter' ? '季' : '月'}报（${route.key}）`),
    kpis: projectKpis(snap.kpis),
    products: products.map((/** @type {Record<string, unknown>} */ p) => projectProduct(p, opts)),
    focus: (Array.isArray(snap.focus) ? snap.focus : []).map((/** @type {Record<string, unknown>} */ f) => projectFocus(f, opts)),
    themes: (Array.isArray(snap.themes) ? snap.themes : []).map((/** @type {Record<string, unknown>} */ t) => projectTheme(t)),
    todos: projectTodos(narratives.todoItems || snap.todoRows, narratives.todoNote || snap.todoNote || ''),
    narratives: {
      judgment: desensitizeText(String(narratives.judgment || snap.judgment || ''), opts),
      issues: desensitizeIssueNarratives(narratives.issues, opts),
    },
    note: '已保存报告快照（页面「保存报告」后的定稿数据）；未保存月份调用时按当前数据实时组装（narratives 为空，结论需在页面生成）。',
  }
}

/**
 * 报告模型投影（未保存态）：与快照投影同字段形态（saved=false，叙事为空）。
 * @param {{ key: string, kind: string }} route
 * @param {Record<string, unknown>} model
 * @param {{ narratives?: Record<string, unknown>, updatedAt?: string } | null} overlay
 * @param {import('../../src/lib/ticketAnalysisDesensitize.js').DesensitizeOptions} opts
 */
function projectReportModel(route, model, overlay, opts) {
  return {
    reportKey: route.key,
    kind: route.kind,
    saved: false,
    updatedAt: overlay?.updatedAt || '',
    updatedBy: '',
    title: String(model.title || ''),
    kpis: projectKpis(model.kpis),
    products: (model.products || []).map((/** @type {Record<string, unknown>} */ p) => projectProduct(p, opts)),
    focus: (model.focus || []).map((/** @type {Record<string, unknown>} */ f) => projectFocus(f, opts)),
    themes: (model.themes || []).map((/** @type {Record<string, unknown>} */ t) => projectTheme(t)),
    todos: projectTodos(overlay?.narratives?.todoItems || model.todoRows, overlay?.narratives?.todoNote || model.todoNote || ''),
    narratives: {
      judgment: desensitizeText(String(overlay?.narratives?.judgment || ''), opts),
      issues: desensitizeIssueNarratives(overlay?.narratives?.issues, opts),
    },
    note: '未保存态：按当前库内数据实时组装（与报告页同函数同输入）；叙事文本（结论/行动）为页面 LLM 交互产物，未保存时为空。',
  }
}

/** KPI 投影：纯数值，无脱敏需求。 */
function projectKpis(kpis) {
  if (!kpis || typeof kpis !== 'object') return {}
  const k = /** @type {Record<string, unknown>} */ (kpis)
  return {
    avg: k.avg ?? null,
    companyAvg: k.companyAvg ?? null,
    previousAvg: k.previousAvg ?? null,
    experienceAvg: k.experienceAvg ?? null,
    totalSample: k.totalSample ?? 0,
    companySample: k.companySample ?? 0,
    productCount: k.productCount ?? 0,
    belowNineCount: k.belowNineCount ?? 0,
    belowNineNames: Array.isArray(k.belowNineNames) ? k.belowNineNames : [],
  }
}

/** 产品块投影：评分/状态/低分主题/回访溯源计数 + 引用样例（文本过 desensitizeText(opts)）。 */
function projectProduct(p, opts) {
  const quotes = Array.isArray(p.quotes) ? p.quotes : []
  const themes = Array.isArray(p.themes) ? p.themes : []
  return {
    name: String(p.name || ''),
    avg: p.avg ?? null,
    sample: p.sample ?? 0,
    belowNine: Boolean(p.belowNine),
    status: String(p.status || ''),
    p0ThemeCount: themes.filter((/** @type {Record<string, unknown>} */ t) => t.priority === 'P0').length,
    lowThemeCount: themes.filter((/** @type {Record<string, unknown>} */ t) => t.type === 'low').length,
    lowThree: p.lowThree ?? 0,
    callbackRate: p.callbackRate ?? null,
    visitCount: Array.isArray(p.visits) ? p.visits.length : 0,
    traceCount: Array.isArray(p.traces) ? p.traces.length : 0,
    positiveCount: p.positiveCount ?? 0,
    quotesSample: quotes.slice(0, 3).map((/** @type {Record<string, unknown>} */ q) => ({
      text: desensitizeText(String(q.text || ''), opts),
      score: q.score ?? null,
      channel: String(q.channel || ''),
    })),
  }
}

/**
 * 关注项投影（11-21 审计缺陷 1 修复）：脱敏按列级语义分字段处理——
 * - 纯客户标识字段无（focus 不直接带客户名/编码列）；
 * - text/title/detail/check/judgment 等自由文本过 desensitizeText（正文级：密码/IP 正则）——
 *   与 search_tickets 的 summary 同语义边界：正文内公司名/账号字样不在列级替换能力内
 *   （列级工具只认「整个值就是客户标识」的字段，拼接句不适用），属既有脱敏体系设计边界；
 * - quotes/lowestQuotes 是客户原话列表，同正文级处理，**高频客户名场景下建议配 mcp:full 消费**。
 * recordIds/monthCounts 等内部 ID 与计数不敏感保留。
 * @param {Record<string, unknown>} f
 * @param {import('../../src/lib/ticketAnalysisDesensitize.js').DesensitizeOptions} opts
 */
function projectFocus(f, opts) {
  const desensitizeList = (v) =>
    Array.isArray(v) ? v.map((/** @type {unknown} */ x) => desensitizeText(String(x || ''), opts)).filter(Boolean) : []
  return {
    id: String(f.id || ''),
    productName: String(f.productName || ''),
    theme: String(f.theme || ''),
    priority: String(f.priority || ''),
    lifecycle: String(f.lifecycle || ''),
    text: desensitizeText(String(f.text || ''), opts),
    actionType: String(f.actionType || ''),
    title: desensitizeText(String(f.title || ''), opts),
    detail: desensitizeText(String(f.detail || ''), opts),
    customerDissatisfied: Boolean(f.customerDissatisfied),
    isNew: Boolean(f.isNew),
    previousCount: Number(f.previousCount ?? 0),
    lowestScore: f.lowestScore ?? null,
    owner: String(f.owner || ''),
    team: String(f.team || ''),
    status: String(f.status || ''),
    check: desensitizeText(String(f.check || ''), opts),
    sourceRecordCount: Number(f.sourceRecordCount ?? 0),
    recordIds: Array.isArray(f.recordIds) ? f.recordIds : [],
    monthCounts: f.monthCounts && typeof f.monthCounts === 'object' ? f.monthCounts : {},
    quotes: desensitizeList(f.quotes),
    lowestQuotes: desensitizeList(f.lowestQuotes),
  }
}

/** 主题投影：生命周期/优先级/计数，剔除 recordIds 长列表。 */
function projectTheme(t) {
  return {
    productName: String(t.productName || ''),
    theme: String(t.theme || ''),
    type: String(t.type || ''),
    lifecycle: String(t.lifecycle || ''),
    priority: String(t.priority || ''),
    count: Number(t.count ?? (Array.isArray(t.recordIds) ? t.recordIds.length : 0)),
    lowestScore: t.lowestScore ?? null,
    l1: String(t.l1 || ''),
    l2: String(t.l2 || ''),
  }
}

/**
 * 产品块叙事脱敏：issues 形如 { 'product:<名>': { conclusion, action } }——文本值过脱敏，键保留。
 * @param {Record<string, unknown> | undefined | null} issues
 * @param {import('../../src/lib/ticketAnalysisDesensitize.js').DesensitizeOptions} opts
 */
function desensitizeIssueNarratives(issues, opts) {
  if (!issues || typeof issues !== 'object') return {}
  const out = /** @type {Record<string, { conclusion: string, action: string }>} */ ({})
  for (const [key, value] of Object.entries(issues)) {
    const v = /** @type {Record<string, unknown>} */ (value)
    if (!v || typeof v !== 'object') continue
    out[key] = {
      conclusion: desensitizeText(String(v.conclusion || ''), opts),
      action: desensitizeText(String(v.action || ''), opts),
    }
  }
  return out
}

/** 待办投影。 */
function projectTodos(rows, note) {
  const list = Array.isArray(rows) ? rows : []
  return {
    note: String(note || ''),
    items: list.map((/** @type {Record<string, unknown>} */ r) => ({
      id: String(r.id || ''),
      content: String(r.content || ''),
      owner: String(r.owner || ''),
      team: String(r.team || ''),
      source: String(r.source || ''),
    })),
  }
}

/**
 * P3 Tool：API 巡检失败组与诊断结果透出。
 *
 * 组级查询（默认近 7 天，startDate/endDate 可覆盖）+ 每组带最新一次 success 诊断的
 * 结构化五段（结论/失败事实/直接原因/证据/建议）——语义与页面抽屉 buildDiagnosisReport
 * 同口径（LLM 结构化产物优先、原始日志降级切分）；诊断失败/未诊断组如实标注
 * （diagnosisStatus: success/failed/none），不冒充有结论。
 *
 * @param {{ startDate?: string, endDate?: string, product?: string, poolName?: string,
 *   apiPath?: string, metricName?: string, rootCauseL1?: string, status?: string,
 *   limit?: number, offset?: number, includeRawLog?: boolean, desensitize?: boolean }} params
 * @param {import('../apiKeyRepository.js').ApiKeyRecord | null} apiKey
 */
function getPatrolDiagnoses(params, apiKey) {
  const db = getDb()
  const limit = clampLimit(params.limit)
  const offset = clampOffset(params.offset)
  // userName 是失败请求的客户账号（YDY… 编码/名称形态）——脱敏是默认承诺（11-21 审计问题 5 修复）
  const opts = resolveDesensitizeOptions(params.desensitize, apiKey)

  // 时间窗默认近 7 天（含当日）。「今日」以 Node 进程本地日期锚定——与种子/测试/巡检页
  // 三处口径一致；不用 SQL date('now','localtime')（宿主机时区依赖 + 跨环境漂移，
  // trapped-pending 测试 11-21 凌晨 UTC/localtime 跨午夜红同族坑）
  let start = String(params.startDate || '').trim()
  let end = String(params.endDate || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    const today = new Date()
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    end = fmt(today)
    start = fmt(new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000))
  }

  /** @type {string[]} */
  const where = ['g.group_date BETWEEN ? AND ?']
  /** @type {Array<string | number>} */
  const sqlParams = [start, end]
  if (params.product) { where.push('g.product_key = ?'); sqlParams.push(String(params.product)) }
  if (params.poolName) { where.push('g.pool_name = ?'); sqlParams.push(String(params.poolName)) }
  if (params.apiPath) { where.push('g.api_path LIKE ?'); sqlParams.push(`%${String(params.apiPath)}%`) }
  if (params.metricName) { where.push('g.metric_name LIKE ?'); sqlParams.push(`%${String(params.metricName)}%`) }
  if (params.rootCauseL1) {
    where.push(`COALESCE(NULLIF(g.root_cause_l1_manual, ''), g.root_cause_l1) = ?`)
    sqlParams.push(String(params.rootCauseL1))
  }
  if (params.status) { where.push('g.product_action_status = ?'); sqlParams.push(String(params.status)) }

  const rows = db.prepare(`
    SELECT g.id, g.group_date AS groupDate, g.product_key AS productKey, g.pool_name AS poolName,
           g.api_path AS apiPath, g.metric_name AS metricName, g.user_name AS userName,
           g.first_request_id AS firstRequestId, g.pre_compress_count AS preCompressCount,
           g.customer_type AS customerType, g.root_cause_l1 AS rootCauseL1, g.root_cause_l2 AS rootCauseL2,
           g.root_cause_l1_manual AS rootCauseL1Manual, g.root_cause_l2_manual AS rootCauseL2Manual,
           g.product_action_status AS productActionStatus, g.assignee,
           g.root_cause_confirmed AS rootCauseConfirmed, g.measure_feedback AS measureFeedback,
           (SELECT d.status FROM api_patrol_diagnoses d WHERE d.failure_group_id = g.id
             AND d.status = 'success' ORDER BY d.id DESC LIMIT 1) AS diagSuccessStatus,
           (SELECT d.status FROM api_patrol_diagnoses d WHERE d.failure_group_id = g.id
             ORDER BY d.id DESC LIMIT 1) AS diagAnyStatus
    FROM api_patrol_failure_groups g
    WHERE ${where.join(' AND ')}
    ORDER BY g.group_date DESC, g.first_request_time DESC
    LIMIT 500
  `).all(...sqlParams)

  const total = rows.length
  const paged = rows.slice(offset, offset + limit)
  const PRODUCT_NAMES = productNameMap()
  const includeRaw = Boolean(params.includeRawLog)

  const items = paged.map((g) => {
    const group = /** @type {Record<string, unknown>} */ (g)
    // 有效根因口径（manual 优先 COALESCE）——与页面列表/筛选同源
    const l1 = String(group.rootCauseL1Manual || group.rootCauseL1 || '')
    const l2 = String(group.rootCauseL2Manual || group.rootCauseL2 || '')
    const diagStatus = group.diagSuccessStatus === 'success'
      ? 'success'
      : group.diagAnyStatus ? 'failed' : 'none'
    const report = diagStatus === 'success' ? buildPatrolDiagnosisReportForMcp(db, group, includeRaw) : null
    return {
      id: group.id,
      groupDate: group.groupDate,
      productKey: group.productKey,
      productName: PRODUCT_NAMES[String(group.productKey || '')] || group.productKey,
      poolName: group.poolName,
      apiPath: group.apiPath,
      metricName: group.metricName,
      userName: desensitizeColumnValue(String(group.userName || ''), 'groupName', opts),
      firstRequestId: group.firstRequestId,
      preCompressCount: group.preCompressCount,
      customerType: group.customerType || '',
      rootCauseL1: l1,
      rootCauseL2: l2,
      productActionStatus: group.productActionStatus || '',
      assignee: group.assignee || '',
      rootCauseConfirmed: group.rootCauseConfirmed || '',
      diagnosisStatus: diagStatus,
      diagnosis: report,
    }
  })

  return {
    range: { startDate: start, endDate: end },
    total,
    limit,
    offset,
    items,
    diagnosisStatusNote: 'success=最新一次成功诊断（诊断结论可信）；failed=仅有失败诊断记录（MCP 调用/LLM 失败，次日自动重试，结论不可用）；none=从未诊断（超龄收敛或未到诊断环节）。',
  }
}

/** 诊断五段投影（与页面 buildDiagnosisReport 同语义：LLM 结构化优先、原文降级切分）。 */
function buildPatrolDiagnosisReportForMcp(db, group, includeRaw) {
  const diag = db.prepare(`
    SELECT request_id, status, tool_name, mcp_raw_response, final_conclusion, suggestion,
           root_cause_l1, root_cause_l2, direct_cause, evidence, root_cause_source, action_reason, diagnosed_at
    FROM api_patrol_diagnoses WHERE failure_group_id = ? AND status = 'success'
    ORDER BY id DESC LIMIT 1
  `).get(group.id)
  if (!diag) return null
  const d = /** @type {Record<string, unknown>} */ (diag)
  const raw = String(d.mcp_raw_response || '')
  /** @type {string[]} */
  let directLines = []
  /** @type {string[]} */
  let evidence = []
  let rawCount = /** @type {number | null} */ (null)
  try {
    const parsed = JSON.parse(d.direct_cause || '')
    if (Array.isArray(parsed)) directLines = parsed.map(String).filter(Boolean).map((l) => l.slice(0, 300))
  } catch { /* 非数组形态留空 */ }
  try {
    const parsed = JSON.parse(d.evidence || '')
    if (Array.isArray(parsed)) evidence = parsed.map(String).filter(Boolean).map((l) => l.slice(0, 200))
  } catch { /* 同上 */ }
  // rawCount 三态（11-20 口径）：数字=标准响应可数；null=行数未知；0=确无内容
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.code === '0000' && Array.isArray(parsed?.data?.records)) rawCount = parsed.data.records.length
  } catch { /* 非 JSON 原文 → null */ }
  if (rawCount === null && !raw) rawCount = 0
  return {
    conclusion: String(d.final_conclusion || '').trim() || null,
    suggestion: String(d.suggestion || '').trim() || null,
    failureFacts: {
      apiPath: String(group.apiPath || ''),
      poolName: String(group.poolName || ''),
      userName: String(group.userName || ''),
      metricName: String(group.metricName || ''),
    },
    directCause: {
      logLines: directLines.slice(0, 10),
      rawCount,
    },
    evidence: [...new Set(evidence)].slice(0, 10),
    rootCauseSource: d.root_cause_source == null ? null : String(d.root_cause_source),
    diagnosedAt: d.diagnosed_at || '',
    ...(includeRaw ? { rawLog: raw.slice(0, 20000) } : {}),
  }
}

// ============================================================
// Tool 注册表（供 mcp-server.mjs 使用）
// ============================================================

export const MCP_TOOLS = [
  {
    name: 'search_tickets',
    description: '搜工单（按产品/客户/标签/关键词/月份筛）：搜索投诉/咨询工单。支持按产品、客户名称、标签、关键词、月份等条件筛选，返回工单摘要列表（含受理内容 summary 与处理意见原文摘要 handlingText，脱敏后）。',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品名称（如：弹性公网IP、云专线、虚拟私有云、弹性负载均衡）' },
        dataSourceType: { type: 'string', description: '数据源类型：complaint_ticket（投诉）或 consultation_ticket（咨询）' },
        keyword: { type: 'string', description: '全文搜索关键词，在受理内容、处理意见、客户原话等文本字段中匹配' },
        customerName: { type: 'string', description: '客户名称（搜索时用原名匹配，返回结果中客户名称脱敏）' },
        L1Tag: { type: 'string', description: '一级标签（请求场景）' },
        L2Tag: { type: 'string', description: '二级标签（问题类型）' },
        importMonths: { type: 'array', items: { type: 'string' }, description: '数据月份列表（格式：YYYY-MM）' },
        limit: { type: 'number', description: '返回条数上限，默认 50，最大 200' },
        offset: { type: 'number', description: '分页偏移量，默认 0' },
        desensitize: { type: 'boolean', description: '是否脱敏，默认 true。传 false 需 API Key 具备 mcp:full scope' },
      },
    },
    handler: searchTickets,
  },
  {
    name: 'get_ticket_detail',
    description: '工单全量详情（标签、行动建议关联）：获取单条工单的完整详情（含受理内容、处理意见原文 handlingText、客户原话、回复内容、关联举措等；处理意见为投诉/咨询工单处理过程的原文）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '记录 ID（rec_ 开头）' },
        ticketId: { type: 'string', description: '工单号（与 id 二选一）' },
        desensitize: { type: 'boolean', description: '是否脱敏，默认 true。传 false 需 API Key 具备 mcp:full scope' },
      },
    },
    handler: getTicketDetail,
  },
  {
    name: 'get_post_use_ratings',
    description: '用后即评满意度（均分/低分/分布统计）：查询用后即评满意度数据。支持按产品、客户、月份、渠道、分数区间筛选，返回评分列表和统计信息。',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品名称' },
        customerName: { type: 'string', description: '客户名称' },
        importMonth: { type: 'string', description: '数据月份（格式：YYYY-MM）' },
        channel: { type: 'string', description: '渠道（如：sms、web、app）' },
        minScore: { type: 'number', description: '最低评分（含）' },
        maxScore: { type: 'number', description: '最高评分（含），如 maxScore=7 可筛低分' },
        limit: { type: 'number', description: '返回条数上限，默认 50，最大 200' },
        offset: { type: 'number', description: '分页偏移量，默认 0' },
        desensitize: { type: 'boolean', description: '是否脱敏，默认 true。传 false 需 API Key 具备 mcp:full scope' },
      },
    },
    handler: getPostUseRatings,
  },
  {
    name: 'get_insight_stats',
    description: '洞察统计（月度汇总/趋势/周期列表）：获取洞察统计和趋势数据。支持月度汇总、评分趋势、状态趋势、周期列表。',
    inputSchema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['month_summary', 'rating_trend', 'status_trends', 'periods'], description: '统计指标类型' },
        product: { type: 'string', description: '产品名称（仅 rating_trend/status_trends 有效）' },
        month: { type: 'string', description: '月份（格式：YYYY-MM）' },
      },
    },
    handler: getInsightStats,
  },
  {
    name: 'get_taxonomy',
    description: '分类法/标签库（产品体系/旅程模板）：获取分类法/标签库。managed 类型返回标签库（L1/L2 标签定义和 match 关键词），curated 类型返回行动建议分类法。',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品名称（不传则返回所有产品）' },
        type: { type: 'string', enum: ['managed', 'curated'], description: '分类法类型，默认 managed' },
      },
    },
    handler: getTaxonomy,
  },
  {
    name: 'get_ticket_todos',
    description: '会议待办清单：查询会议待办清单。支持按产品、经办人、状态（open/resolved）筛选，返回待办事项列表。',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品名称' },
        resolution: { type: 'string', enum: ['open', 'resolved', 'converted_to_action'], description: '待办状态' },
        search: { type: 'string', description: '搜索关键词（在待办文本中匹配）' },
        insightPeriodId: { type: 'string', description: '洞察周期 ID' },
        limit: { type: 'number', description: '返回条数上限，默认 50，最大 200' },
        offset: { type: 'number', description: '分页偏移量，默认 0' },
      },
    },
    handler: getTicketTodos,
  },
  {
    name: 'get_action_items',
    description: '行动建议/举措清单：查询行动建议/举措清单。支持按产品、状态、来源（ticket/post_use）、关联工单号、关键词等条件筛选，返回举措列表。',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品名称' },
        status: { type: 'string', enum: ['pending_evaluation', 'in_progress', 'completed', 'suspended', 'not_implemented', 'abnormal_terminated'], description: '举措状态' },
        source: { type: 'string', enum: ['ticket', 'post_use'], description: '举措来源：ticket=投诉/咨询工单，post_use=用后即评' },
        ticketId: { type: 'string', description: '关联工单号' },
        search: { type: 'string', description: '在举措内容中搜索关键词' },
        insightPeriodId: { type: 'string', description: '洞察周期 ID（仅返回关联到该周期内工单的举措）' },
        limit: { type: 'number', description: '返回条数上限，默认 50，最大 200' },
        offset: { type: 'number', description: '分页偏移量，默认 0' },
      },
    },
    handler: getActionItems,
  },
  {
    name: 'get_action_stats',
    description: '举措统计：获取行动建议统计。按状态汇总计数，并按产品维度分组统计。',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品名称（不传则统计全部产品）' },
        insightPeriodId: { type: 'string', description: '洞察周期 ID' },
      },
    },
    handler: getActionStats,
  },
  {
    name: 'get_post_use_trace',
    description: '回访/溯源记录：查询用后即评回访/溯源记录。viewType=visit 查询省代表回访记录（含内部评估结论、备注、优化建议），viewType=trace 查询产品部溯源记录（含客户反馈、推荐理由、处理进展、关联举措、优化建议）。两种模式均含自动生成的产品/服务优化建议（optimizationProduct/optimizationService，optimizationSource 标注来源 llm 或 rule）。支持按月份、产品、客户名称、经办人、状态、关键词筛选。',
    inputSchema: {
      type: 'object',
      properties: {
        viewType: { type: 'string', enum: ['visit', 'trace'], description: '查询模式：visit=省代表回访（默认），trace=产品部溯源' },
        importMonth: { type: 'string', description: '数据月份（格式：YYYY-MM，支持「、」分隔多月份）' },
        productName: { type: 'string', description: '产品名称' },
        customerName: { type: 'string', description: '客户名称（搜索时用原名匹配，返回结果中脱敏）' },
        assigneeName: { type: 'string', description: '经办人名称（trace 模式专用，模糊匹配）' },
        status: { type: 'string', description: '处理状态筛选（trace 模式专用：待处理/进行中/已完成）' },
        search: { type: 'string', description: '关键词搜索（visit 模式搜客户名/评估结论/备注；trace 模式搜客户名/反馈/推荐理由/进展）' },
        limit: { type: 'number', description: '返回条数上限，默认 50，最大 200' },
        offset: { type: 'number', description: '分页偏移量，默认 0' },
        desensitize: { type: 'boolean', description: '是否脱敏，默认 true。传 false 需 API Key 具备 mcp:full scope' },
      },
    },
    handler: getPostUseTrace,
  },
  {
    name: 'get_post_use_report_v2',
    description: '用后即评报告 V2：透出月报/季报的结构化数据（KPI 均分与样本量、产品块主句与低分主题、关注项、主题清单、待办、已保存的结论叙事）。已保存报告返回定稿快照（saved=true，含结论/行动叙事）；未保存月份按当前库内数据实时组装（saved=false，叙事为空——结论由页面 LLM 交互生成）。产品引用样例默认脱敏。',
    inputSchema: {
      type: 'object',
      required: ['month'],
      properties: {
        month: { type: 'string', description: '报告期：月报 YYYY-MM（如 2026-10）或季报 YYYY-Qn（如 2026-Q3）' },
        desensitize: { type: 'boolean', description: '是否脱敏文本中的客户信息（关注项引用/产品引用样例/叙事文本），默认 true。传 false 需 API Key 具备 mcp:full scope' },
      },
    },
    handler: getPostUseReportV2,
  },
  {
    name: 'get_patrol_diagnoses',
    description: 'API 巡检失败组与诊断结论：查询巡检发现的失败请求组（默认近 7 天），每组带最新一次成功诊断的结构化五段（结论/失败事实/直接原因/关键证据/处理建议）与有效根因（人工修正优先）。诊断状态如实标注：success=结论可信；failed=诊断调用失败（次日自动重试，结论不可用）；none=从未诊断。仿真/测试账号组的处理动作见 productActionStatus。客户账号（userName）默认脱敏。',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: '起始日期（格式：YYYY-MM-DD，默认近 7 天前）' },
        endDate: { type: 'string', description: '结束日期（格式：YYYY-MM-DD，默认今日）' },
        product: { type: 'string', description: '产品 key（如 eip、slb）' },
        poolName: { type: 'string', description: '资源池名称（精确匹配）' },
        apiPath: { type: 'string', description: '接口路径（模糊匹配）' },
        metricName: { type: 'string', description: '指标名称（模糊匹配）' },
        rootCauseL1: { type: 'string', description: '有效根因一级分类（人工修正优先口径）' },
        status: { type: 'string', description: '处理状态：pending_diagnosis/待处理/处理中/已处理 等' },
        includeRawLog: { type: 'boolean', description: '是否附诊断时的 MCP 原始日志（默认 false；原文最长 20000 字符）' },
        limit: { type: 'number', description: '返回条数上限，默认 50，最大 200' },
        offset: { type: 'number', description: '分页偏移量，默认 0' },
        desensitize: { type: 'boolean', description: '是否脱敏客户账号，默认 true。传 false 需 API Key 具备 mcp:full scope' },
      },
    },
    handler: getPatrolDiagnoses,
  },
]
