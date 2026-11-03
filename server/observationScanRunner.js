import { getDb } from './db.js'
import { storageRepository } from './storageRepository.js'
import { observationRepository } from './observationRepository.js'
import { buildObservationLinkFromInput } from '../src/domain/observationIssue.js'
import { resolveObservationScanTargets } from '../src/lib/observation/scanTargets.js'
import { recallObservationCandidates } from '../src/lib/observation/recall.js'
import {
  matchObservationIssue,
  passesObservationGate,
} from '../src/lib/observation/matcher.js'
import { getCatalogProducts } from '../src/lib/productCatalogLoader.js'
import { loadManagedProductCatalog } from '../src/storage/productCatalogStore.js'
import { isLlmConfigured, resolveLlmApiKey, resolveLlmBaseUrl, resolveLlmModel } from './llmConfig.js'
import { forwardLlmChatCompletion } from './llmProxy.js'
import { setLlmTransport } from '../src/lib/llmClient.js'
import { setKbTransport } from '../src/lib/knowledgeBaseClient.js'

/**
 * 留观自动识别执行器（enrichRunner mode observation_match 的实现体）。
 *
 * 设计约束（DESIGN §3.1 / §3.2）：
 * - C5：只对 watching 态 issue 召回；
 * - C4：已 confirmed/pending/dismissed 组合由 putLink 优先级矩阵兜底（本层不重复判断）；
 * - 锚点命中（high）跳过 LLM 直判；其余候选逐对 LLM 判别，same 且 ≥medium 落 pending_suggest；
 * - LLM 整体不可用 → 降级字面/关键词评分（永不产 high）；单条异常不中断整批；
 * - 目录消费前刷新（服务端缓存易陈旧前科——照 refreshProductCatalogForReminder 模式）。
 */

const CHUNK = 4

/**
 * 加载参与扫描的记录。
 * @param {{ records?: unknown[], recordIds?: string[], importMonth?: string }} opts
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
 * 取同产品 watching 态 issue 列表（含召回所需聚合字段）。
 * @param {string} productKey
 */
function loadIssuesForProduct(productKey) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.summary, i.payload,
              GROUP_CONCAT(CASE WHEN l.link_status = 'confirmed' AND l.record_data_source != 'post_use_rating' THEN l.ticket_id END) AS ticket_ids,
              GROUP_CONCAT(CASE WHEN l.link_status = 'confirmed' THEN l.record_id END) AS record_ids
       FROM observation_issues i
       LEFT JOIN observation_issue_links l ON l.issue_id = i.id AND l.link_status = 'confirmed'
       WHERE i.product_key = ? AND i.status = 'watching'
       GROUP BY i.id`,
    )
    .all(String(productKey || ''))
  return rows.map((row) => {
    let payload = {}
    try {
      payload = JSON.parse(row.payload || '{}')
    } catch {
      payload = {}
    }
    return {
      issueId: String(row.id),
      title: String(row.title || ''),
      summary: String(row.summary || ''),
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
 * issue 代表证据：最新 confirmed 记录的痛点/原文摘要。
 * @param {string} issueId
 */
function loadRepresentativeEvidence(issueId) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT r.payload FROM observation_issue_links l
       JOIN records r ON r.id = l.record_id
       WHERE l.issue_id = ? AND l.link_status = 'confirmed'
       ORDER BY l.reviewed_at DESC, l.created_at DESC LIMIT 1`,
    )
    .all(String(issueId))
  for (const row of rows) {
    try {
      const record = JSON.parse(row.payload)
      const type = String(record.dataSourceType || '')
      const evidence = type === 'post_use_rating'
        ? String(record.commentText || record.rawText || '').trim()
        : String(record.painPoint || record.problemSummary || '').trim()
      if (evidence) return evidence.slice(0, 120)
    } catch {
      // skip
    }
  }
  return ''
}

/**
 * 注入 LLM transport（服务端进程内直调，不走 HTTP——对齐 enrichRunner 既有模式）。
 */
async function ensureLlmTransport(settings) {
  const serverConfigured = isLlmConfigured()
  setLlmTransport(
    async (body) => {
      const apiKey = resolveLlmApiKey()
      const baseUrl = resolveLlmBaseUrl()
      const model = resolveLlmModel()
      const { baseUrl: _b, model: _m, apiKey: _k, ...chatBody } = body || {}
      return forwardLlmChatCompletion({ baseUrl, apiKey, body: { ...chatBody, model } })
    },
    { ...settings, llmServerConfigured: serverConfigured },
  )
  setKbTransport(null)
  return serverConfigured
}

/**
 * @typedef {Object} ObservationMatchStats
 * @property {number} total - 候选池记录数
 * @property {number} processed
 * @property {number} suggestions - 新增 pending_suggest 数
 * @property {number} anchorHits
 * @property {number} llmMatches
 * @property {number} llmCalls
 * @property {number} [crossSourceMatches]
 * @property {boolean} [llmDegraded]
 * @property {boolean} [cancelled]
 * @property {string[]} [errors]
 */

/**
 * 主入口。
 * @param {Object} opts
 * @param {unknown[]} [opts.records]
 * @param {string[]} [opts.recordIds]
 * @param {string} [opts.importMonth]
 * @param {import('../src/lib/storage.js').AppSettings | null} opts.settings
 * @param {string} opts.userId
 * @param {string} opts.username
 * @param {(progress: string) => void} opts.touch
 * @param {() => boolean} opts.cancelled
 * @returns {Promise<{ records: [], warnings: string[], stats: ObservationMatchStats }>}
 */
export async function runObservationMatch(opts) {
  const { settings, userId, username, touch, cancelled } = opts
  const stats = /** @type {ObservationMatchStats} */ ({
    total: 0,
    processed: 0,
    suggestions: 0,
    anchorHits: 0,
    llmMatches: 0,
    llmCalls: 0,
    errors: [],
  })
  const warnings = []

  touch('正在刷新产品目录…')
  try {
    // 目录消费前刷新（进程内缓存易陈旧——服务端消费方前科）
    const db = getDb()
    const adapter = {
      getMeta: (key) => storageRepository.getMeta(key),
      putMeta: (key, value) => storageRepository.putMeta(key, value),
    }
    void db
    await loadManagedProductCatalog(adapter)
  } catch (err) {
    warnings.push(`产品目录刷新失败，使用当前缓存: ${err instanceof Error ? err.message : String(err)}`)
  }

  const records = loadScanRecords({ records: opts.records, recordIds: opts.recordIds, importMonth: opts.importMonth })
  const catalogProducts = getCatalogProducts()
  const hasPostUseScope = catalogProducts.some((p) => p?.analysisPostUseRating)
  if (!hasPostUseScope) {
    warnings.push('产品目录未开启任何用后即评分析范围：本次扫描仅覆盖工单，评价记录不参与')
  }
  const targets = resolveObservationScanTargets({ records, catalogProducts })
  stats.total = targets.length

  // generalizationOnly=true（手动补跑——TASKS G2-4 第 5 条）：跳过留观段，只跑举一反三段（finally 内挂载）
  const generalizationOnly = /** @type {boolean} */ (opts.generalizationOnly) === true

  if (!targets.length && !generalizationOnly) {
    touch('留观自动识别 (0/0)')
    return { records: [], warnings, stats }
  }

  const llmServerConfigured = await ensureLlmTransport(settings)
  let llmFailedOnce = false

  try {
    if (generalizationOnly) {
      touch('仅执行举一反三识别（跳过留观段）')
    } else {
      for (let i = 0; i < targets.length; i += CHUNK) {
      if (cancelled()) {
        stats.cancelled = true
        return { records: [], warnings: [...warnings, '任务已被用户取消'], stats }
      }
      const chunk = targets.slice(i, i + CHUNK)
      for (const target of chunk) {
        const record = records.find((r) => String(r?.id || '') === target.recordId)
        if (!record) continue
        const issues = loadIssuesForProduct(target.productKey)
        if (!issues.length) {
          stats.processed += 1
          continue
        }
        const hits = recallObservationCandidates({
          target,
          record,
          issues,
          importMonthFrom: opts.importMonth || undefined,
        })
        for (const hit of hits) {
          const issue = issues.find((it) => it.issueId === hit.issueId)
          if (!issue) continue
          const excerpt = hit.excerpt || String(target.ticketId || target.recordId)

          if (hit.confidence === 'high') {
            // 锚点通道：跳过 LLM 直判
            const outcome = putSuggestion(issue, target, 'high', hit.excerpt, '锚点命中：原工单已确认属于此问题', userId, username)
            if (outcome === 'created') {
              // upgraded = 更新既有 pending 的置信度/理由，不新增队列条目，不计 suggestions
              stats.anchorHits += 1
              stats.suggestions += 1
            }
            continue
          }

          let result = null
          if (llmServerConfigured && !llmFailedOnce) {
            try {
              stats.llmCalls += 1
              result = await matchObservationIssue({
                issue: {
                  ...issue,
                  representativeEvidence: loadRepresentativeEvidence(issue.issueId),
                },
                record,
                productName: target.productName,
                settings,
              })
            } catch (err) {
              stats.errors?.push(String(err instanceof Error ? err.message : err))
              result = null
            }
          }
          if (!result && llmServerConfigured) {
            // LLM 调用失败 → 单条降级（字面/关键词）
            const { scoreObservationFallback } = await import('../src/lib/observation/matcher.js')
            result = scoreObservationFallback(issue, String(record.painPoint || record.commentText || ''))
            if (result) stats.llmDegraded = true
          }
          if (!result || !passesObservationGate(result)) {
            // F5 跨源补射：同源未过门槛，且 issue 证据与记录跨源时，语域对齐再判一次（置信度封顶 medium）
            const cross = crossSourceBetween(issue, target)
            if (cross && llmServerConfigured && !llmFailedOnce) {
              stats.llmCalls += 1
              let crossResult = null
              try {
                crossResult = await matchObservationIssue({
                  issue: {
                    ...issue,
                    representativeEvidence: loadRepresentativeEvidence(issue.issueId),
                    evidenceKind: issueEvidenceKind(issue),
                  },
                  record,
                  productName: target.productName,
                  settings,
                  crossSource: true,
                })
              } catch (err) {
                stats.errors?.push(String(err instanceof Error ? err.message : err))
                crossResult = null
              }
              if (crossResult && passesObservationGate(crossResult)) {
                result = crossResult
                stats.crossSourceMatches = (stats.crossSourceMatches || 0) + 1
              }
            }
            if (!result || !passesObservationGate(result)) continue
          }
          const outcome = putSuggestion(
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
            stats.suggestions += 1
          }
        }
        stats.processed += 1
      }
      touch(`留观自动识别 (${Math.min(i + CHUNK, targets.length)}/${targets.length})`)
      // 让出事件循环（抽屉/轮询不被堵）
      await opts.yieldToEventLoop()
    }
    } // end of else（generalizationOnly 跳过留观段）
  } catch (err) {
    // 留观段异常不阻断举一反三段（两段互不影响）；仍需 finally 重置 transport
    warnings.push(
      `留观自动识别异常中断: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    // ── 举一反三段（TASKS G2-4 / DESIGN §4.2）：同一任务/lock/transport 尾部挂载 ──
    // generalizationOnly=true（手动补跑）或常规导入触发（默认两段都跑）
    if (!stats.cancelled && opts.generalizationOnly !== false) {
      try {
        const { runGeneralizationPass } = await import('./generalizationScanRunner.js')
        const genResult = await runGeneralizationPass({
          records: opts.records,
          recordIds: opts.recordIds,
          importMonth: opts.importMonth,
          settings,
          userId,
          username,
          touch,
          cancelled,
          gPassRetry: opts.gPassRetry === true,
          yieldToEventLoop: opts.yieldToEventLoop,
        })
        warnings.push(...genResult.warnings)
        stats.generalization = genResult.stats
      } catch (err) {
        warnings.push(
          `举一反三识别异常跳过: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    // 重置 transport 回浏览器模式（防污染——对齐 enrichRunner finally）
    setLlmTransport(null, null)
    setKbTransport(null)
  }

  if (stats.llmDegraded) {
    warnings.push('部分判别在 LLM 不可用时降级为字面判别（不出高置信）')
  }
  if (stats.errors?.length) {
    warnings.push(`${stats.errors.length} 条判别异常已跳过`)
  }
  touch(`留观自动识别 (${targets.length}/${targets.length})`)
  return { records: [], warnings, stats }
}

/**
 * 跨源判定：issue 的 confirmed 证据以工单为主而记录是评价（或反之）。
 * @param {{ confirmedTicketIds: string[] }} issue
 * @param {{ recordDataSource: string }} target
 */
function crossSourceBetween(issue, target) {
  const hasTicketEvidence = (issue.confirmedTicketIds || []).length > 0
  if (target.recordDataSource === 'post_use_rating') return hasTicketEvidence
  return !hasTicketEvidence
}

/**
 * issue 证据类型（补射 prompt 语域提示用）。
 * @param {{ confirmedTicketIds: string[] }} issue
 */
function issueEvidenceKind(issue) {
  return (issue.confirmedTicketIds || []).length > 0 ? 'ticket' : 'rating'
}

/**
 * 写 pending_suggest（putLink 优先级矩阵兜底 C4：confirmed/dismissed/pending 组合自动跳过）。
 * @returns {'created' | 'upgraded' | 'skipped' | 'error'}
 */
function putSuggestion(issue, target, confidence, excerpt, reason, userId, username) {
  const { link, errors } = buildObservationLinkFromInput({
    issueId: issue.issueId,
    recordId: target.recordId,
    recordDataSource: target.recordDataSource,
    ticketId: target.ticketId,
    linkStatus: 'pending_suggest',
    linkSource: confidence === 'high' && reason?.includes('锚点') ? 'auto_anchor' : 'auto_match',
    matchConfidence: confidence,
    matchReason: reason,
    matchedExcerpt: excerpt,
  })
  if (errors.length) return 'error'
  try {
    const result = observationRepository.putLink(link, { actor: { userId, username } })
    return result.action
  } catch {
    // 单条失败不中断（矩阵冲突等预期内情况）
    return 'error'
  }
}
