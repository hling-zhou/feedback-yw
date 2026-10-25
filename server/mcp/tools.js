/**
 * MCP P0+P1 Tool handler 实现（9 个）。
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
import { META_KEY_POST_USE_VISITS } from '../../src/lib/postUseRating/visitRecords.js'
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
 * - visit 模式（P1）：客服部回访记录，从 meta.post_use_visits 读取
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

// ---- visit 模式（客服部回访） ----

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
        updatedAt: item.updatedAt || '',
      }
    }),
  }
}

// ============================================================
// Tool 注册表（供 mcp-server.mjs 使用）
// ============================================================

export const MCP_TOOLS = [
  {
    name: 'search_tickets',
    description: '搜索投诉/咨询工单。支持按产品、客户名称、标签、关键词、月份等条件筛选，返回工单摘要列表（脱敏后）。',
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
    description: '获取单条工单的完整详情（含受理内容、处理意见、客户原话、回复内容、关联举措等）。',
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
    description: '查询用后即评满意度数据。支持按产品、客户、月份、渠道、分数区间筛选，返回评分列表和统计信息。',
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
    description: '获取洞察统计和趋势数据。支持月度汇总、评分趋势、状态趋势、周期列表。',
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
    description: '获取分类法/标签库。managed 类型返回标签库（L1/L2 标签定义和 match 关键词），curated 类型返回行动建议分类法。',
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
    description: '查询会议待办清单。支持按产品、经办人、状态（open/resolved）筛选，返回待办事项列表。',
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
    description: '查询行动建议/举措清单。支持按产品、状态、来源（ticket/post_use）、关联工单号、关键词等条件筛选，返回举措列表。',
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
    description: '获取行动建议统计。按状态汇总计数，并按产品维度分组统计。',
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
    description: '查询用后即评回访/溯源记录。viewType=visit 查询客服部回访记录（含内部评估结论、备注），viewType=trace 查询产品部溯源记录（含客户反馈、推荐理由、处理进展、关联举措）。支持按月份、产品、客户名称、经办人、状态、关键词筛选。',
    inputSchema: {
      type: 'object',
      properties: {
        viewType: { type: 'string', enum: ['visit', 'trace'], description: '查询模式：visit=客服部回访（默认），trace=产品部溯源' },
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
]
