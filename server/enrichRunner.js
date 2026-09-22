/**
 * 服务端打标执行器：注入 LLM transport + KB transport + taxonomy adapter，
 * in-process 调用 src/lib/ 打标模块（零改动复用），结果直接写盘。
 *
 * 三种模式：
 * - import:    enrichTicketRecordsForImport（导入 LLM 增强）
 * - bulk_retag: reprocessFeedbackRecord 循环 + reprocessAllThemesAndSentiment（批量重打标）
 * - single_retag: 同上，单条
 *
 * 进度通过 backgroundTaskLock.touch 更新，前端轮询 GET /api/storage/background-task。
 */

import { setLlmTransport, resolveSettingsForLlm } from '../src/lib/llmClient.js'
import { setKbTransport } from '../src/lib/knowledgeBaseClient.js'
import { enrichTicketRecordsForImport } from '../src/lib/importEnrichment.js'
import { reprocessFeedbackRecord } from '../src/lib/pipeline.js'
import { reprocessAllThemesAndSentiment } from '../src/lib/applyThemes.js'
import { forwardLlmChatCompletion } from './llmProxy.js'
import { isLlmConfigured, resolveLlmApiKey, resolveLlmBaseUrl } from './llmConfig.js'
import { retrieveSnippets } from './knowledgeBaseLoader.js'
import { storageRepository } from './storageRepository.js'
import { touchBackgroundTaskLock, isTaskCancelled } from './backgroundTaskLock.js'

/** 流式写盘批次大小，与前端 pipeline.js 的 BATCH_SIZE 保持一致 */
const FLUSH_BATCH_SIZE = 4
import { loadManagedTaxonomy } from '../src/lib/tagLibrary/taxonomyManagedStore.js'
import { loadManagedProductCatalog } from '../src/storage/productCatalogStore.js'
import { listUnknownJourneyRecords, summarizeRetagPainPointChanges, summarizeUnknownJourneyRecords } from '../src/lib/journeyRetagSummary.js'
import { computeTicketLlmEnrichmentDelta } from '../src/lib/importEnrichmentStats.js'

/**
 * 构建 LLM transport 函数：直接调 forwardLlmChatCompletion，不走 HTTP。
 * @returns {(body: object) => Promise<unknown>}
 */
function createLlmTransport() {
  return async (body) => {
    const apiKey = resolveLlmApiKey()
    const baseUrl = resolveLlmBaseUrl()
    return forwardLlmChatCompletion({ baseUrl, apiKey, body })
  }
}

/**
 * 构建 KB transport 函数：直接调 retrieveSnippets，不走 HTTP。
 * @returns {(queries: { productKeys: string[]; text: string; tags: string[] }[]) => Promise<unknown>}
 */
function createKbTransport() {
  return async (queries) => {
    const results = queries.map((query) => {
      const productKeys = (query?.productKeys || [])
        .map((k) => String(k ?? '').trim().toLowerCase())
        .filter(Boolean)
      const text = String(query?.text ?? '')
      const tags = (query?.tags || []).map((t) => String(t ?? '').trim()).filter(Boolean)
      const seen = new Map()
      for (const productKey of productKeys) {
        const snippets = retrieveSnippets(productKey, text, tags)
        for (const s of snippets) {
          const key = `${s.productKey}|${s.title}`
          if (!seen.has(key)) seen.set(key, s)
        }
      }
      return [...seen.values()]
    })
    return { results }
  }
}

/**
 * 构建 taxonomy adapter：直接调 storageRepository，不走 HTTP。
 * @returns {{ getMeta: (key: string) => unknown; putMeta: (key: string, value: unknown) => void }}
 */
function createTaxonomyAdapter() {
  return {
    getMeta: (key) => storageRepository.getMeta(key),
    putMeta: (key, value) => storageRepository.putMeta(key, value),
  }
}

/**
 * 注入所有 transport，在服务端进程内运行打标逻辑。
 * 调用方传 records 或 recordIds + periodId（服务端从 DB 加载）。
 *
 * @param {object} opts
 * @param {string} opts.mode
 * @param {import('../src/lib/types.js').FeedbackRecord[]} [opts.records]  import 模式直接传 records
 * @param {string[]} [opts.recordIds]  retag 模式传 ids，服务端从 DB 加载
 * @param {string} [opts.periodId]  retag 模式按 period + ids 加载
 * @param {import('../src/lib/storage.js').AppSettings} opts.settings
 * @param {string} opts.userId
 * @param {(label: string, done?: number, total?: number) => void} [opts.onProgress]
 * @param {object} [opts.retagOptions]
 * @returns {Promise<{ records: import('../src/lib/types.js').FeedbackRecord[], warnings: string[], stats?: object, writeResult?: object }>}
 */
export async function runEnrichment(opts) {
  const { mode, settings: rawSettings, userId, username, onProgress, retagOptions = {} } = opts

  // 1. 刷新 taxonomy 缓存 + 产品目录（确保用最新标签库和产品目录）
  try {
    touchBackgroundTaskLock(userId, { progress: '正在刷新标签库…' })
  } catch { /* lock 可能已被释放 */ }
  try {
    const adapter = createTaxonomyAdapter()
    await loadManagedTaxonomy(adapter)
  } catch (err) {
    console.warn('[enrichRunner] taxonomy 刷新失败，用缓存:', err)
  }
  try {
    touchBackgroundTaskLock(userId, { progress: '正在刷新产品目录…' })
  } catch { /* lock 可能已被释放 */ }
  try {
    const adapter = createTaxonomyAdapter()
    await loadManagedProductCatalog(adapter)
  } catch (err) {
    console.warn('[enrichRunner] 产品目录刷新失败，用缓存:', err)
  }

  // 2. 注入 transport
  touchBackgroundTaskLock(userId, { progress: '正在注入 LLM/KB transport…' })
  const llmTransport = createLlmTransport()
  const kbTransport = createKbTransport()
  const serverConfigured = isLlmConfigured()
  setLlmTransport(llmTransport, { ...rawSettings, llmServerConfigured: serverConfigured })
  setKbTransport(kbTransport)

  // resolve settings（补 llmServerConfigured 等，供下游使用）
  try { touchBackgroundTaskLock(userId, { progress: '正在加载 LLM 配置…' }) } catch { /* lock 可能已被释放 */ }
  const settings = await resolveSettingsForLlm(rawSettings)

  try {
    // 加载 records：retag 模式从 DB 按 ids 加载
    let records = opts.records
    if (!records && (opts.recordIds?.length)) {
      onProgress?.('正在加载记录', 0, opts.recordIds.length)
      try {
        touchBackgroundTaskLock(userId, { progress: '正在加载记录…' })
      } catch {
        // lock 可能已被释放
      }
      records = []
      for (let i = 0; i < opts.recordIds.length; i++) {
        const rec = storageRepository.getRecord(opts.recordIds[i])
        if (rec) records.push(rec)
        if (i % 50 === 0 || i === opts.recordIds.length - 1) {
          onProgress?.('正在加载记录', i + 1, opts.recordIds.length)
        }
      }
    }
    if (!records?.length) {
      return { records: [], warnings: ['无记录需要处理'] }
    }

    if (mode === 'import') {
      // 导入模式：enrichTicketRecordsForImport
      if (isTaskCancelled()) {
        return { records, warnings: ['任务已被用户取消'], stats: { cancelled: true } }
      }
      try { touchBackgroundTaskLock(userId, { progress: '开始导入打标…' }) } catch { /* lock 可能已被释放 */ }
      const result = await enrichTicketRecordsForImport(records, settings, (label, done, total) => {
        onProgress?.(label, done, total)
        try {
          touchBackgroundTaskLock(userId, {
            progress: `${label}${done != null && total ? ` (${done}/${total})` : ''}`,
          })
        } catch {
          // lock 可能已被释放，静默
        }
      })
      if (isTaskCancelled()) {
        return { records: result.records, warnings: [...(result.warnings || []), '任务已被用户取消'], stats: { ...result.enrichmentStats, cancelled: true } }
      }
      return {
        records: result.records,
        warnings: result.warnings,
        stats: result.enrichmentStats,
      }
    }

    if (mode === 'bulk_retag' || mode === 'single_retag') {
      const total = records.length
      const scope = retagOptions.scope
      const skipRuleRetag = scope === 'needs_ticket_llm' || scope === 'needs_journey_llm'

      // before 快照（用于统计）
      const beforeRecords = records
      const beforeUnknown = listUnknownJourneyRecords(beforeRecords).length

      let retagged = records

      if (!skipRuleRetag) {
        // 规则重打标（每 FLUSH_BATCH_SIZE 条流式写盘，与前端 pipeline.js 一致）
        try { touchBackgroundTaskLock(userId, { progress: '开始规则重打标…' }) } catch { /* lock 可能已被释放 */ }
        retagged = []
        let pendingBatch = []
        for (let i = 0; i < total; i++) {
          if (isTaskCancelled()) {
            // 取消时先 flush 剩余已处理的
            if (pendingBatch.length) {
              try { storageRepository.putRecords(pendingBatch, { actor: { userId, username } }) } catch (err) { console.error('[enrichRunner] flush on cancel 失败:', err) }
            }
            const stats = { total, cancelled: true, processed: retagged.length }
            return { records: retagged, warnings: ['任务已被用户取消'], stats }
          }
          const rec = records[i]
          const processed = await reprocessFeedbackRecord(rec, settings, {
            forceOverrideManualTags: retagOptions.forceOverrideManualTags,
          })
          retagged.push(processed)
          pendingBatch.push(processed)

          // 流式写盘
          if (pendingBatch.length >= FLUSH_BATCH_SIZE) {
            try { storageRepository.putRecords(pendingBatch, { actor: { userId, username } }) } catch (err) { console.error('[enrichRunner] 流式写盘失败:', err) }
            pendingBatch = []
          }

          onProgress?.('规则重打标', i + 1, total)
          try {
            touchBackgroundTaskLock(userId, {
              progress: `正在规则重打标 (${i + 1}/${total})`,
            })
          } catch {
            // lock 可能已被释放
          }
        }
        // flush 尾部残余
        if (pendingBatch.length) {
          try { storageRepository.putRecords(pendingBatch, { actor: { userId, username } }) } catch (err) { console.error('[enrichRunner] 尾部 flush 失败:', err) }
        }
      }

      // LLM 增强 + 主题 + 情绪
      try { touchBackgroundTaskLock(userId, { progress: '开始 LLM 增强…' }) } catch { /* lock 可能已被释放 */ }
      const enriched = await reprocessAllThemesAndSentiment(
        retagged,
        settings,
        (done, tot, label) => {
          onProgress?.(label || 'LLM 增强', done, tot)
          try {
            touchBackgroundTaskLock(userId, {
              progress: `正在${label || 'LLM 增强'} (${done}/${tot})`,
            })
          } catch {
            // lock 可能已被释放
          }
        },
        {
          ticketLlmOnly: scope === 'needs_ticket_llm',
          journeyLlmOnly: scope === 'needs_journey_llm',
          forceOverrideManualTags: retagOptions.forceOverrideManualTags,
          retagDimensionsAfterTicketLlm: retagOptions.retagDimensionsAfterTicketLlm,
          onTicketLlmBatchPersist: (chunk) => {
            try { storageRepository.putRecords(chunk, { actor: { userId, username } }) } catch (err) { console.error('[enrichRunner] LLM 批次写盘失败:', err) }
          },
        },
      )

      // 统计
      const afterUnknownList = listUnknownJourneyRecords(enriched)
      const afterUnknown = afterUnknownList.length
      const summary = summarizeUnknownJourneyRecords(enriched)
      const painPointDelta = summarizeRetagPainPointChanges(beforeRecords, enriched)
      const llmDelta = computeTicketLlmEnrichmentDelta(beforeRecords, enriched)

      return {
        records: enriched,
        warnings: [],
        stats: {
          total,
          beforeUnknown,
          afterUnknown,
          summary,
          painPointDelta,
          ticketLlmCompleted: llmDelta.ticketLlmCompleted,
          ticketLlmFailed: llmDelta.ticketLlmFailed,
        },
      }
    }

    throw new Error(`Unknown enrichment mode: ${mode}`)
  } finally {
    // 重置 transport 回浏览器模式（防止污染）
    setLlmTransport(null, null)
    setKbTransport(null)
  }
}
