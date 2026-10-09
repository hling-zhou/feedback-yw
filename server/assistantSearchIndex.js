/**
 * AI 助手原文检索索引。
 *
 * 优先使用 SQLite FTS5 trigram 虚表做中文子串检索；当前 SQLite 未启用 fts5/trigram 时
 * 退化为按月份过滤的投影文本表 + LIKE 扫描。不引入向量库。
 *
 * 索引由 storageRepository 在写入/删除记录时同步维护（见 putRecord/putRecords/
 * replaceAllRecords/deleteRecord/clearImportedData），与服务端记录同一事务。
 */

import { getDb } from './db.js'

/** @type {'fts' | 'fallback' | null} */
let searchMode = null

const INDEXED_FIELDS = [
  { key: 'painPoint', column: 'pain_point', label: '痛点' },
  { key: 'customerRequest', column: 'customer_request', label: '客户请求' },
  { key: 'rootCause', column: 'root_cause', label: '问题原因' },
  { key: 'rawText', column: 'raw_text', label: '受理内容' },
  { key: 'handlingText', column: 'handling_text', label: '处理意见' },
  { key: 'commentText', column: 'comment_text', label: '评价内容' },
]

/**
 * 拼接单条记录的可检索正文（用于 fallback 表的 content 列）。
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function buildSearchContent(record) {
  return INDEXED_FIELDS.map((f) => String(record?.[f.key] ?? '').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * 启动时初始化索引表；幂等。优先尝试 FTS5 trigram，失败则建 fallback 表。
 * 在 schema 初始化之后调用。
 */
export function initSearchIndex() {
  const db = getDb()
  if (searchMode) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS records_search_ids (
      record_id TEXT PRIMARY KEY
    );
  `)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
        record_id UNINDEXED,
        data_source_type UNINDEXED,
        import_month UNINDEXED,
        pain_point,
        customer_request,
        root_cause,
        raw_text,
        handling_text,
        comment_text,
        tokenize = 'trigram'
      );
    `)
    // 探测 trigram 是否真的可用（部分发行版编译了 fts5 但未带 trigram tokenizer）
    db.prepare(
      `SELECT 1 FROM records_fts WHERE records_fts MATCH '探针探测' LIMIT 1`,
    ).get()
    searchMode = 'fts'
  } catch {
    searchMode = 'fallback'
    db.exec(`
      CREATE TABLE IF NOT EXISTS records_search (
        record_id TEXT PRIMARY KEY,
        data_source_type TEXT NOT NULL DEFAULT '',
        import_month TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_records_search_month
        ON records_search (import_month, data_source_type);
    `)
  }
}

/** @returns {'fts' | 'fallback'} */
export function getSearchMode() {
  return searchMode === 'fts' ? 'fts' : 'fallback'
}

/**
 * @param {{ id?: string } | null} record
 */
function resolveRecordId(record) {
  return String(record?.id ?? '').trim()
}

/**
 * 写入或更新单条记录的索引。必须在记录写入同一事务内调用。
 * @param {Record<string, unknown>} record
 */
export function upsertRecordIndex(record) {
  if (!searchMode) return
  const db = getDb()
  const recordId = resolveRecordId(record)
  if (!recordId) return
  const dataSourceType = String(record?.dataSourceType ?? '').trim()
  const importMonth = String(record?.importMonth ?? '').trim().slice(0, 7)

  if (searchMode === 'fts') {
    db.prepare('DELETE FROM records_fts WHERE record_id = ?').run(recordId)
    const values = INDEXED_FIELDS.map((f) => String(record?.[f.key] ?? ''))
    db.prepare(
      `INSERT INTO records_fts
        (record_id, data_source_type, import_month,
         pain_point, customer_request, root_cause, raw_text, handling_text, comment_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(recordId, dataSourceType, importMonth, ...values)
    markSearchIndexed(recordId)
  } else {
    const content = buildSearchContent(record)
    db.prepare(
      `INSERT INTO records_search (record_id, data_source_type, import_month, content)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(record_id) DO UPDATE SET
         data_source_type = excluded.data_source_type,
         import_month = excluded.import_month,
         content = excluded.content`,
    ).run(recordId, dataSourceType, importMonth, content)
    markSearchIndexed(recordId)
  }
}

/** @param {string} recordId */
function markSearchIndexed(recordId) {
  getDb().prepare('INSERT OR IGNORE INTO records_search_ids (record_id) VALUES (?)').run(recordId)
}

/**
 * 批量写入索引（事务内）。
 * @param {Array<Record<string, unknown>>} records
 */
export function upsertRecordIndexBatch(records) {
  if (!searchMode) return
  for (const record of records) upsertRecordIndex(record)
}

/**
 * 删除单条记录索引。
 * @param {string} recordId
 */
export function deleteRecordIndex(recordId) {
  if (!searchMode) return
  const id = String(recordId ?? '').trim()
  if (!id) return
  const db = getDb()
  if (searchMode === 'fts') {
    db.prepare('DELETE FROM records_fts WHERE record_id = ?').run(id)
  } else {
    db.prepare('DELETE FROM records_search WHERE record_id = ?').run(id)
  }
  db.prepare('DELETE FROM records_search_ids WHERE record_id = ?').run(id)
}

/** 清空全部索引（与清空导入数据同步）。 */
export function clearRecordIndex() {
  if (!searchMode) return
  const db = getDb()
  if (searchMode === 'fts') {
    db.prepare('DELETE FROM records_fts').run()
  } else {
    db.prepare('DELETE FROM records_search').run()
  }
  db.prepare('DELETE FROM records_search_ids').run()
}

/**
 * 把用户输入的检索词转成安全的 FTS5 短语查询（双引号包裹，内部双引号转义）。
 * @param {string} query
 * @returns {string}
 */
/**
 * 去掉 FTS 运算符和 LIKE 通配符，避免用户输入变成查询语法。
 * @param {string} query
 * @returns {string}
 */
export function sanitizeSearchQuery(query) {
  return String(query || '')
    .replace(/["'*()^:]+/g, ' ')
    .replace(/\b(?:AND|OR|NOT|NEAR)\b/gi, ' ')
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toFtsPhrase(query) {
  const cleaned = sanitizeSearchQuery(query).replace(/"/g, '""')
  return `"${cleaned}"`
}

/**
 * 在一条记录的已索引字段中定位命中字段并截取片段。
 * @param {Record<string, unknown>} record
 * @param {string} needle
 * @returns {{ field: string; snippet: string } | null}
 */
function locateMatch(record, needle) {
  const needleStr = String(needle || '').trim()
  if (!needleStr) return null
  for (const f of INDEXED_FIELDS) {
    const text = String(record?.[f.key] ?? '')
    const idx = text.indexOf(needleStr)
    if (idx >= 0) {
      const start = Math.max(0, idx - 60)
      const end = Math.min(text.length, idx + needleStr.length + 120)
      const prefix = start > 0 ? '…' : ''
      const suffix = end < text.length ? '…' : ''
      return { field: f.label, snippet: `${prefix}${text.slice(start, end)}${suffix}` }
    }
  }
  return null
}

/** 校验 YYYY-MM 形式。 */
function isValidMonth(value) {
  return /^\d{4}-\d{2}$/.test(String(value || '').trim().slice(0, 7))
}

/** 把年份展开成起止月份；非法返回 null。 */
function yearToRange(year) {
  const y = Number(String(year || '').trim())
  if (!Number.isInteger(y) || y < 2000 || y > 2999) return null
  return { from: `${y}-01`, to: `${y}-12` }
}

/** 把任意起止月份归一化为 YYYY-MM；from>to 返回 null。 */
function normalizeMonthRange(from, to) {
  const f = String(from || '').trim().slice(0, 7)
  const t = String(to || '').trim().slice(0, 7)
  if (!isValidMonth(f) || !isValidMonth(t)) return null
  if (f > t) return null
  return { from: f, to: t }
}

/** 计算两个 YYYY-MM 之间相隔的月份数（含两端）。 */
function monthSpanCount(from, to) {
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  return (toYear - fromYear) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1
}

/**
 * 按 recordId 列表解析命中字段与片段。
 * @param {string[]} recordIds
 * @param {string} needle
 * @returns {{ recordId: string; ticketId: string; product: string; dataSourceType: string; importMonth: string; matchedField: string; snippet: string }[]}
 */
function hydrateMatches(recordIds, needle) {
  if (!recordIds.length) return []
  const db = getDb()
  /** @type {{ recordId: string; ticketId: string; product: string; dataSourceType: string; importMonth: string; matchedField: string; snippet: string }[]} */
  const out = []
  const getRecord = db.prepare('SELECT payload FROM records WHERE id = ?')
  for (const recordId of recordIds) {
    const row = getRecord.get(recordId)
    if (!row?.payload) continue
    /** @type {Record<string, unknown>} */
    let record
    try {
      record = JSON.parse(row.payload)
    } catch {
      continue
    }
    const match = locateMatch(record, needle)
    out.push({
      recordId,
      ticketId: String(record.ticketId ?? '').trim(),
      product: String(record.product ?? '').trim(),
      dataSourceType: String(record.dataSourceType ?? '').trim(),
      importMonth: String(record.importMonth ?? '').trim(),
      matchedField: match?.field || '内容',
      snippet: match?.snippet || needle,
    })
  }
  return out
}

/**
 * 按月份 + 来源检索记录。
 * @param {{
 *   importMonth?: string
 *   dataSourceType?: string
 *   query: string
 *   limit?: number
 * }} params
 * @returns {{ recordId: string; ticketId: string; product: string; dataSourceType: string; importMonth: string; matchedField: string; snippet: string }[]}
 */
export function searchRecords({ importMonth, dataSourceType, query, limit = 15 }) {
  if (!searchMode) return []
  const needle = sanitizeSearchQuery(query)
  if (needle.length < 3) return []
  const month = String(importMonth || '').trim().slice(0, 7)
  if (!isValidMonth(month)) return []
  const source = String(dataSourceType || '').trim()
  const cap = Math.min(Math.max(Number(limit) || 15, 1), 15)

  const db = getDb()
  /** @type {string[]} */
  let recordIds = []

  if (searchMode === 'fts') {
    /** @type {string[]} */
    const clauses = ['records_fts MATCH ?', 'import_month = ?']
    /** @type {unknown[]} */
    const params = [toFtsPhrase(needle), month]
    if (source) {
      clauses.push('data_source_type = ?')
      params.push(source)
    }
    const rows = db
      .prepare(
        `SELECT record_id FROM records_fts WHERE ${clauses.join(' AND ')} LIMIT ?`,
      )
      .all(...params, cap)
    recordIds = rows.map((r) => String(r.record_id))
  } else {
    /** @type {string[]} */
    const clauses = ['content LIKE ?', 'import_month = ?']
    /** @type {unknown[]} */
    const params = [`%${needle}%`, month]
    if (source) {
      clauses.push('data_source_type = ?')
      params.push(source)
    }
    const rows = db
      .prepare(
        `SELECT record_id FROM records_search WHERE ${clauses.join(' AND ')} LIMIT ?`,
      )
      .all(...params, cap)
    recordIds = rows.map((r) => String(r.record_id))
  }

  return hydrateMatches(recordIds, needle)
}

/**
 * 按月份范围 + 来源检索，返回命中总数和最多 limit 条片段。
 * 范围最多 12 个月；超过返回 needNarrowerScope。
 * @param {{
 *   year?: string | number
 *   importMonthFrom?: string
 *   importMonthTo?: string
 *   dataSourceType?: string
 *   query: string
 *   limit?: number
 * }} params
 * @returns {{ total: number; results: ReturnType<typeof hydrateMatches>; truncated: boolean; needNarrowerScope?: true; error?: string }}
 */
export function searchRecordsRange({ year, importMonthFrom, importMonthTo, dataSourceType, query, limit = 20 }) {
  const needle = sanitizeSearchQuery(query)
  if (needle.length < 3) {
    return { total: 0, results: [], truncated: false, error: '检索词至少 3 个字符，请换更长的关键词' }
  }
  let range = null
  if (year != null && year !== '') {
    range = yearToRange(year)
  } else if (importMonthFrom || importMonthTo) {
    range = normalizeMonthRange(importMonthFrom, importMonthTo)
  }
  if (!range) {
    return { total: 0, results: [], truncated: false, needNarrowerScope: true, error: '请传入 year（YYYY）或起止月份 importMonthFrom/importMonthTo（YYYY-MM）' }
  }
  if (monthSpanCount(range.from, range.to) > 12) {
    return { total: 0, results: [], truncated: false, needNarrowerScope: true, error: '检索范围超过 12 个月，请缩小到一年以内' }
  }
  if (!searchMode) return { total: 0, results: [], truncated: false }
  const source = String(dataSourceType || '').trim()
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 20)

  const db = getDb()
  /** @type {string[]} */
  let recordIds = []
  let total = 0

  if (searchMode === 'fts') {
    /** @type {string[]} */
    const clauses = ['records_fts MATCH ?', 'import_month >= ?', 'import_month <= ?']
    /** @type {unknown[]} */
    const params = [toFtsPhrase(needle), range.from, range.to]
    if (source) {
      clauses.push('data_source_type = ?')
      params.push(source)
    }
    const where = clauses.join(' AND ')
    total = Number(db.prepare(`SELECT COUNT(*) AS n FROM records_fts WHERE ${where}`).get(...params).n || 0)
    const rows = db
      .prepare(`SELECT record_id FROM records_fts WHERE ${where} ORDER BY import_month DESC, rowid DESC LIMIT ?`)
      .all(...params, cap)
    recordIds = rows.map((r) => String(r.record_id))
  } else {
    /** @type {string[]} */
    const clauses = ['content LIKE ?', 'import_month >= ?', 'import_month <= ?']
    /** @type {unknown[]} */
    const params = [`%${needle}%`, range.from, range.to]
    if (source) {
      clauses.push('data_source_type = ?')
      params.push(source)
    }
    const where = clauses.join(' AND ')
    total = Number(db.prepare(`SELECT COUNT(*) AS n FROM records_search WHERE ${where}`).get(...params).n || 0)
    const rows = db
      .prepare(`SELECT record_id FROM records_search WHERE ${where} ORDER BY import_month DESC, record_id DESC LIMIT ?`)
      .all(...params, cap)
    recordIds = rows.map((r) => String(r.record_id))
  }

  const results = hydrateMatches(recordIds, needle)
  return { total, results, truncated: total > results.length }
}

/** 每批只索引很少几条：FTS trigram 写入是同步的，批次过大时会堵住登录和读接口。 */
const BACKFILL_CHUNK = 2
const SEED_CHUNK = 1000

/**
 * 启动后只补「尚未进入 records_search_ids」的记录。
 * 已有 FTS/fallback 索引会先把 id 抄进进度表，避免每次重启把全库重新分词。
 * 每批结束后 setImmediate，把事件循环让给登录和数据请求。
 */
export function startSearchIndexBackfill() {
  if (!searchMode) return
  setImmediate(() => {
    try {
      if (!hasUnindexedRecords()) {
        console.info('[assistantSearchIndex] 检索索引已齐全，跳过补齐')
        return
      }
      console.info('[assistantSearchIndex] 后台补齐检索索引')
      seedSearchIdsChunk(0, () => backfillSearchIndexChunk(''))
    } catch (err) {
      console.warn(
        `[assistantSearchIndex] 后台补齐失败: ${err instanceof Error ? err.message : err}`,
      )
    }
  })
}

function hasUnindexedRecords() {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM records r
       WHERE NOT EXISTS (
         SELECT 1 FROM records_search_ids s WHERE s.record_id = r.id
       )
       LIMIT 1`,
    )
    .get()
  return Boolean(row)
}

/**
 * 把已经写进 FTS / fallback 表的 record_id 记入进度表，重启后不再重做分词。
 * @param {number | string} afterCursor
 * @param {() => void} done
 */
function seedSearchIdsChunk(afterCursor, done) {
  const db = getDb()
  const rows =
    searchMode === 'fts'
      ? db
          .prepare(
            `SELECT rowid AS cursor, record_id FROM records_fts
             WHERE rowid > ? ORDER BY rowid LIMIT ?`,
          )
          .all(afterCursor, SEED_CHUNK)
      : db
          .prepare(
            `SELECT record_id AS cursor, record_id FROM records_search
             WHERE record_id > ? ORDER BY record_id LIMIT ?`,
          )
          .all(afterCursor, SEED_CHUNK)
  if (!rows.length) {
    done()
    return
  }
  const insert = db.prepare(
    'INSERT OR IGNORE INTO records_search_ids (record_id) VALUES (?)',
  )
  db.transaction((items) => {
    for (const row of items) insert.run(row.record_id)
  })(rows)
  const next = rows[rows.length - 1].cursor
  setImmediate(() => seedSearchIdsChunk(next, done))
}

/**
 * @param {string} afterId
 */
function backfillSearchIndexChunk(afterId) {
  try {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT r.id, r.payload FROM records r
         WHERE r.id > ?
           AND NOT EXISTS (
             SELECT 1 FROM records_search_ids s WHERE s.record_id = r.id
           )
         ORDER BY r.id
         LIMIT ?`,
      )
      .all(afterId, BACKFILL_CHUNK)
    if (!rows.length) {
      console.info('[assistantSearchIndex] 检索索引补齐完成')
      return
    }
    const tx = db.transaction((items) => {
      for (const row of items) {
        try {
          upsertRecordIndex(JSON.parse(row.payload))
        } catch {
          markSearchIndexed(String(row.id))
        }
      }
    })
    tx(rows)
    const lastId = String(rows[rows.length - 1]?.id || '')
    if (!lastId) return
    setImmediate(() => backfillSearchIndexChunk(lastId))
  } catch (err) {
    console.warn(
      `[assistantSearchIndex] 后台补齐失败: ${err instanceof Error ? err.message : err}`,
    )
  }
}
