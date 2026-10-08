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
  }
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
  if (!/^\d{4}-\d{2}$/.test(month)) return []
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

  if (!recordIds.length) return []

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

const BACKFILL_CHUNK = 200

/**
 * 启动后按 record id 幂等补齐索引。与导入并发时后写覆盖。
 * 分块 setImmediate，避免堵住启动。
 */
export function startSearchIndexBackfill() {
  if (!searchMode) return
  setImmediate(() => backfillSearchIndexChunk(null))
}

/**
 * @param {string | null} afterId
 */
function backfillSearchIndexChunk(afterId) {
  try {
    const db = getDb()
    const rows = afterId
      ? db
          .prepare(
            'SELECT id, payload FROM records WHERE id > ? ORDER BY id LIMIT ?',
          )
          .all(afterId, BACKFILL_CHUNK)
      : db.prepare('SELECT id, payload FROM records ORDER BY id LIMIT ?').all(BACKFILL_CHUNK)
    if (!rows.length) return
    const tx = db.transaction((items) => {
      for (const row of items) {
        try {
          upsertRecordIndex(JSON.parse(row.payload))
        } catch {
          /* 单条损坏不阻断补齐 */
        }
      }
    })
    tx(rows)
    const lastId = String(rows[rows.length - 1]?.id || '')
    if (lastId && rows.length === BACKFILL_CHUNK) {
      setImmediate(() => backfillSearchIndexChunk(lastId))
    }
  } catch (err) {
    console.warn(
      `[assistantSearchIndex] 后台补齐失败: ${err instanceof Error ? err.message : err}`,
    )
  }
}
