import { getDb } from './db.js'
import { storageRepository } from './storageRepository.js'
import { generalizationRepository } from './generalizationRepository.js'
import { buildGeneralizationLinkFromInput } from '../src/domain/generalizationIssue.js'
import { resolveGeneralizationScanTargets, recallGeneralizationCandidates } from '../src/lib/generalization/recall.js'
import {
  matchGeneralizationIssue,
  passesGeneralizationGate,
} from '../src/lib/generalization/matcher.js'
import { judgeGeneralizationForRecord, passesGeneralizationJudgeGate } from '../src/lib/generalization/generalizationPrompt.js'

/**
 * 举一反三扫描执行器（TASKS G2-4 / DESIGN §3）。
 *
 * 挂载方式：**不注册独立 enrichRunner mode**——由 observationScanRunner.runObservationMatch
 * 尾部调用（同一后台任务、同一 lock、同一 LLM transport——避免两任务串行抢锁）。
 * 手动补跑走 mode=observation_match + generalizationOnly 参数（跳过留观段只跑本段）。
 *
 * 两段：
 * - G-pass（发现型建议）：投诉/咨询工单 · 无 confirmed gen link · 无既有 hint（三态均跳过；
 *   gPassRetry 显式重判）→ LLM 判共性+可介入 → 写 generalization_hints；
 * - M-pass（历史问题匹配）：gen 全库召回（v3.2 不限产品）+ LLM 判别 → pending_suggest。
 *
 * 失败隔离：单条异常记 stats.errors 不中断；LLM 不可用 → G-pass 整体跳过、M-pass 走降级。
 */

const CHUNK = 4

/**
 * 加载本批扫描记录（对齐 observationScanRunner.loadScanRecords 语义）。
 * @param {{ records?: unknown[], recordIds?: string[], importMonth?: string }} opts
 * @returns {Record<string, unknown>[]}
 */
function loadScanRecords(opts) {
  if (opts.records?.length) return /** @type {Record<string, unknown>[]} */ (opts.records)
  const db = getDb()
  /** @type {Record<string, unknown>[]} */
  const records = []
  if (opts.recordIds?.length) {
    const stmt = db.prepare('SELECT payload FROM records WHERE id = ?')
    for (const id of opts.recordIds) {
      const row = stmt.get(String(id))
      if (!row?.payload) continue
      try {
        records.push(JSON.parse(row.payload))
      } catch {
        // 跳过损坏行
      }
    }
    return records
  }
  const month = String(opts.importMonth || '').trim()
  const rows = month
    ? db.prepare('SELECT payload FROM records WHERE import_month = ? ORDER BY id').all(month)
    : db.prepare('SELECT payload FROM records ORDER BY id').all()
  for (const row of rows) {
    try {
      records.push(JSON.parse(row.payload))
    } catch {
      // 跳过损坏行
    }
  }
  return records
}

/**
 * 全库 in_progress 态 gen issue 列表（含召回所需聚合字段）。
 * 全库不限产品——v3.2 定稿（范畴定义"共性=非单产品特例"与同产品约束矛盾）。
 */
function loadAllGeneralizationIssues() {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.summary, i.product_key, i.category, i.scope, i.payload,
              GROUP_CONCAT(CASE WHEN l.link_status = 'confirmed' THEN l.ticket_id END) AS ticket_ids,
              GROUP_CONCAT(CASE WHEN l.link_status = 'confirmed' THEN l.record_id END) AS record_ids
       FROM generalization_issues i
       LEFT JOIN generalization_issue_links l ON l.issue_id = i.id AND l.link_status = 'confirmed'
       WHERE i.status = 'in_progress'
       GROUP BY i.id`,
    )
    .all()
  return rows.map((row) => {
    let payload = {}
    try {
      payload = JSON.parse(row.payload || '{}')
    } catch {
      payload = {}
    }
    return {
      issueId: String(row.id),
      productKey: String(row.product_key || ''),
      title: String(row.title || ''),
      summary: String(row.summary || ''),
      category: String(row.category || ''),
      scope: String(row.scope || ''),
      keywords: Array.isArray(payload.keywords) ? payload.keywords.map(String) : [],
      confirmedTicketIds: String(row.ticket_ids || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      confirmedRecordIds: String(row.record_ids || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  })
}

/**
 * issue 代表证据：最新 confirmed 记录的痛点摘要（对齐观察 runner）。
 * @param {string} issueId
 */
function loadRepresentativeEvidence(issueId) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT r.payload FROM generalization_issue_links l
       JOIN records r ON r.id = l.record_id
       WHERE l.issue_id = ? AND l.link_status = 'confirmed'
       ORDER BY l.reviewed_at DESC, l.created_at DESC LIMIT 1`,
    )
    .all(String(issueId))
  for (const row of rows) {
    try {
      const record = JSON.parse(row.payload)
      const evidence = String(record.painPoint || record.problemSummary || '').trim()
      if (evidence) return evidence.slice(0, 120)
    } catch {
      // skip
    }
  }
  return ''
}

/**
 * 已确认关联到任意 in_progress gen issue 的记录集（G-pass 对象筛选用）。
 */
function loadConfirmedGenRecordIds() {
  const db = getDb()
  return new Set(
    db
      .prepare(
        `SELECT DISTINCT l.record_id FROM generalization_issue_links l
         JOIN generalization_issues i ON i.id = l.issue_id
         WHERE l.link_status = 'confirmed' AND i.status = 'in_progress'`,
      )
      .all()
      .map((r) => String(r.record_id)),
  )
}

/**
 * 写 pending_suggest（putLink 优先级矩阵兜底 C4）。
 * @returns {'created' | 'upgraded' | 'skipped' | 'error'}
 */
function putGenSuggestion(issue, target, confidence, excerpt, reason, userId, username) {
  const { link, errors } = buildGeneralizationLinkFromInput({
    issueId: issue.issueId,
    recordId: target.recordId,
    recordDataSource: target.recordDataSource,
    ticketId: target.ticketId,
    linkStatus: 'pending_suggest',
    linkSource: 'auto_match',
    matchConfidence: confidence,
    matchReason: reason,
    matchedExcerpt: excerpt,
  })
  if (errors.length) return 'error'
  try {
    const result = generalizationRepository.putLink(link, { actor: { userId, username } })
    return result.action
  } catch {
    return 'error'
  }
}

/**
 * @typedef {Object} GeneralizationScanStats
 * @property {number} [total] - 候选池记录数
 * @property {number} [processed]
 * @property {number} [gPassHints] - G-pass 新增 hint 数
 * @property {number} [gPassSkipped] - 跳过数（已关联/已有 hint/已采纳/已忽略）
 * @property {number} [gPassOutdated] - G4-2：旧 promptVersion 的 pending hint 数（可重判探测）
 * @property {boolean} [gPassDegraded] - LLM 不可用整体跳过
 * @property {number} [suggestions] - M-pass 新增 pending_suggest 数
 * @property {number} [llmMatches]
 * @property {number} [llmCalls]
 * @property {number} [crossProductMatches] - 跨产品命中数
 * @property {boolean} [llmDegraded] - M-pass 降级
 * @property {boolean} [cancelled]
 * @property {string[]} [errors]
 */

/**
 * 主入口：G-pass 段 + M-pass 段。
 *
 * @param {Object} opts
 * @param {unknown[]} [opts.records]
 * @param {string[]} [opts.recordIds]
 * @param {string} [opts.importMonth]
 * @param {import('../src/lib/storage.js').AppSettings | null} opts.settings
 * @param {string} opts.userId
 * @param {string} opts.username
 * @param {(progress: string) => void} opts.touch
 * @param {() => boolean} opts.cancelled
 * @param {boolean} [opts.gPassRetry] - 显式重判（默认三态 hint 均跳过）
 * @param {() => Promise<void>} [opts.yieldToEventLoop]
 * @param {{ llm?: unknown }} [opts.deps] - 测试注入（transport 由调用方 ensure）
 * @returns {Promise<{ records: [], warnings: string[], stats: GeneralizationScanStats }>}
 */
export async function runGeneralizationPass(opts) {
  const { settings, userId, username, touch, cancelled } = opts
  const stats = /** @type {GeneralizationScanStats} */ ({
    total: 0,
    processed: 0,
    gPassHints: 0,
    gPassSkipped: 0,
    gPassOutdated: 0,
    suggestions: 0,
    llmMatches: 0,
    llmCalls: 0,
    crossProductMatches: 0,
    errors: [],
  })
  const warnings = []
  // G4-2：当前 prompt 版本（outdated 探测基准）
  const { GENERALIZATION_PROMPT_VERSION: currentPromptVersion } = await import(
    '../src/lib/generalization/generalizationPrompt.js'
  )

  const records = loadScanRecords({
    records: opts.records,
    recordIds: opts.recordIds,
    importMonth: opts.importMonth,
  })
  const targets = resolveGeneralizationScanTargets({ records })
  stats.total = targets.length

  const genIssues = loadAllGeneralizationIssues()
  const confirmedGenRecordIds = loadConfirmedGenRecordIds()

  if (!targets.length) {
    touch('举一反三识别 (0/0)')
    return { records: [], warnings, stats }
  }

  const yieldFn =
    opts.yieldToEventLoop ||
    (() => new Promise((resolve) => setTimeout(resolve, 0)))

  // ── G-pass：发现型建议（设计 §3.1）──
  touch(`举一反三建议 (0/${targets.length})`)
  for (let i = 0; i < targets.length; i += CHUNK) {
    if (cancelled()) {
      stats.cancelled = true
      return { records: [], warnings: [...warnings, '任务已被用户取消'], stats }
    }
    const chunk = targets.slice(i, i + CHUNK)
    for (const target of chunk) {
      const record = records.find((r) => String(r?.id || '') === target.recordId)
      if (!record) {
        stats.processed += 1
        continue
      }
      // 对象筛选：已属已知 in_progress 举一反三问题 → 建议冗余跳过
      if (confirmedGenRecordIds.has(target.recordId)) {
        stats.gPassSkipped += 1
        stats.processed += 1
        continue
      }
      // 既有 hint 三态均跳过（已判/已采纳/已忽略不重判）；gPassRetry 显式重判——
      // G4-2 口径：重判只针对 pending 态（采纳/忽略的人工决策不覆盖）；旧版本 pending 计 outdated
      const existingHint = generalizationRepository.getHint(target.recordId)
      if (existingHint) {
        const isStalePending =
          existingHint.status === 'pending' &&
          String(existingHint.promptVersion || '') !== currentPromptVersion
        if (isStalePending) stats.gPassOutdated += 1
        const skipRetry =
          existingHint.status === 'adopted' || existingHint.status === 'dismissed'
        if (existingHint && (!opts.gPassRetry || skipRetry)) {
          stats.gPassSkipped += 1
          stats.processed += 1
          continue
        }
      }
      try {
        const judged = await judgeGeneralizationForRecord({
          record,
          productName: target.productName,
          settings,
          deps: /** @type {any} */ (opts.deps),
        })
        if (judged && passesGeneralizationJudgeGate(judged)) {
          const existing = generalizationRepository.getHint(target.recordId)
          generalizationRepository.putHint(target.recordId, {
            suggested: 'yes',
            category: judged.category,
            scope: judged.scope,
            confidence: judged.confidence,
            reason: judged.reason,
            suggestedAt: new Date().toISOString(),
            status: 'pending',
            promptVersion: judged.promptVersion,
            // 重判时保留既有决策痕迹：adopted/dismissed 被显式 gPassRetry 覆盖为 pending 属预期
            ...(existing?.adoptedToIssueId ? { previousAdoptedToIssueId: existing.adoptedToIssueId } : {}),
          })
          stats.gPassHints += 1
          stats.llmCalls += 1
        } else {
          stats.llmCalls += 1
        }
      } catch (err) {
        stats.errors?.push(String(err instanceof Error ? err.message : err))
        // 单条异常不中断
      }
      stats.processed += 1
    }
    touch(`举一反三建议 (${Math.min(i + CHUNK, targets.length)}/${targets.length})`)
    await yieldFn()
  }

  // ── M-pass：历史问题匹配（设计 §3.2——全库召回 v3.2）──
  if (!genIssues.length) {
    touch(`举一反三匹配 (0/0)`)
    return { records: [], warnings, stats }
  }

  touch(`举一反三匹配 (0/${targets.length})`)
  for (let i = 0; i < targets.length; i += CHUNK) {
    if (cancelled()) {
      stats.cancelled = true
      return { records: [], warnings: [...warnings, '任务已被用户取消'], stats }
    }
    const chunk = targets.slice(i, i + CHUNK)
    for (const target of chunk) {
      const record = records.find((r) => String(r?.id || '') === target.recordId)
      if (!record) {
        continue
      }
      const hits = recallGeneralizationCandidates({
        target,
        record,
        issues: genIssues,
        importMonthFrom: opts.importMonth || undefined,
      })
      for (const hit of hits) {
        const issue = genIssues.find((it) => it.issueId === hit.issueId)
        if (!issue) continue
        const crossProduct = issue.productKey !== target.productKey
        const excerpt = hit.excerpt || String(target.ticketId || target.recordId)

        let result = null
        try {
          stats.llmCalls += 1
          result = await matchGeneralizationIssue({
            issue: {
              ...issue,
              representativeEvidence: loadRepresentativeEvidence(issue.issueId),
            },
            record,
            productName: target.productName,
            settings,
            crossProduct,
            deps: /** @type {any} */ (opts.deps),
          })
        } catch (err) {
          stats.errors?.push(String(err instanceof Error ? err.message : err))
          result = null
        }
        if (!result) {
          // LLM 调用失败 → 单条降级（字面/关键词；不出 high——matcher 内建）
          const { scoreGeneralizationFallback } = await import(
            '../src/lib/generalization/matcher.js'
          )
          const recallText = String(
            (record.painPoint || '') + '\n' + (record.customerRequest || ''),
          )
          result = scoreGeneralizationFallback(issue, recallText)
          if (result) stats.llmDegraded = true
        }
        if (!result || !passesGeneralizationGate(result)) continue
        const outcome = putGenSuggestion(
          issue,
          target,
          result.confidence,
          excerpt,
          result.reason,
          userId,
          username,
        )
        if (outcome === 'created') {
          if (result.source === 'llm') stats.llmMatches += 1
          if (crossProduct) stats.crossProductMatches = (stats.crossProductMatches || 0) + 1
          stats.suggestions += 1
        }
      }
    }
    touch(`举一反三匹配 (${Math.min(i + CHUNK, targets.length)}/${targets.length})`)
    await yieldFn()
  }

  if (stats.gPassDegraded) {
    warnings.push('AI 建议判别在 LLM 不可用时整体跳过')
  }
  if (stats.llmDegraded) {
    warnings.push('部分匹配在 LLM 不可用时降级为字面判别（不出高置信）')
  }
  if (stats.errors?.length) {
    warnings.push(`${stats.errors.length} 条判别异常已跳过`)
  }
  touch(`举一反三识别完成 (${targets.length}/${targets.length})`)
  return { records: [], warnings, stats }
}
