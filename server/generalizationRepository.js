import { getDb } from './db.js'
import {
  buildGeneralizationIssueFromInput,
  buildGeneralizationLinkFromInput,
  normalizeGeneralizationPayload,
} from '../src/domain/generalizationIssue.js'
import { GENERALIZATION_PROMPT_VERSION } from '../src/lib/generalization/generalizationPrompt.js'

/**
 * 举一反三问题 repository —— generalization_issues / generalization_issue_links /
 * generalization_hints / generalization_issue_action_refs 四表的唯一写入口。
 *
 * 设计约束（docs/DESIGN-20261102-1.md）：
 * - 计数/首末次出现为冗余列，links 为真源：任何 link 状态变更后**必须**在同一事务内
 *   调 refreshIssueAggregates 重算（本模块所有写路径已内建）；
 * - putLink 的 UNIQUE(issue_id, record_id) 冲突走 upsert 优先级矩阵（同观察语义）：
 *   人工 confirmed 可覆盖 dismissed / pending_suggest；自动建议不覆盖任何人工决定；
 * - dismissed 不删除——否决记忆，防同组合重复弹建议；
 * - root_cause/optimization：创建可空，PATCH 出现即必填非空（v3.4 防清空绕过）；
 * - 升级通路反链走 action_refs 中间表（多对一）；origin_action_id 仅记首创建举措；
 * - 本库未开启 PRAGMA foreign_keys，级联删除由 deleteIssue 事务内显式执行。
 */

const UPSERT_LINK_ERROR_CODE = 'GENERALIZATION_LINK_CONFLICT'
const ISSUE_NOT_FOUND_CODE = 'GENERALIZATION_ISSUE_NOT_FOUND'
const LINK_NOT_FOUND_CODE = 'GENERALIZATION_LINK_NOT_FOUND'
const VALIDATION_CODE = 'GENERALIZATION_VALIDATION'

/** @param {string} message */
function validationError(message) {
  const err = new Error(message)
  err.code = VALIDATION_CODE
  return err
}

/** @param {Record<string, unknown>} row */
function rowToIssue(row) {
  return {
    id: String(row.id || ''),
    productKey: String(row.product_key || ''),
    productName: String(row.product_name || ''),
    status: String(row.status || 'in_progress'),
    title: String(row.title || ''),
    summary: String(row.summary || ''),
    category: String(row.category || ''),
    scope: String(row.scope || ''),
    rootCause: String(row.root_cause || ''),
    optimization: String(row.optimization || ''),
    originActionId: String(row.origin_action_id || ''),
    occurrenceCount: Number(row.occurrence_count || 0),
    firstSeenAt: String(row.first_seen_at || ''),
    lastSeenAt: String(row.last_seen_at || ''),
    payload: normalizeGeneralizationPayload(JSON.parse(row.payload || '{}')),
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
 * links 为真源重算冗余列（confirmed 计数 / 首末次出现）。必须在 issue 写事务内调用。
 * @param {import('better-sqlite3').Database} db
 * @param {string} issueId
 */
function refreshIssueAggregatesWithin(db, issueId) {
  const rows = db
    .prepare(
      `SELECT created_at FROM generalization_issue_links
       WHERE issue_id = ? AND link_status = 'confirmed'`,
    )
    .all(issueId)
  const times = rows.map((r) => String(r.created_at || '')).filter(Boolean).sort()
  db.prepare(
    `UPDATE generalization_issues
     SET occurrence_count = ?, first_seen_at = ?, last_seen_at = ?
     WHERE id = ?`,
  ).run(rows.length, times[0] || '', times[times.length - 1] || '', issueId)
}

/**
 * 记录摘要批取（队列/清单联表用）。同观察实现：损坏行给 null stub。
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
      .prepare(`SELECT id, payload FROM records WHERE id IN (${placeholders})`)
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
        stubs.set(String(row.id), null)
      }
    }
  }
  return stubs
}

export const generalizationRepository = {
  /**
   * 清单（分页 + 筛选 + actionItemId 反查走中间表 JOIN；先过滤后分页铁律）。
   * @param {{ page?: number, pageSize?: number, productKey?: string, status?: string, category?: string, scope?: string, keyword?: string, actionItemId?: string }} filters
   */
  listIssues(filters = {}) {
    const db = getDb()
    const where = []
    /** @type {unknown[]} */
    const params = []
    if (filters.productKey) {
      where.push('i.product_key = ?')
      params.push(filters.productKey)
    }
    if (filters.status) {
      where.push('i.status = ?')
      params.push(filters.status)
    }
    if (filters.category) {
      where.push('i.category = ?')
      params.push(filters.category)
    }
    if (filters.scope) {
      where.push('i.scope = ?')
      params.push(filters.scope)
    }
    if (filters.keyword) {
      where.push('(i.title LIKE ? OR i.summary LIKE ?)')
      const kw = `%${filters.keyword}%`
      params.push(kw, kw)
    }
    if (filters.actionItemId) {
      where.push(
        `i.id IN (SELECT issue_id FROM generalization_issue_action_refs WHERE action_item_id = ?)`,
      )
      params.push(filters.actionItemId)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const baseSql = `
      SELECT i.*, COUNT(l.id) AS link_total,
        SUM(CASE WHEN l.link_status = 'confirmed' AND l.record_data_source != 'post_use_rating' THEN 1 ELSE 0 END) AS ticket_count,
        SUM(CASE WHEN l.link_status = 'confirmed' AND l.record_data_source = 'post_use_rating' THEN 1 ELSE 0 END) AS rating_count
      FROM generalization_issues i
      LEFT JOIN generalization_issue_links l ON l.issue_id = i.id AND l.link_status = 'confirmed'
      ${whereSql}
      GROUP BY i.id
    `
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM (${baseSql})`)
      .get(...params).n
    const page = Math.max(1, Number(filters.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize || 20)))
    const rows = db
      .prepare(`${baseSql} ORDER BY i.last_seen_at DESC, i.created_at DESC LIMIT ? OFFSET ?`)
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
   * @returns {import('../src/domain/generalizationIssue.js').GeneralizationIssue | null}
   */
  getIssue(id) {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM generalization_issues WHERE id = ?')
      .get(String(id || ''))
    return row ? rowToIssue(row) : null
  },

  /**
   * 新建 issue（可带首条 confirmed link）。构建器校验失败抛 Error（400 语义）。
   * root_cause/optimization 创建可空（v3.4）——补全在 Tab 侧滑 PATCH。
   * @param {ReturnType<typeof buildGeneralizationIssueFromInput>['issue'] & { payload?: unknown }} issueLike
   * @param {{ firstLink?: { recordId: string, recordDataSource: string, ticketId?: string }, actor?: { userId?: string, username?: string } }} [options]
   */
  putIssue(issueLike, options = {}) {
    const db = getDb()
    const { issue, errors } = buildGeneralizationIssueFromInput({
      ...issueLike,
      createdBy: issueLike.createdBy || options.actor?.username || options.actor?.userId || '',
    })
    if (errors.length) {
      throw validationError(errors.join('；'))
    }
    const firstLink = options.firstLink
    const write = db.transaction(() => {
      db.prepare(
        `INSERT INTO generalization_issues
         (id, product_key, product_name, status, title, summary, category, scope,
          root_cause, optimization, origin_action_id, occurrence_count,
          first_seen_at, last_seen_at, payload, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', ?, ?, ?)`,
      ).run(
        issue.id,
        issue.productKey,
        issue.productName,
        issue.status,
        issue.title,
        issue.summary,
        issue.category,
        issue.scope,
        issue.rootCause,
        issue.optimization,
        issue.originActionId,
        JSON.stringify(issue.payload || {}),
        issue.createdBy,
        issue.createdAt,
      )
      if (firstLink?.recordId) {
        const { link, errors: linkErrors } = buildGeneralizationLinkFromInput({
          issueId: issue.id,
          recordId: firstLink.recordId,
          recordDataSource: firstLink.recordDataSource,
          ticketId: firstLink.ticketId,
          linkStatus: 'confirmed',
          linkSource: 'manual',
        })
        if (linkErrors.length) {
          throw validationError(linkErrors.join('；'))
        }
        db.prepare(
          `INSERT INTO generalization_issue_links
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
   * 编辑 issue 本体。v3.4 守卫：root_cause/optimization 出现在 patch 中时必填非空
   * （创建可空、编辑必填——防"先填后清空"绕过；字段缺席则保持原值）。
   * @param {string} id
   * @param {{ title?: string, summary?: string, category?: string, scope?: string, rootCause?: string, optimization?: string, status?: string, keywords?: string[], notes?: string }} patch
   */
  updateIssue(id, patch = {}) {
    const db = getDb()
    const existing = this.getIssue(id)
    if (!existing) {
      const err = new Error('举一反三问题不存在')
      err.code = ISSUE_NOT_FOUND_CODE
      throw err
    }
    const nextTitle = patch.title?.trim() ?? existing.title
    const nextSummary = patch.summary?.trim() ?? existing.summary
    if (!nextTitle) throw validationError('问题标题不能为空')
    if (!nextSummary) throw validationError('问题描述不能为空')
    const nextCategory = patch.category?.trim() ?? existing.category
    const nextScope = patch.scope?.trim() ?? existing.scope
    if (!nextCategory) throw validationError('可介入原因范畴不能为空')
    if (!nextScope) throw validationError('共性范围不能为空')
    const nextStatus = patch.status ?? existing.status
    // v3.4 核心：内容字段出现在 patch 中时必填非空（防"先填后清空"绕过）。
    // 豁免：纯状态流转（仅 status 变更、内容字段全部缺席）——关闭一个从未补全的
    // in_progress 问题是合法操作（"排查完成/放弃"语义不强迫先补文档），字段缺席保持原值。
    const contentPatch =
      patch.rootCause !== undefined ||
      patch.optimization !== undefined ||
      patch.title !== undefined ||
      patch.summary !== undefined ||
      patch.category !== undefined ||
      patch.scope !== undefined
    const nextRootCause = patch.rootCause?.trim() ?? existing.rootCause
    const nextOptimization = patch.optimization?.trim() ?? existing.optimization
    if (contentPatch) {
      if (!nextRootCause) throw validationError('根因分析不能为空（编辑时必填，创建时可空；纯状态流转不受限）')
      if (!nextOptimization) throw validationError('优化方案不能为空（编辑时必填，创建时可空；纯状态流转不受限）')
    }
    const nextPayload = normalizeGeneralizationPayload({
      keywords: patch.keywords ?? existing.payload?.keywords,
      notes: patch.notes ?? existing.payload?.notes,
    })
    db.prepare(
      `UPDATE generalization_issues
       SET title = ?, summary = ?, category = ?, scope = ?, root_cause = ?,
           optimization = ?, status = ?, payload = ?
       WHERE id = ?`,
    ).run(
      nextTitle,
      nextSummary,
      nextCategory,
      nextScope,
      nextRootCause,
      nextOptimization,
      nextStatus,
      JSON.stringify(nextPayload),
      id,
    )
    return this.getIssue(id)
  },

  /**
   * 删除 issue：事务内显式级联（links + action_refs；hint 不动——record 级建议与 issue 无关）。
   * @param {string} id
   */
  deleteIssue(id) {
    const db = getDb()
    const write = db.transaction(() => {
      const links = db
        .prepare('DELETE FROM generalization_issue_links WHERE issue_id = ?')
        .run(String(id || ''))
      const refs = db
        .prepare('DELETE FROM generalization_issue_action_refs WHERE issue_id = ?')
        .run(String(id || ''))
      const issue = db
        .prepare('DELETE FROM generalization_issues WHERE id = ?')
        .run(String(id || ''))
      if (issue.changes === 0) {
        const err = new Error('举一反三问题不存在')
        err.code = ISSUE_NOT_FOUND_CODE
        throw err
      }
      return { linksDeleted: links.changes, actionRefsDeleted: refs.changes }
    })
    return write()
  },

  /**
   * @param {string} issueId
   * @returns {import('../src/domain/generalizationIssue.js').GeneralizationIssueLink[]}
   */
  listLinksByIssue(issueId) {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT * FROM generalization_issue_links WHERE issue_id = ?
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
        `SELECT * FROM generalization_issue_links WHERE record_id = ?
         ORDER BY created_at DESC`,
      )
      .all(String(recordId || ''))
    return rows.map(rowToLink)
  },

  /**
   * upsert link（优先级矩阵：同观察语义）。
   * @param {import('../src/domain/generalizationIssue.js').GeneralizationIssueLink} link
   * @param {{ actor?: { userId?: string, username?: string }, overrideDismissed?: boolean }} [options]
   * @returns {{ action: 'created' | 'upgraded' | 'skipped_conflict' | 'skipped_auto_vs_manual', link?: import('../src/domain/generalizationIssue.js').GeneralizationIssueLink }}
   */
  putLink(link, options = {}) {
    const db = getDb()
    if (!this.getIssue(link.issueId)) {
      const err = new Error('举一反三问题不存在')
      err.code = ISSUE_NOT_FOUND_CODE
      throw err
    }
    const existingRow = db
      .prepare(
        'SELECT * FROM generalization_issue_links WHERE issue_id = ? AND record_id = ?',
      )
      .get(link.issueId, link.recordId)
    const isAuto =
      link.linkSource === 'auto_match' || link.linkSource === 'auto_anchor'
    const manualUpgrade = link.linkStatus === 'confirmed' && link.linkSource === 'manual'
    const overrideDismissed = options.overrideDismissed === true

    if (existingRow) {
      const existing = rowToLink(existingRow)
      if (existing.linkStatus === 'confirmed') {
        return { action: 'skipped_conflict', link: existing }
      }
      if (isAuto && (existing.linkSource === 'manual' || existing.linkStatus === 'dismissed')) {
        return { action: 'skipped_auto_vs_manual', link: existing }
      }
      if (existing.linkStatus === 'dismissed' && !manualUpgrade && !overrideDismissed) {
        return { action: 'skipped_conflict', link: existing }
      }
      if (existing.linkStatus === 'pending_suggest' && isAuto) {
        db.prepare(
          `UPDATE generalization_issue_links
           SET match_confidence = ?, match_reason = ?, matched_excerpt = ?, proposed_at = ?
           WHERE id = ?`,
        ).run(
          link.matchConfidence,
          link.matchReason,
          link.matchedExcerpt,
          link.proposedAt || link.createdAt,
          existing.id,
        )
        return { action: 'upgraded', link: this.getLink(existing.id) }
      }
      const write = db.transaction(() => {
        db.prepare(
          `UPDATE generalization_issue_links
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
        `INSERT INTO generalization_issue_links
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
      .prepare('SELECT * FROM generalization_issue_links WHERE id = ?')
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
      db.prepare('DELETE FROM generalization_issue_links WHERE id = ?').run(linkId)
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
      .prepare(`SELECT COUNT(*) AS n FROM generalization_issue_links l WHERE ${whereSql}`)
      .get(...params).n
    const page = Math.max(1, Number(filters.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize || 20)))
    const rows = db
      .prepare(
        `SELECT l.*, i.title AS issue_title, i.product_name AS product_name
         FROM generalization_issue_links l
         JOIN generalization_issues i ON i.id = l.issue_id
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
   * v3.3 G2-5：hints 字段 = pending 态 AI 建议（G-pass）计数——合并横幅第一行数据源。
   */
  pendingCount() {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT match_confidence, COUNT(*) AS n
         FROM generalization_issue_links
         WHERE link_status = 'pending_suggest'
         GROUP BY match_confidence`,
      )
      .all()
    /** @type {{ total: number, high: number, medium: number, low: number, hints: number, hintsHigh: number, hintsMedium: number }} */
    const breakdown = { total: 0, high: 0, medium: 0, low: 0, hints: 0, hintsHigh: 0, hintsMedium: 0 }
    for (const row of rows) {
      const n = Number(row.n || 0)
      breakdown.total += n
      const key = String(row.match_confidence || 'low')
      if (key === 'high' || key === 'medium' || key === 'low') breakdown[key] += n
      else breakdown.low += n
    }
    // G-pass pending hints（payload JSON：status='pending' + confidence 分桶——SQLite 无 JSON 函数，全量小表内存过滤）
    // G4-2：promptVersion ≠ 当前版本的 pending 计 hintsOutdated（重判工具探测口径）
    const hintRows = db.prepare('SELECT payload FROM generalization_hints').all()
    for (const row of hintRows) {
      try {
        const hint = JSON.parse(String(row.payload || '{}'))
        if (String(hint?.status || '') !== 'pending') continue
        breakdown.hints += 1
        const conf = String(hint?.confidence || 'low')
        if (conf === 'high') breakdown.hintsHigh += 1
        else if (conf === 'medium') breakdown.hintsMedium += 1
        if (String(hint?.promptVersion || '') !== GENERALIZATION_PROMPT_VERSION) {
          breakdown.hintsOutdated = (breakdown.hintsOutdated || 0) + 1
        }
      } catch {
        // 损坏行跳过
      }
    }
    return breakdown
  },

  /**
   * 三选一复核（confirm / dismiss / new_issue）——同观察语义。
   * new_issue：pending 行转 dismissed（superseded），并新建 issue（category/scope 必填）+ confirmed link。
   * @param {string} linkId
   * @param {'confirm' | 'dismiss' | 'new_issue'} action
   * @param {{ newIssue?: { title: string, summary: string, productKey: string, productName: string, category: string, scope: string, keywords?: string[], notes?: string }, actor?: { userId?: string, username?: string } }} [options]
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
          `UPDATE generalization_issue_links
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
        `UPDATE generalization_issue_links
         SET link_status = 'dismissed', reviewed_by = ?, reviewed_at = ?
         WHERE id = ?`,
      ).run(actorLabel, now, linkId)
      return { action: 'dismissed', link: this.getLink(linkId) }
    }

    const newIssueInput = options.newIssue
    if (!newIssueInput) {
      throw validationError('action=new_issue 必须携带 newIssue')
    }
    const write = db.transaction(() => {
      db.prepare(
        `UPDATE generalization_issue_links
         SET link_status = 'dismissed', reviewed_by = ?, reviewed_at = ?
         WHERE id = ?`,
      ).run(actorLabel, now, linkId)
    })
    write()
    const issue = this.putIssue(
      { ...newIssueInput, createdBy: actorLabel },
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
   * 人工兜底搜记录（同产品优先；只搜投诉/咨询工单——举一反三证据域）。
   * @param {{ query: string, productKey?: string, limit?: number }} params
   */
  searchRecordsForAttach({ query, productKey, limit = 20 }) {
    const db = getDb()
    const q = String(query || '').trim()
    if (!q) return []
    const cappedLimit = Math.min(50, Math.max(1, Number(limit || 20)))
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
          `SELECT record_id FROM generalization_issue_links
           WHERE link_status = 'confirmed'`,
        )
        .all()
        .map((r) => String(r.record_id)),
    )
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload)
        // 举一反三证据域 = 投诉/咨询工单（评价不参与——设计 §0.4）
        const dsType = String(payload?.dataSourceType || '')
        if (dsType !== 'complaint_ticket' && dsType !== 'consultation_ticket') continue
        const recKey = String(payload?.productKey || '')
        const summarySource =
          String(payload?.painPoint || '') ||
          String(payload?.customerRequest || '') ||
          String(payload?.rawText || '')
        out.push({
          recordId: String(row.id),
          ticketId: String(payload?.ticketId || ''),
          productKey: recKey,
          productName: String(payload?.product || payload?.productName || ''),
          dataSourceType: dsType,
          summary: summarySource.slice(0, 120),
          createdAt: String(payload?.createdAt || ''),
          sameProduct: !productKey || recKey === productKey,
          alreadyLinkedElsewhere: linked.has(String(row.id)),
        })
      } catch {
        // 跳过损坏行
      }
    }
    out.sort((a, b) => Number(b.sameProduct) - Number(a.sameProduct))
    return out.slice(0, cappedLimit)
  },

  // ── 升级通路（from-action）· 设计 §4.1 / §5.3 ──

  /**
   * 举措已关联的举一反三问题（中间表反查——升级入口"已升级态"与 409 防重数据源）。
   * @param {string} actionItemId
   * @returns {{ issueId: string, kind: 'created' | 'linked', status: string, title: string }[]}
   */
  listIssuesForAction(actionItemId) {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT r.issue_id, r.kind, i.status, i.title
         FROM generalization_issue_action_refs r
         JOIN generalization_issues i ON i.id = r.issue_id
         WHERE r.action_item_id = ?
         ORDER BY r.created_at DESC`,
      )
      .all(String(actionItemId || ''))
    return rows.map((r) => ({
      issueId: String(r.issue_id),
      kind: /** @type {'created' | 'linked'} */ (String(r.kind || 'linked')),
      status: String(r.status || ''),
      title: String(r.title || ''),
    }))
  },

  /**
   * issue 的来源举措列表（详情侧滑"来源举措"区——中间表反查）。
   * @param {string} issueId
   */
  listActionRefsForIssue(issueId) {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT r.action_item_id, r.kind, r.created_at,
                a.product_name, a.payload AS action_payload
         FROM generalization_issue_action_refs r
         LEFT JOIN action_items a ON a.id = r.action_item_id
         WHERE r.issue_id = ?
         ORDER BY r.created_at DESC`,
      )
      .all(String(issueId || ''))
    return rows.map((r) => {
      /** @type {{ content?: string, status?: string }} */
      let actionPayload = {}
      try {
        actionPayload = JSON.parse(r.action_payload || '{}')
      } catch {
        actionPayload = {}
      }
      return {
        actionItemId: String(r.action_item_id || ''),
        kind: /** @type {'created' | 'linked'} */ (String(r.kind || 'linked')),
        createdAt: String(r.created_at || ''),
        // 举措被删时 LEFT JOIN 为空——实时解析不快照（v3.1 决策），前端降级"来源举措已删除"
        actionExists: Boolean(r.action_item_id) && r.action_payload !== null && r.action_payload !== undefined,
        actionTitle: String(actionPayload?.content || ''),
        actionStatus: String(actionPayload?.status || ''),
        actionProductName: String(r.product_name || ''),
      }
    })
  },

  /**
   * 举措升级事务（from-action mode=create）：
   * 新建 issue（origin_action_id + 仅 optimization 预填——23:39 定稿）+ 证据全量挂 confirmed
   * （dataSourceType 过滤只取投诉/咨询）+ 中间表 kind=created + 计数初始化。
   *
   * 防重（00:07 定稿）：所有举措（无论自身终态）均可升级；是否拦只看已有 gen issue 状态——
   * 该举措存在 in_progress 态升级件 → 409；completed/terminated 允许再升级（开新一轮排查）。
   *
   * @param {{
   *   actionItemId: string
   *   issueInput: { productKey: string, productName: string, title: string, summary: string, category: string, scope: string, optimization?: string, keywords?: string[], notes?: string }
   *   evidence: Array<{ recordId: string, recordDataSource: string, ticketId?: string }>
   *   actor?: { userId?: string, username?: string }
   * }} params
   */
  createIssueFromAction({ actionItemId, issueInput, evidence, actor }) {
    const db = getDb()
    // 409 防重：已有 in_progress 态升级件即拦
    const existingRefs = this.listIssuesForAction(actionItemId)
    if (existingRefs.some((r) => r.status === 'in_progress')) {
      const err = new Error('该举措已有进行中的举一反三问题，不能重复升级')
      err.code = 'GENERALIZATION_UPGRADE_CONFLICT'
      throw err
    }
    const { issue, errors } = buildGeneralizationIssueFromInput({
      ...issueInput,
      originActionId: actionItemId,
      createdBy: actor?.username || actor?.userId || '',
    })
    if (errors.length) throw validationError(errors.join('；'))

    // 证据按 dataSourceType 过滤（设计 §4.1：只取投诉/咨询；评价不参与升级挂载）
    const validEvidence = (evidence || []).filter(
      (e) =>
        e &&
        e.recordDataSource !== 'post_use_rating' &&
        String(e.recordId || '').trim(),
    )
    const now = new Date().toISOString()

    const write = db.transaction(() => {
      db.prepare(
        `INSERT INTO generalization_issues
         (id, product_key, product_name, status, title, summary, category, scope,
          root_cause, optimization, origin_action_id, occurrence_count,
          first_seen_at, last_seen_at, payload, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0, '', '', ?, ?, ?)`,
      ).run(
        issue.id,
        issue.productKey,
        issue.productName,
        issue.status,
        issue.title,
        issue.summary,
        issue.category,
        issue.scope,
        // 仅 optimization 预填（可空——23:39：root_cause 不预填，Tab 补全）
        String(issueInput?.optimization || ''),
        issue.originActionId,
        JSON.stringify(issue.payload || {}),
        issue.createdBy,
        issue.createdAt,
      )
      db.prepare(
        `INSERT OR IGNORE INTO generalization_issue_action_refs
         (issue_id, action_item_id, kind, created_at)
         VALUES (?, ?, 'created', ?)`,
      ).run(issue.id, actionItemId, now)
      for (const ev of validEvidence) {
        const { link, errors: linkErrors } = buildGeneralizationLinkFromInput({
          issueId: issue.id,
          recordId: String(ev.recordId),
          recordDataSource: String(ev.recordDataSource || ''),
          ticketId: ev.ticketId,
          linkStatus: 'confirmed',
          linkSource: 'manual',
        })
        if (linkErrors.length) continue // 单条证据异常跳过，不阻断升级事务
        db.prepare(
          `INSERT OR IGNORE INTO generalization_issue_links
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
          now,
          issue.createdBy,
          now,
          now,
        )
      }
      refreshIssueAggregatesWithin(db, issue.id)
    })
    write()
    return {
      issue: this.getIssue(issue.id),
      evidenceLinked: validEvidence.length,
      evidenceSkipped: (evidence || []).length - validEvidence.length,
    }
  },

  /**
   * 举措升级事务（from-action mode=link）：关联已有 in_progress issue。
   * 同样证据挂载 + 中间表 kind=linked；不修改 issue 本体（独立演化）。
   *
   * @param {{
   *   actionItemId: string
   *   issueId: string
   *   evidence: Array<{ recordId: string, recordDataSource: string, ticketId?: string }>
   *   actor?: { userId?: string, username?: string }
   * }} params
   */
  linkIssueToAction({ actionItemId, issueId, evidence, actor }) {
    const db = getDb()
    const issue = this.getIssue(issueId)
    if (!issue) {
      const err = new Error('举一反三问题不存在')
      err.code = ISSUE_NOT_FOUND_CODE
      throw err
    }
    if (issue.status !== 'in_progress') {
      throw validationError('只能关联进行中的举一反三问题')
    }
    // 409 防重同 create：已有 in_progress 升级件即拦（多对一允许，但同时进行中的只许一个）
    const existingRefs = this.listIssuesForAction(actionItemId)
    if (existingRefs.some((r) => r.status === 'in_progress')) {
      const err = new Error('该举措已有进行中的举一反三问题，不能重复升级')
      err.code = 'GENERALIZATION_UPGRADE_CONFLICT'
      throw err
    }
    const validEvidence = (evidence || []).filter(
      (e) =>
        e &&
        e.recordDataSource !== 'post_use_rating' &&
        String(e.recordId || '').trim(),
    )
    const now = new Date().toISOString()
    const actorLabel = actor?.username || actor?.userId || ''

    const write = db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO generalization_issue_action_refs
         (issue_id, action_item_id, kind, created_at)
         VALUES (?, ?, 'linked', ?)`,
      ).run(issueId, actionItemId, now)
      for (const ev of validEvidence) {
        const { link, errors: linkErrors } = buildGeneralizationLinkFromInput({
          issueId,
          recordId: String(ev.recordId),
          recordDataSource: String(ev.recordDataSource || ''),
          ticketId: ev.ticketId,
          linkStatus: 'confirmed',
          linkSource: 'manual',
        })
        if (linkErrors.length) continue
        // 复用 putLink 优先级矩阵语义（INSERT OR IGNORE 幂等：UNIQUE 冲突静默跳过）
        db.prepare(
          `INSERT OR IGNORE INTO generalization_issue_links
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
          now,
          actorLabel,
          now,
          now,
        )
      }
      refreshIssueAggregatesWithin(db, issueId)
    })
    write()
    return {
      issue: this.getIssue(issueId),
      evidenceLinked: validEvidence.length,
      evidenceSkipped: (evidence || []).length - validEvidence.length,
    }
  },

  // ── AI 建议 hint 表（generalization_hints）· 设计 §2.3 ──

  /**
   * 取记录的 AI 建议（抽屉建议条数据源）。
   * @param {string} recordId
   */
  getHint(recordId) {
    const db = getDb()
    const row = db
      .prepare('SELECT payload FROM generalization_hints WHERE id = ?')
      .get(String(recordId || ''))
    if (!row) return null
    try {
      return JSON.parse(row.payload || '{}')
    } catch {
      return null
    }
  },

  /**
   * upsert AI 建议（G-pass 写盘；一单一 hint）。
   * @param {string} recordId
   * @param {{ suggested?: string, category?: string, scope?: string, confidence?: string, reason?: string, suggestedAt?: string, status?: 'pending'|'adopted'|'dismissed', adoptedToIssueId?: string, decidedAt?: string, decidedBy?: string, promptVersion?: string }} hint
   */
  putHint(recordId, hint) {
    const db = getDb()
    db.prepare(
      `INSERT INTO generalization_hints (id, payload)
       VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
    ).run(String(recordId || ''), JSON.stringify(hint || {}))
    return this.getHint(recordId)
  },

  /**
   * hint 状态流转（adopt / dismiss——抽屉建议条两按钮）。
   * adopt：pending → adopted（可带 adoptedToIssueId 回链）；事务内同时挂 confirmed link。
   * dismiss：pending → dismissed（忽略记忆，不再弹）。
   * @param {string} recordId
   * @param {'adopt' | 'dismiss'} decision
   * @param {{ issueId?: string, actor?: { userId?: string, username?: string } }} [options]
   */
  decideHint(recordId, decision, options = {}) {
    const db = getDb()
    const hint = this.getHint(recordId)
    if (!hint || hint.status !== 'pending') {
      throw validationError('该记录当前没有待处理的 AI 建议')
    }
    const now = new Date().toISOString()
    const actorLabel = options.actor?.username || options.actor?.userId || ''

    if (decision === 'dismiss') {
      return {
        hint: this.putHint(recordId, {
          ...hint,
          status: 'dismissed',
          decidedAt: now,
          decidedBy: actorLabel,
        }),
      }
    }

    // adopt：新建 issue（预填 hint 的 category/scope）+ 首条 confirmed link = 宿主记录
    const recordRow = db
      .prepare('SELECT payload FROM records WHERE id = ?')
      .get(String(recordId || ''))
    if (!recordRow?.payload) {
      throw validationError('宿主记录不存在，无法采纳建议')
    }
    /** @type {Record<string, unknown>} */
    let record = {}
    try {
      record = JSON.parse(recordRow.payload)
    } catch {
      throw validationError('宿主记录损坏，无法采纳建议')
    }
    const issue = this.putIssue(
      {
        productKey: String(record.productKey || ''),
        productName: String(record.product || record.productName || ''),
        title: String(hint.reason || '待命名的共性问题').slice(0, 30) || '待命名的共性问题',
        summary: `${String(record.requestScene || '')} ${String(record.painPoint || '')}`
          .trim()
          .slice(0, 100) || '（采纳 AI 建议创建，待补充描述）',
        category: String(hint.category || 'other_intervenable'),
        scope: String(hint.scope || 'multi_scenario'),
        createdBy: actorLabel,
      },
      {
        firstLink: {
          recordId,
          recordDataSource: String(record.dataSourceType || 'complaint_ticket'),
          ticketId: String(record.ticketId || ''),
        },
        actor: options.actor,
      },
    )
    return {
      hint: this.putHint(recordId, {
        ...hint,
        status: 'adopted',
        adoptedToIssueId: issue.id,
        decidedAt: now,
        decidedBy: actorLabel,
      }),
      issue,
    }
  },

  /**
   * 新建前 FTS 同产品去重检测（轻提示不强制——设计 §5.1）。
   * 用 title/summary 关键片段在既有 in_progress issue 里找相似。
   * @param {{ title: string, summary?: string, productKey?: string, limit?: number }} params
   */
  findSimilarIssues({ title, summary, productKey, limit = 3 }) {
    const db = getDb()
    const t = String(title || '').trim()
    if (!t) return []
    const where = ["i.status = 'in_progress'"]
    /** @type {unknown[]} */
    const params = []
    if (productKey) {
      where.push('i.product_key = ?')
      params.push(productKey)
    }
    // 轻量字面匹配（title/summary LIKE 任一 4+ 字片段命中即候选）
    // 注意：conditions 与 params 必须同步裁剪——占位符数量与绑定值数量严格一致
    const conditions = []
    /** @type {string[]} */
    const likeParams = []
    for (const field of [t, String(summary || '')]) {
      const text = field.trim()
      if (text.length < 4) continue
      for (let i = 0; i + 4 <= text.length; i += 2) {
        if (conditions.length >= 10) break
        conditions.push('(i.title LIKE ? OR i.summary LIKE ?)')
        const frag = `%${text.slice(i, i + 4)}%`
        likeParams.push(frag, frag)
      }
      if (conditions.length >= 10) break
    }
    if (conditions.length) {
      where.push(`(${conditions.join(' OR ')})`)
      params.push(...likeParams)
    } else {
      return []
    }
    const cappedLimit = Math.min(10, Math.max(1, Number(limit || 3)))
    const rows = db
      .prepare(
        `SELECT i.id, i.title, i.summary, i.product_name, i.category, i.scope
         FROM generalization_issues i
         WHERE ${where.join(' AND ')}
         LIMIT ?`,
      )
      .all(...params, cappedLimit)
    return rows.map((r) => ({
      issueId: String(r.id || ''),
      title: String(r.title || ''),
      summary: String(r.summary || ''),
      productName: String(r.product_name || ''),
      category: String(r.category || ''),
      scope: String(r.scope || ''),
    }))
  },
}
