import * as XLSX from 'xlsx'
import {
  ACTION_ITEM_STATUS_LABELS,
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_SOURCE_LABELS,
  deriveActionItemStatusFromSchedule,
  isActionItemStatus,
  validateActionItemCreate,
  toActionItemCreateBody,
} from '../domain/actionItem.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { normalizeActionScheduleInput } from '../domain/actionSchedule.js'
import { ACTION_ITEM_LIST_SHEET_NAME } from './actionItemExport.js'

export const REQUIREMENT_LINKED_IMPORT_IGNORED_FIELDS_HINT =
  '已填需求工单时，排期时间与状态列将被忽略；列表展示以「外部集成」为准。'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/** @type {Record<string, DataSourceType>} */
const DATA_SOURCE_BY_LABEL = Object.fromEntries(
  Object.entries(DATA_SOURCE_LABELS).map(([key, label]) => [label, /** @type {DataSourceType} */ (key)]),
)

/** @type {Record<string, import('../domain/actionItem.js').ActionItemStatus>} */
const STATUS_BY_LABEL = Object.fromEntries(
  ACTION_ITEM_STATUSES.map((status) => [ACTION_ITEM_STATUS_LABELS[status], status]),
)

const LINKED_TICKET_HEADERS = [
  '关联反馈',
  '关联反馈(本周期)',
  '关联反馈号',
  '关联反馈（可选）',
  '关联工单',
  '关联工单(本周期)',
  '关联工单号',
  '关联工单（可选）',
]
const LINKED_REQUIREMENT_TICKET_HEADERS = ['需求工单', '需求工单（可选）', '关联需求工单']

/**
 * 将模板表头（含 *（必填）/（可选））规范为导入字段名。
 *
 * @param {string} header
 */
export function normalizeActionItemImportHeader(header) {
  return String(header ?? '')
    .replace(/\*（必填）$/, '')
    .replace(/（必填）$/, '')
    .replace(/（可选）$/, '')
    .trim()
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function normalizeActionItemImportRow(row) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, value] of Object.entries(row || {})) {
    out[normalizeActionItemImportHeader(key)] = value
  }
  return out
}

/**
 * 剥掉导出分组带的月份前缀（P2-A，2026-11-25 导出→导入往返断裂修复）。
 * 导出格式为 `${month}: ${ids}`（actionItemLinkedFeedback.formatLinkedTicketIdsGroupedForExport），
 * 按分隔符切分后前缀残留在首段（如 "未知月份: 2026…X918103377" / "2026-05: T-1"），
 * 与 records 裸工单号 join 不上。此处剥 "YYYY-MM: "、"未知月份: "（全/半角冒号）两种前缀。
 * 幂等：裸号不含前缀，原样保留。
 * @param {string} part
 * @returns {string}
 */
export function stripLinkedTicketIdMonthPrefix(part) {
  return String(part ?? '')
    .replace(/^\s*(?:\d{4}-\d{1,2}|未知月份)\s*[:：]\s*/, '')
    .trim()
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function parseLinkedTicketIdsCell(text) {
  const seen = new Set()
  /** @type {string[]} */
  const out = []
  for (const part of String(text ?? '').split(/[\n,，;；]+/)) {
    const id = stripLinkedTicketIdMonthPrefix(part)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * @param {string} text
 * @returns {DataSourceType[]}
 */
export function parseLinkedDataSourcesCell(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return []

  /** @type {DataSourceType[]} */
  const out = []
  for (const part of raw.split(/[、,，;；]+/)) {
    const token = part.trim()
    if (!token) continue
    const byLabel = DATA_SOURCE_BY_LABEL[token]
    if (byLabel && !out.includes(byLabel)) {
      out.push(byLabel)
      continue
    }
    if (Object.prototype.hasOwnProperty.call(DATA_SOURCE_LABELS, token) && !out.includes(/** @type {DataSourceType} */ (token))) {
      out.push(/** @type {DataSourceType} */ (token))
    }
  }
  return out
}

/**
 * 「来源」单元格 → 举措档位（source）解析（2026-11-24 拍板：来源列口径与「产品举措与进展」档名一致）。
 *
 * 解析规则（单值单元格整体匹配，不做多值拆分）：
 * - 档名（投诉/咨询、用后即评、API巡检、留观问题）→ 对应 source 档；
 * - 旧枚举标签（投诉工单、咨询工单）→ 投诉/咨询 档（ticket）；
 * - 旧枚举标签「用后即评」既是档名也是数据源标签，两者同档不冲突；
 * - 其他内容（用户调研、其他、未知文本）→ 不指定档位，落默认投诉/咨询档（后端归一）。
 *
 * 注意：与 parseLinkedDataSourcesCell（多值拆分、写 linkedDataSources）职责不同——
 * 本函数只决定举措归属档位；「来源」列同时写入 linkedDataSources 保持数据源语义
 * （工单关联后自动补齐/筛选依赖），两者并存。
 *
 * @param {string} text
 * @returns {import('../domain/actionItem.js').ActionItem['source']}
 */
export function parseActionItemSourceCell(text) {
  const token = String(text ?? '').trim()
  if (!token) return 'ticket'
  if (token === ACTION_ITEM_SOURCE_LABELS.post_use) return 'post_use'
  if (token === ACTION_ITEM_SOURCE_LABELS.api_patrol) return 'api_patrol'
  if (token === ACTION_ITEM_SOURCE_LABELS.observation) return 'observation'
  if (token === ACTION_ITEM_SOURCE_LABELS.ticket) return 'ticket'
  // 旧枚举标签 → 投诉/咨询档（2026-11-24 拍板）
  if (token === DATA_SOURCE_BY_LABEL.complaint_ticket || token === DATA_SOURCE_BY_LABEL.consultation_ticket) {
    return 'ticket'
  }
  return 'ticket'
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} header
 */
function cell(row, header) {
  const value = row[header]
  if (value == null) return ''
  return String(value).trim()
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} headers
 */
function cellAny(row, headers) {
  for (const header of headers) {
    const value = cell(row, header)
    if (value) return value
  }
  return ''
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ productNameToKey?: Map<string, string>; firstProposedAt?: string }} [options]
 * @returns {{ ok: true; item: Partial<ActionItem>; warnings?: string[] } | { ok: false; error: string }}
 */
export function parseActionItemImportRow(row, options = {}) {
  const content = cell(row, '举措')
  if (!content) return { ok: false, error: '缺少举措内容' }

  const productName = cell(row, '产品名称')
  const productKeyFromMap = productName ? options.productNameToKey?.get(productName) : undefined

  const linkedTicketIds = parseLinkedTicketIdsCell(cellAny(row, LINKED_TICKET_HEADERS))
  const linkedRequirementTicketIds = parseLinkedTicketIdsCell(
    cellAny(row, LINKED_REQUIREMENT_TICKET_HEADERS),
  )
  const requirementLinked = linkedRequirementTicketIds.length > 0

  // 排期取原生值（不走 cell() 的 String 转换）——cellDates 模式下真日期单元格是 Date 对象，
  // String() 会变成 "Wed Sep 30 2026..." 导致归一函数 Date 分支接不到。
  const scheduleRaw = /** @type {string | Date | undefined} */ (row['排期时间'])
  const statusLabel = cell(row, '状态')
  /** @type {string[]} */
  const warnings = []

  // 排期写法归一（11-25 拍板）：2026.9.30 / 2026/09/30 / 2026年9月30日 等统一转 YYYY-MM-DD，
  // 识别不了保持原样（自由文本语义）；真日期单元格（cellDates 的 Date）也在此转换。
  let scheduleAt = normalizeActionScheduleInput(scheduleRaw)
  /** @type {import('../domain/actionItem.js').ActionItemStatus | undefined} */
  let status
  if (requirementLinked) {
    if (String(scheduleRaw ?? '').trim()) warnings.push('已填需求工单，排期时间列已忽略')
    if (statusLabel) warnings.push('已填需求工单，状态列已忽略')
    scheduleAt = ''
    status = 'pending_evaluation'
  } else {
    status = STATUS_BY_LABEL[statusLabel]
    if (statusLabel && !status && isActionItemStatus(statusLabel)) {
      status = statusLabel
    }
    if (!status) {
      status = deriveActionItemStatusFromSchedule(scheduleAt)
    }
  }
  const linkedDataSources = parseLinkedDataSourcesCell(cell(row, '来源'))
  // 来源列口径（11-24 拍板）：与「产品举措与进展」档名一致，决定举措归属档位；
  // 旧枚举标签（投诉工单、咨询工单等）映射到对应档。linkedDataSources 保留原数据源语义不变。
  const source = parseActionItemSourceCell(cell(row, '来源'))

  const problemTypeSnapshot = cell(row, '问题类型')

  // 实际完成时间（11-25 拍板）：仅状态=已完成时采纳，其余状态填了即忽略并警告（与领域层口径一致）。
  // 真日期单元格同排期处理（cellDates 的 Date 对象走归一）。
  const completedRaw = /** @type {string | Date | undefined} */ (row['实际完成时间'])
  let completedAt = ''
  if (String(completedRaw ?? '').trim()) {
    completedAt = normalizeActionScheduleInput(completedRaw)
    if (status !== 'completed') {
      warnings.push('状态非「已完成」，实际完成时间列已忽略')
      completedAt = ''
    }
  }

  const validated = validateActionItemCreate({
    content,
    detail: cell(row, '举措详情'),
    productName,
    productKey: productKeyFromMap || '',
    painPointSnapshot: cell(row, '问题'),
    problemTypeSnapshot,
    scheduleAt,
    completedAt,
    status,
    source,
    linkedTicketIds,
    linkedRequirementTicketIds,
    linkedDataSources,
    firstProposedAt: options.firstProposedAt || new Date().toISOString().slice(0, 10),
  })

  if (!validated.ok) return validated
  return { ok: true, item: toActionItemCreateBody(validated.item), warnings }
}

/**
 * @typedef {Object} ActionItemImportWorkbookResult
 * @property {(Partial<ActionItem> & { _excelRow?: number; _matchId?: string })[]} rows - 可导入行（_excelRow=Excel 行号；_matchId=命中既有举措 id，由前端 upsert 分流时写入）
 * @property {{ row: number; error: string }[]} errors - 解析失败行（row=Excel 行号）
 * @property {{ row: number; message: string }[]} warnings - 解析提示（row=Excel 行号）
 * @property {{ createCount: number; updateCount: number }} [upsert] - 分流统计（前端比对后写入；预览展示用）
 */

/**
 * @param {ArrayBuffer} buffer
 * @param {{ productNameToKey?: Map<string, string>; firstProposedAt?: string }} [options]
 * @returns {ActionItemImportWorkbookResult}
 */
export function parseActionItemImportWorkbook(buffer, options = {}) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName =
    wb.SheetNames.find((name) => name === ACTION_ITEM_LIST_SHEET_NAME) || wb.SheetNames[0]
  if (!sheetName) {
    return { rows: [], errors: [{ row: 0, error: '文件中没有工作表' }], warnings: [] }
  }

  const rawRows = /** @type {Record<string, unknown>[]} */ (
    XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
  )

  /** @type {Partial<ActionItem>[]} */
  const rows = []
  /** @type {{ row: number; error: string }[]} */
  const errors = []
  /** @type {{ row: number; message: string }[]} */
  const warnings = []

  rawRows.forEach((row, index) => {
    const excelRow = index + 2
    const normalizedRow = normalizeActionItemImportRow(row)
    const hint = cell(normalizedRow, '提示')
    if (hint === '无数据') return
    const content = cell(normalizedRow, '举措')
    const productName = cell(normalizedRow, '产品名称')
    if (!content && !productName) return

    const parsed = parseActionItemImportRow(normalizedRow, options)
    if (!parsed.ok) {
      errors.push({ row: excelRow, error: parsed.error })
      return
    }
    for (const message of parsed.warnings || []) {
      warnings.push({ row: excelRow, message })
    }
    // 行号随行携带（_excelRow 元数据）：批量创建阶段失败时映射回 Excel 行号展示给用户。
    // 不进创建 body——toActionItemCreateBody 白名单裁剪后的附加字段，服务端 STRICT_OBJECT 也会拦。
    rows.push({ ...parsed.item, _excelRow: excelRow })
  })

  return { rows, errors, warnings }
}

/**
 * @param {{ name: string; key: string }[]} products
 */
export function buildProductNameToKeyMap(products) {
  /** @type {Map<string, string>} */
  const map = new Map()
  for (const product of products || []) {
    if (product.name) map.set(product.name, product.key)
  }
  return map
}

/**
 * 导入 upsert 判定键的内容归一（2026-11-25 拍板，含全半角/大小写折叠）：
 * NFKC（Ａ→A、０→0、（）→()、：→:、全角空格→空格、①→1）→ 小写 → 空白折叠。
 * NFKC+小写在全库 136 条实测零误合并；「举措」单元格文本专用。
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeActionItemContentKey(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/**
 * 构建导入 upsert 比对索引：键 = 归一内容 + 产品（productKey，空则回退 productName）。
 * 同键多条时保留 updatedAt 最新的为更新落点，duplicates 记录其余存量数（UI 明示待清理）。
 *
 * @param {(Partial<ActionItem> & { updatedAt?: string })[]} existingItems
 * @returns {{ index: Map<string, { id: string; updatedAt: string; duplicates: number }>; keyOf: (item: Partial<ActionItem>) => string }}
 */
export function buildActionItemUpsertIndex(existingItems) {
  /** @type {Map<string, { id: string; updatedAt: string }[]>} */
  const byKey = new Map()
  /**
   * @param {Partial<ActionItem>} item
   */
  const keyOf = (item) => {
    const product =
      String(item?.productKey ?? '').trim() || String(item?.productName ?? '').trim()
    return `${normalizeActionItemContentKey(item?.content ?? '')}::${product}`
  }
  for (const item of existingItems || []) {
    const key = keyOf(item)
    if (!key.startsWith('::') || key.length > 2) {
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push({
        id: String(item.id ?? ''),
        updatedAt: String(item.updatedAt ?? ''),
      })
    }
  }
  /** @type {Map<string, { id: string; updatedAt: string; duplicates: number }>} */
  const index = new Map()
  for (const [key, group] of byKey) {
    // updatedAt 最新一条为更新落点；同键多条时 duplicates 记其余存量（供 UI 提示）
    const sorted = [...group].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    index.set(key, { ...sorted[0], duplicates: group.length - 1 })
  }
  return { index, keyOf }
}
