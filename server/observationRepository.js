import { getDb } from './db.js'
import {
  buildObservationIssueFromInput,
  buildObservationLinkFromInput,
  normalizeObservationPayload,
} from '../src/domain/observationIssue.js'

/**
 * 留观问题 repository —— observation_issues / observation_issue_links 两表的唯一写入口。
 *
 * 设计约束（docs/DESIGN-20261031-1.md）：
 * - 计数/首末次出现为冗余列，links 为真源：任何 link 状态变更后**必须**在同一事务内
 *   调 refreshIssueAggregates 重算（本模块所有写路径已内建）；
 * - putLink 的 UNIQUE(issue_id, record_id) 冲突走 upsert 优先级矩阵：
 *   人工 confirmed 可覆盖 dismissed / pending_suggest；自动建议不覆盖任何人工决定；
 * - dismissed 不删除——否决记忆，防同组合重复弹建议；
 * - 本库未开启 PRAGMA foreign_keys，级联删除由 deleteIssue 事务内显式执行。
 */

const UPSERT_LINK_ERROR_CODE = 'OBSERVATION_LINK_CONFLICT'
const ISSUE_NOT_FOUND_CODE = 'OBSERVATION_ISSUE_NOT_FOUND'
const LINK_NOT_FOUND_CODE = 'OBSERVATION_LINK_NOT_FOUND'

/** @param {Record<string, unknown>} row */
function rowToIssue(row) {
  return {
    id: String(row.id || ''),
    productKey: String(row.product_key || ''),
    productName: String(row.product_name || ''),
    status: String(row.status || 'watching'),
    title: String(row.title || ''),
    summary: String(row.summary || ''),
    occurrenceCount: Number(row.occurrence_count || 0),
    firstSeenAt: String(row.first_seen_at || ''),
    lastSeenAt: String(row.last_seen_at || ''),
    payload: normalizeObservationPayload(JSON.parse(row.payload || '{}')),
    createdBy: String(row.created_by || ''),
    createdAt: String(row.created_at || ''),
  }
}

/** @param {Record<string, unknown>} row */
function rowToLink(row) {
  return {
    id: String(row.id || ''),
    issueId: String(row.issue_id || ''),
    recordId: String(row.record_id || ''),
    recordDataSource: String(row.record_data_source || ''),
    ticketId: String(row.ticket_id || ''),
    linkStatus: String(row.link_status || 'confirmed'),
    linkSource: String(row.link_source || 'manual'),
    matchConfidence: String(row.match_confidence || ''),
    matchReason: String(row.match_reason || ''),
    matchedExcerpt: String(row.matched_excerpt || ''),
    proposedAt: String(row.proposed_at || ''),
    reviewedBy: String(row.reviewed_by || ''),
    reviewedAt: String(row.reviewed_at || ''),
    createdAt: String(row.created_at || ''),
  }
}

/**
 * links 为真源重算冗余列：confirmed 计数 / 首末次出现 / 分源计数。
 * 必须在 issue 写事务内调用。
 * @param {string} issueId
 * @param {string[]} recordCreatedAtByIds - record_id -> createdAt 映射（可选，无则用 link.created_at 近似）
 */
function refreshIssueAggregatesWithin(db, issueId) {
  const rows = db
    .prepare(
      `SELECT created_at FROM observation_issue_links
       WHERE issue_id = ? AND link_status = 'confirmed'`,
    )
    .all(issueId)
  const times = rows.map((r) => String(r.created_at || '')).filter(Boolean).sort()
  db.prepare(
    `UPDATE observation_issues
     SET occurrence_count = ?, first_seen_at = ?, last_seen_at = ?
     WHERE id = ?`,
  ).run(rows.length, times[0] || '', times[times.length - 1] || '', issueId)
}

/**
 * 记录摘要批取（队列/清单联表用）：按 record_id 批量取 projection 字段。
 * @param {string[]} recordIds
 */
function fetchRecordStubs(recordIds) {
  const db = getDb()
  const stubs = new Map()
  const chunkSize = 500
  for (let i = 0; i < recordIds.length; i += chunkSize) {
    const chunk = recordIds.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT id, payload FROM records WHERE id IN (${placeholders})`,
      )
      .all(...chunk)
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload)
        stubs.set(String(row.id), {
          ticketId: String(payload?.ticketId || ''),
          product: String(payload?.product || payload?.productName || ''),
          painPoint: String(payload?.painPoint || ''),
          customerRequest: String(payload?.customerRequest || ''),
          dataSourceType: String(payload?.dataSourceType || ''),
          createdAt: String(payload?.createdAt || ''),
        })
      } catch {
        // 记录损坏时给空 stub，队列仍可显示 link 本体信息
        stubs.set(String(row.id), null)
      }
    }
  }
  return stubs
}

export const observationRepository = {
  /**
   * 清单（分页 + 筛选）。
   * @param {{ page?: number, pageSize?: number, productKey?: string, status?: string, sourceMix?: 'all'|'has_ticket'|'rating_only', keyword?: string }} filters
   */
  listIssues(filters = {}) {
    const db = getDb()
    const where = []
    /** @type {unknown[]} */
    const params = []
    if (filters.productKey) {
      where.push('product_key = ?')
      params.push(filters.productKey)
    }
    if (filters.status) {
      where.push('status = ?')
      params.push(filters.status)
    }
    if (filters.keyword) {
      where.push('(title LIKE ? OR summary LIKE ?)')
      const kw = `%${filters.keyword}%`
      params.push(kw, kw)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // 来源构成筛选需要 per-issue 分源计数：先聚合再过滤（先过滤后分页铁律）
    const havingSql =
      filters.sourceMix === 'has_ticket'
        ? `HAVING ticket_count > 0`
        : filters.sourceMix === 'rating_only'
          ? `HAVING ticket_count = 0 AND rating_count > 0`
          : ''

    const baseSql = `
      SELECT i.*, COUNT(l.id) AS link_total,
        SUM(CASE WHEN l.link_status = 'confirmed' AND l.record_data_source != 'post_use_rating' THEN 1 ELSE 0 END) AS ticket_count,
        SUM(CASE WHEN l.link_status = 'confirmed' AND l.record_data_source = 'post_use_rating' THEN 1 ELSE 0 END) AS rating_count
      FROM observation_issues i
      LEFT JOIN observation_issue_links l ON l.issue_id = i.id AND l.link_status = 'confirmed'
      ${whereSql}
      GROUP BY i.id
      ${havingSql}
    `
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM (${baseSql})`)
      .get(...params).n
    const page = Math.max(1, Number(filters.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize || 20)))
    const rows = db
      .prepare(`${baseSql} ORDER BY last_seen_at DESC, created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize)
    return {
      total,
      page,
      pageSize,
      issues: rows.map((row) => ({
        ...rowToIssue(row),
        ticketCount: Number(row.ticket_count || 0),
        ratingCount: Number(row.rating_count || 0),
      })),
    }
  },

  /**
   * @param {string} id
   * @returns {import('../src/domain/observationIssue.js').ObservationIssue | null}
   */
  getIssue(id) {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM observation_issues WHERE id = ?')
      .get(String(id || ''))
    return row ? rowToIssue(row) : null
  },

  /**
   * 新建 issue（可带首条 confirmed link）。构建器校验失败抛 Error（400 语义）。
   * @param {ReturnType<typeof buildObservationIssueFromInput>['issue'] & { payload?: unknown }} issueLike
   * @param {{ firstLink?: { recordId: string, recordDataSource: string, ticketId?: string }, actor?: { userId?: string, username?: string } }} [options]
   */
  putIssue(issueLike, options = {}) {
    const db = getDb()
    const { issue, errors } = buildObservationIssueFromInput({
      ...issueLike,
      createdBy: issueLike.createdBy || options.actor?.username || options.actor?.userId || '',
    })
    if (errors.length) {
      const err = new Error(errors.join('；'))
      err.code = 'OBSERVATION_VALIDATION'
      throw err
    }
    const firstLink = options.firstLink
    const write = db.transaction(() => {
      db.prepare(
        `INSERT INTO observation_issues
         (id, product_key, product_name, status, title, summary, occurrence_count,
          first_seen_at, last_seen_at, payload, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, '', '', ?, ?, ?)`,
      ).run(
        issue.id,
        issue.productKey,
        issue.productName,
        issue.status,
        issue.title,
        issue.summary,
        JSON.stringify(issue.payload || {}),
        issue.createdBy,
        issue.createdAt,
      )
      if (firstLink?.recordId) {
        const { link, errors: linkErrors } = buildObservationLinkFromInput({
          issueId: issue.id,
          recordId: firstLink.recordId,
          recordDataSource: firstLink.recordDataSource,
          ticketId: firstLink.ticketId,
          linkStatus: 'confirmed',
          linkSource: 'manual',
        })
        if (linkErrors.length) {
          const err = new Error(linkErrors.join('；'))
          err.code = 'OBSERVATION_VALIDATION'
          throw err
        }
        db.prepare(
          `INSERT INTO observation_issue_links
           (id, issue_id, record_id, record_data_source, ticket_id, link_status,
            link_source, match_confidence, match_reason, matched_excerpt,
            proposed_at, reviewed_by, reviewed_at, created_at)
           VALUES (?, ?, ?, ?, ?, 'confirmed', 'manual', '', '', '', ?, ?, ?, ?)`,
        ).run(
          link.id,
          link.issueId,
          link.recordId,
          link.recordDataSource,
          link.ticketId,
          issue.createdAt,
          issue.createdBy,
          issue.createdAt,
          issue.createdAt,
        )
        refreshIssueAggregatesWithin(db, issue.id)
      }
    })
    write()
    return this.getIssue(issue.id)
  },

  /**
   * 编辑 issue 本体（标题/描述/keywords/notes/状态）。
   * @param {string} id
   * @param {{ title?: string, summary?: string, status?: string, keywords?: string[], notes?: string }} patch
   */
  updateIssue(id, patch = {}) {
    const db = getDb()
    const existing = this.getIssue(id)
    if (!existing) {
      const err = new Error('留观问题不存在')
      err.code = ISSUE_NOT_FOUND_CODE
      throw err
    }
    const nextTitle = patch.title?.trim() ?? existing.title
    const nextSummary = patch.summary?.trim() ?? existing.summary
    if (!nextTitle) throw validationError('问题标题不能为空')
    if (!nextSummary) throw validationError('问题描述不能为空')
    const nextStatus = patch.status ?? existing.status
    const nextPayload = normalizeObservationPayload({
      keywords: patch.keywords ?? existing.payload?.keywords,
      notes: patch.notes ?? existing.payload?.notes,
      // 状态与 promotedTo 只能走各自专用路径，编辑不触碰
      promotedTo: existing.payload?.promotedTo,
    })
    db.prepare(
      `UPDATE observation_issues
       SET title = ?, summary = ?, status = ?, payload = ?
       WHERE id = ?`,
    ).run(nextTitle, nextSummary, nextStatus, JSON.stringify(nextPayload), id)
    return this.getIssue(id)
  },

  /**
   * 删除 issue：事务内显式级联（本库无 FK 强制）。
   * @param {string} id
   */
  deleteIssue(id) {
    const db = getDb()
    const write = db.transaction(() => {
      const links = db
        .prepare('DELETE FROM observation_issue_links WHERE issue_id = ?')
        .run(String(id || ''))
      const issue = db.prepare('DELETE FROM observation_issues WHERE id = ?').run(String(id || ''))
      if (issue.changes === 0) {
        const err = new Error('留观问题不存在')
        err.code = ISSUE_NOT_FOUND_CODE
        throw err
      }
      return { linksDeleted: links.changes }
    })
    return write()
  },

  /**
   * @param {string} issueId
   * @returns {import('../src/domain/observationIssue.js').ObservationIssueLink[]}
   */
  listLinksByIssue(issueId) {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT * FROM observation_issue_links WHERE issue_id = ?
         ORDER BY created_at DESC`,
      )
      .all(String(issueId || ''))
    return rows.map(rowToLink)
  },

  /**
   * 按记录取全部 link（含 pending 建议 / dismissed）——抽屉卡数据源。
   * @param {string} recordId
   */
  listLinksByRecord(recordId) {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT * FROM observation_issue_links WHERE record_id = ?
         ORDER BY created_at DESC`,
      )
      .all(String(recordId || ''))
    return rows.map(rowToLink)
  },

  /**
   * upsert link（优先级矩阵：人工 confirmed 可覆盖 dismissed/pending；自动建议不覆盖人工决定）。
   * @param {import('../src/domain/observationIssue.js').ObservationIssueLink} link
   * @param {{ actor?: { userId?: string, username?: string }, overrideDismissed?: boolean }} [options]
   * @returns {{ action: 'created' | 'upgraded' | 'skipped_conflict' | 'skipped_auto_vs_manual', link?: import('../src/domain/observationIssue.js').ObservationIssueLink }}
   */
  putLink(link, options = {}) {
    const db = getDb()
    if (!this.getIssue(link.issueId)) {
      const err = new Error('留观问题不存在')
      err.code = ISSUE_NOT_FOUND_CODE
      throw err
    }
    const existingRow = db
      .prepare('SELECT * FROM observation_issue_links WHERE issue_id = ? AND record_id = ?')
      .get(link.issueId, link.recordId)
    const isAuto =
      link.linkSource === 'auto_match' || link.linkSource === 'auto_anchor'
    const manualUpgrade = link.linkStatus === 'confirmed' && link.linkSource === 'manual'
    const overrideDismissed = options.overrideDismissed === true

    if (existingRow) {
      const existing = rowToLink(existingRow)
      // 优先级矩阵
      if (existing.linkStatus === 'confirmed') {
        return { action: 'skipped_conflict', link: existing }
      }
      if (isAuto && (existing.linkSource === 'manual' || existing.linkStatus === 'dismissed')) {
        // 自动建议不覆盖人工决定（confirmed/dismissed 均为人工终态）
        return { action: 'skipped_auto_vs_manual', link: existing }
      }
      if (existing.linkStatus === 'dismissed' && !manualUpgrade && !overrideDismissed) {
        return { action: 'skipped_conflict', link: existing }
      }
      if (existing.linkStatus === 'pending_suggest' && isAuto) {
        // 同组合 pending 已在队列，更新置信度与理由但状态不动
        db.prepare(
          `UPDATE observation_issue_links
           SET match_confidence = ?, match_reason = ?, matched_excerpt = ?, proposed_at = ?
           WHERE id = ?`,
        ).run(link.matchConfidence, link.matchReason, link.matchedExcerpt, link.proposedAt || link.createdAt, existing.id)
        return { action: 'upgraded', link: this.getLink(existing.id) }
      }
      // 人工 confirmed 覆盖 pending/dismissed（S1 兜底 / S3 推翻否决）
      const write = db.transaction(() => {
        db.prepare(
          `UPDATE observation_issue_links
           SET link_status = 'confirmed', link_source = 'manual',
               match_confidence = '', match_reason = '', matched_excerpt = '',
               reviewed_by = ?, reviewed_at = ?
           WHERE id = ?`,
        ).run(
          options.actor?.username || options.actor?.userId || '',
          new Date().toISOString(),
          existing.id,
        )
        refreshIssueAggregatesWithin(db, link.issueId)
      })
      write()
      return { action: 'upgraded', link: this.getLink(existing.id) }
    }

    const write = db.transaction(() => {
      db.prepare(
        `INSERT INTO observation_issue_links
         (id, issue_id, record_id, record_data_source, ticket_id, link_status,
          link_source, match_confidence, match_reason, matched_excerpt,
          proposed_at, reviewed_by, reviewed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        link.id,
        link.issueId,
        link.recordId,
        link.recordDataSource,
        link.ticketId,
        link.linkStatus,
        link.linkSource,
        link.matchConfidence,
        link.matchReason,
        link.matchedExcerpt,
        link.proposedAt,
        link.reviewedBy,
        link.reviewedAt,
        link.createdAt,
      )
      if (link.linkStatus === 'confirmed') {
        refreshIssueAggregatesWithin(db, link.issueId)
      }
    })
    write()
    return { action: 'created', link: this.getLink(link.id) }
  },

  /**
   * @param {string} linkId
   */
  getLink(linkId) {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM observation_issue_links WHERE id = ?')
      .get(String(linkId || ''))
    return row ? rowToLink(row) : null
  },

  /**
   * 解除关联（仅 confirmed 可解；pending 走 review，dismissed 无需解）。
   * @param {string} linkId
   */
  deleteLink(linkId) {
    const db = getDb()
    const existing = this.getLink(linkId)
    if (!existing) {
      const err = new Error('关联不存在')
      err.code = LINK_NOT_FOUND_CODE
      throw err
    }
    const write = db.transaction(() => {
      db.prepare('DELETE FROM observation_issue_links WHERE id = ?').run(linkId)
      refreshIssueAggregatesWithin(db, existing.issueId)
    })
    write()
    return { deleted: true, link: existing }
  },

  /**
   * 待复核建议队列（联 issue 标题 + 记录摘要；先过滤后分页）。
   * @param {{ page?: number, pageSize?: number, confidence?: string }} filters
   */
  listPendingSuggestions(filters = {}) {
    const db = getDb()
    const where = ["l.link_status = 'pending_suggest'"]
    /** @type {unknown[]} */
    const params = []
    if (filters.confidence) {
      where.push('l.match_confidence = ?')
      params.push(filters.confidence)
    }
    const whereSql = where.join(' AND ')
    const total = db
      .prepare(
        `SELECT COUNT(*) AS n FROM observation_issue_links l WHERE ${whereSql}`,
      )
      .get(...params).n
    const page = Math.max(1, Number(filters.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize || 20)))
    const rows = db
      .prepare(
        `SELECT l.*, i.title AS issue_title, i.product_name AS product_name
         FROM observation_issue_links l
         JOIN observation_issues i ON i.id = l.issue_id
         WHERE ${whereSql}
         ORDER BY l.proposed_at DESC, l.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize)
    const stubs = fetchRecordStubs(rows.map((r) => String(r.record_id)))
    return {
      total,
      page,
      pageSize,
      suggestions: rows.map((row) => {
        const link = rowToLink(row)
        return {
          ...link,
          issueTitle: String(row.issue_title || ''),
          productName: String(row.product_name || ''),
          record: stubs.get(link.recordId) || null,
        }
      }),
    }
  },

  /**
   * pending-count breakdown（横幅用）。
   */
  pendingCount() {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT match_confidence, COUNT(*) AS n
         FROM observation_issue_links
         WHERE link_status = 'pending_suggest'
         GROUP BY match_confidence`,
      )
      .all()
    /** @type {{ total: number, high: number, medium: number, low: number }} */
    const breakdown = { total: 0, high: 0, medium: 0, low: 0 }
    for (const row of rows) {
      const n = Number(row.n || 0)
      breakdown.total += n
      const key = String(row.match_confidence || 'low')
      if (key === 'high' || key === 'medium' || key === 'low') breakdown[key] += n
      else breakdown.low += n
    }
    return breakdown
  },

  /**
   * 三选一复核（confirm / dismiss / new_issue）。
   * confirm：pending → confirmed + 计数刷新；
   * dismiss：pending → dismissed（否决记忆）；
   * new_issue：pending 行转 dismissed（superseded 语义），并新建 issue + confirmed link。
   * @param {string} linkId
   * @param {'confirm' | 'dismiss' | 'new_issue'} action
   * @param {{ newIssue?: { title: string, summary: string, productKey: string, productName: string, keywords?: string[], notes?: string }, actor?: { userId?: string, username?: string } }} [options]
   */
  reviewSuggestion(linkId, action, options = {}) {
    const db = getDb()
    const link = this.getLink(linkId)
    if (!link) {
      const err = new Error('建议不存在')
      err.code = LINK_NOT_FOUND_CODE
      throw err
    }
    if (link.linkStatus !== 'pending_suggest') {
      const err = new Error('该建议已被处理')
      err.code = UPSERT_LINK_ERROR_CODE
      throw err
    }
    const actorLabel = options.actor?.username || options.actor?.userId || ''
    const now = new Date().toISOString()

    if (action === 'confirm') {
      const write = db.transaction(() => {
        db.prepare(
          `UPDATE observation_issue_links
           SET link_status = 'confirmed', link_source = 'manual',
               match_confidence = '', match_reason = '', matched_excerpt = '',
               reviewed_by = ?, reviewed_at = ?
           WHERE id = ?`,
        ).run(actorLabel, now, linkId)
        refreshIssueAggregatesWithin(db, link.issueId)
      })
      write()
      return { action: 'confirmed', link: this.getLink(linkId) }
    }

    if (action === 'dismiss') {
      db.prepare(
        `UPDATE observation_issue_links
         SET link_status = 'dismissed', reviewed_by = ?, reviewed_at = ?
         WHERE id = ?`,
      ).run(actorLabel, now, linkId)
      return { action: 'dismissed', link: this.getLink(linkId) }
    }

    // new_issue：原建议作废 + 新建 issue 挂同记录
    const newIssueInput = options.newIssue
    if (!newIssueInput) {
      throw validationError('action=new_issue 必须携带 newIssue')
    }
    const write = db.transaction(() => {
      db.prepare(
        `UPDATE observation_issue_links
         SET link_status = 'dismissed', reviewed_by = ?, reviewed_at = ?
         WHERE id = ?`,
      ).run(actorLabel, now, linkId)
    })
    write()
    const issue = this.putIssue(
      {
        ...newIssueInput,
        createdBy: actorLabel,
      },
      {
        firstLink: {
          recordId: link.recordId,
          recordDataSource: link.recordDataSource || 'complaint_ticket',
          ticketId: link.ticketId,
        },
        actor: options.actor,
      },
    )
    return { action: 'new_issue', issue, link: this.getLink(linkId) }
  },

  /**
   * 人工兜底搜记录：按 ticket_id / 评价文本关键词搜可挂记录（同产品优先）。
   * @param {{ query: string, productKey?: string, limit?: number }} params
   */
  searchRecordsForAttach({ query, productKey, limit = 20 }) {
    const db = getDb()
    const q = String(query || '').trim()
    if (!q) return []
    const cappedLimit = Math.min(50, Math.max(1, Number(limit || 20)))
    // ticket_id 精确 + payload 文本 LIKE（payload 文档式存储，两段式查询）
    const rows = db
      .prepare(
        `SELECT id, payload FROM records
         WHERE ticket_id = ? OR payload LIKE ?
         ORDER BY import_month DESC, id DESC
         LIMIT ?`,
      )
      .all(q, `%${q}%`, cappedLimit * 3)
    /** @type {Array<{ recordId: string, ticketId: string, productKey: string, productName: string, dataSourceType: string, summary: string, createdAt: string, sameProduct: boolean }>} */
    const out = []
    const linked = new Set(
      db
        .prepare(
          `SELECT record_id FROM observation_issue_links
           WHERE link_status = 'confirmed'`,
        )
        .all()
        .map((r) => String(r.record_id)),
    )
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload)
        const recKey = String(payload?.productKey || '')
        const summarySource =
          String(payload?.painPoint || '') ||
          String(payload?.customerRequest || '') ||
          String(payload?.rawText || '') ||
          String(payload?.commentText || '')
        out.push({
          recordId: String(row.id),
          ticketId: String(payload?.ticketId || ''),
          productKey: recKey,
          productName: String(payload?.product || payload?.productName || ''),
          dataSourceType: String(payload?.dataSourceType || ''),
          summary: summarySource.slice(0, 120),
          createdAt: String(payload?.createdAt || ''),
          sameProduct: !productKey || recKey === productKey,
          alreadyLinkedElsewhere: linked.has(String(row.id)),
        })
      } catch {
        // 跳过损坏行
      }
    }
    // 同产品优先排序后截断
    out.sort((a, b) => Number(b.sameProduct) - Number(a.sameProduct))
    return out.slice(0, cappedLimit)
  },
}

/** @param {string} message */
function validationError(message) {
  const err = new Error(message)
  err.code = 'OBSERVATION_VALIDATION'
  return err
}
