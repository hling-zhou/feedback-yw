import { analyzeTicketSentiment } from './sentiment.js'
import { buildSentimentAnalysisText } from './sentimentAnalysisText.js'
import { themesFromJourney } from './applyThemes.js'
import { enrichRecordsWithSharedDimensions, retagRecordsSharedDimensionsAfterTicketLlm } from './dimensionTagging.js'
import { enrichRecordsWithJourneys } from './journeySemantic.js'
import { enrichRecordsWithTicketLlm } from './ticketAnalysis/ticketLlmEnrichment.js'
import { resolveSettingsForLlm } from './llmClient.js'
import { canUseSemanticMatch } from './themeSemantic.js'
import { llmStageOrderAfterShared, resolveTaggingPipelineOrder } from './taggingPipeline.js'
import { validateL0, validateL1 } from './ticketAnalysis/dimensionValidation.js'
import { extractIntent } from './ticketAnalysis/intentExtractor.js'
import {
  buildEnrichmentRetagWarnings,
  computeJourneyEnrichmentDelta,
  computeTicketLlmEnrichmentDelta,
  countJourneyPendingAfterImport,
  countOptimizationRetries,
  createEmptyEnrichmentStats,
} from './importEnrichmentStats.js'

/**
 * @typedef {import('./importEnrichmentStats.js').ImportEnrichmentStats} ImportEnrichmentStats
 * @typedef {Object} ImportEnrichmentResult
 * @property {import('./types.js').FeedbackRecord[]} records
 * @property {string[]} warnings
 * @property {ImportEnrichmentStats} enrichmentStats
 */

/**
 * @param {Error | unknown} err
 */
function errMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * M5: LLM 增强 customerRequest 后重验 L0 闸门
 * 如果 LLM 重写了 CR，用新的 CR 重跑 validateL0；失败标 manual_review
 *
 * @param {import('./types.js').FeedbackRecord[]} records  含 before 快照
 * @param {import('./types.js').FeedbackRecord[]} before   LLM 前快照
 * @returns {{ revalidated: number, downgraded: number }}
 */
function revalidateL0AfterLlm(records, before) {
  let revalidated = 0
  let downgraded = 0
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const prev = before[i]
    if (!prev) continue
    const oldCR = (prev.customerRequest || '').trim()
    const newCR = (rec.customerRequest || '').trim()
    // CR 没变 → 不需要重验
    if (oldCR === newCR) continue
    // 只对 tagStatus=ok 的工单重验（manual_review 的已跳过 LLM 增强）
    if (rec.tagStatus === 'manual_review') continue
    revalidated++
    const intent = extractIntent(newCR)
    const l0 = validateL0({ customerRequest: newCR, confidence: intent.confidence, action: intent.action })
    if (!l0.pass) {
      rec.tagStatus = 'manual_review'
      rec.tagIssues = [...(rec.tagIssues || []), `M5: LLM 增强 CR 后 L0 复验失败 (${l0.issues.join('; ')})`]
      downgraded++
    }
  }
  return { revalidated, downgraded }
}

/**
 * M6: LLM 语料维度重打后重验 L1 闸门
 * 如果 LLM 重打改了 scene/type，重跑 validateL1；失败标 manual_review
 *
 * @param {import('./types.js').FeedbackRecord[]} records  含 before 快照
 * @param {import('./types.js').FeedbackRecord[]} before   重打前快照
 * @returns {{ revalidated: number, downgraded: number }}
 */
function revalidateL1AfterRetag(records, before) {
  let revalidated = 0
  let downgraded = 0
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const prev = before[i]
    if (!prev) continue
    const oldScene = (prev.requestScene || '').trim()
    const newScene = (rec.requestScene || '').trim()
    const oldType = (prev.problemType || '').trim()
    const newType = (rec.problemType || '').trim()
    // scene/type 都没变 → 不需要重验
    if (oldScene === newScene && oldType === newType) continue
    if (rec.tagStatus === 'manual_review') continue
    revalidated++
    const l1 = validateL1({ requestScene: newScene, problemType: newType, confidence: 'high' })
    if (!l1.pass) {
      rec.tagStatus = 'manual_review'
      rec.tagIssues = [...(rec.tagIssues || []), `M6: LLM 重打维度后 L1 复验失败 (${l1.issues.join('; ')})`]
      downgraded++
    }
  }
  return { revalidated, downgraded }
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} settings
 * @param {(label: string, done?: number, total?: number) => void} onProgress
 * @param {string} label
 * @param {() => Promise<import('./types.js').FeedbackRecord[]>} run
 * @param {string} warnPrefix
 * @param {string[]} warnings
 */
async function runImportStage(records, settings, onProgress, label, run, warnPrefix, warnings) {
  try {
    onProgress(label, 0, records.length)
    const out = await run()
    return out
  } catch (err) {
    console.warn(`[import] ${warnPrefix}失败:`, err)
    warnings.push(`${label}：${errMessage(err)}（已保留初标结果）`)
    return records
  }
}

/**
 * 导入工单：在规则初标后依次增强请求场景/问题类型、工单 LLM、用户旅程与用户情绪。
 * 顺序由 `taggingPipelineOrder` 控制（默认 ticket_first：工单 LLM 先于旅程 LLM）。
 * 各步骤独立容错，避免 LLM/网络异常导致整批导入失败。
 *
 * **闸门联动（2026-09-10）**：
 * tagStatus='manual_review' 的工单跳过所有 LLM 增强——不在错误标签上叠 LLM。
 * 等人工修正标签后再手动触发 LLM 重打。
 * manual_review 工单保留规则初标结果，情绪分析照常跑（不依赖标签）。
 *
 * **M5/M6 复验（2026-09-10）**：
 * M5: ticketLlm 增强 CR 后，对 CR 变了的记录重跑 validateL0；失败标 manual_review
 * M6: retagDimensions 重打 scene/type 后，对变了的记录重跑 validateL1；失败标 manual_review
 *
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} settings
 * @param {(label: string, done?: number, total?: number) => void} [onProgress]
 * @param {{ shouldCancel?: () => boolean }} [options]
 * @returns {Promise<ImportEnrichmentResult & { cancelled?: boolean }>}
 */
export async function enrichTicketRecordsForImport(records, settings, onProgress, options = {}) {
  if (!records.length) {
    return { records, warnings: [], enrichmentStats: createEmptyEnrichmentStats() }
  }

  const llmSettings = await resolveSettingsForLlm(settings)

  /** @type {string[]} */
  const warnings = []
  /** @type {ImportEnrichmentStats} */
  const enrichmentStats = createEmptyEnrichmentStats()
  let out = records
  const pipelineOrder = resolveTaggingPipelineOrder(llmSettings)

  // 分离 manual_review 工单：跳过 LLM 增强，只跑情绪分析
  const needsReview = out.filter((r) => r.tagStatus === 'manual_review')
  const enrichable = out.filter((r) => r.tagStatus !== 'manual_review')

  if (needsReview.length) {
    warnings.push(`${needsReview.length} 条工单闸门验证未通过（manual_review），跳过 LLM 增强，需人工修正标签后手动重打`)
  }

  // 只对 enrichable 跑 LLM 增强
  let enriched = enrichable
  const totalEnrichable = enriched.length
  const stop = () => Boolean(options.shouldCancel?.())

  if (stop()) {
    return { records: out, warnings: [...warnings, '任务已被用户取消'], enrichmentStats, cancelled: true }
  }

  enriched = await runImportStage(
    enriched,
    llmSettings,
    onProgress,
    '请求场景与问题类型',
    () =>
      enrichRecordsWithSharedDimensions(enriched, llmSettings, (done, total) => {
        onProgress?.('请求场景与问题类型', done, total)
      }),
    '请求场景/问题类型打标',
    warnings,
  )

  for (const stage of llmStageOrderAfterShared(pipelineOrder)) {
    if (stop()) {
      return {
        records: [...enriched, ...needsReview],
        warnings: [...warnings, '任务已被用户取消'],
        enrichmentStats,
        cancelled: true,
      }
    }
    if (stage === 'ticketLlm') {
      const beforeTicket = enriched.map((r) => ({ ...r }))
      enriched = await runImportStage(
        enriched,
        llmSettings,
        onProgress,
        '客户请求、需求痛点、问题原因与优化建议',
        () =>
          enrichRecordsWithTicketLlm(
            enriched,
            llmSettings,
            (done, total) => {
              onProgress?.('客户请求、需求痛点、问题原因与优化建议', done, total)
            },
            { shouldCancel: options.shouldCancel },
          ),
        '客户请求/痛点/问题原因/优化建议 LLM 增强',
        warnings,
      )

      try {
        Object.assign(enrichmentStats, computeTicketLlmEnrichmentDelta(beforeTicket, enriched))
      } catch (err) {
        console.warn('[import] ticketLlm 统计计算失败:', err)
      }

      // M5: LLM 增强 CR 后重验 L0 闸门
      try {
        const m5 = revalidateL0AfterLlm(enriched, beforeTicket)
        if (m5.downgraded > 0) {
          warnings.push(`M5: LLM 增强 CR 后 L0 复验失败 ${m5.downgraded}/${m5.revalidated} 条，已降级 manual_review`)
        }
      } catch (err) {
        console.warn('[import] M5 L0 复验失败:', err)
      }

      const beforeRetag = enriched.map((r) => ({ ...r }))
      enriched = await runImportStage(
        enriched,
        llmSettings,
        onProgress,
        '请求场景与问题类型（LLM 语料）',
        () =>
          retagRecordsSharedDimensionsAfterTicketLlm(enriched, llmSettings, (done, total) => {
            onProgress?.('请求场景与问题类型（LLM 语料）', done, total)
          }),
        'LLM 语料维度重打',
        warnings,
      )

      // M6: LLM 重打维度后重验 L1 闸门
      try {
        const m6 = revalidateL1AfterRetag(enriched, beforeRetag)
        if (m6.downgraded > 0) {
          warnings.push(`M6: LLM 重打维度后 L1 复验失败 ${m6.downgraded}/${m6.revalidated} 条，已降级 manual_review`)
        }
      } catch (err) {
        console.warn('[import] M6 L1 复验失败:', err)
      }
      continue
    }

    const beforeJourney = enriched.map((r) => ({ ...r }))
    enriched = await runImportStage(
      enriched,
      llmSettings,
      onProgress,
      '用户旅程',
      async () => {
        const journeyOut = await enrichRecordsWithJourneys(enriched, llmSettings, (done, total) => {
          onProgress?.('用户旅程', done, total)
        })
        return journeyOut.map((r) => ({ ...r, themes: themesFromJourney(r) }))
      },
      '用户旅程打标',
      warnings,
    )
    try {
      Object.assign(enrichmentStats, computeJourneyEnrichmentDelta(beforeJourney, enriched, llmSettings))
    } catch (err) {
      console.warn('[import] journey 统计计算失败:', err)
    }
  }

  if (stop()) {
    return {
      records: [...enriched, ...needsReview],
      warnings: [...warnings, '任务已被用户取消'],
      enrichmentStats,
      cancelled: true,
    }
  }

  // 合并：enriched + needsReview（后者只跑情绪分析）
  out = [...enriched, ...needsReview]

  try {
    onProgress?.('用户情绪', records.length, records.length)
    out = out.map((r) => {
      const { sentiment, urgencyLevel } = analyzeTicketSentiment(buildSentimentAnalysisText(r))
      return {
        ...r,
        customerQuote: r.customerRequest?.trim() || r.customerQuote || '',
        sentiment,
        urgencyLevel,
        themes: themesFromJourney(r),
      }
    })
  } catch (err) {
    console.warn('[import] 情绪分析失败:', err)
    warnings.push(`用户情绪：${errMessage(err)}`)
  }

  try {
    enrichmentStats.optimizationRetryCount = countOptimizationRetries(out)
  } catch (err) {
    console.warn('[import] optimizationRetry 统计失败:', err)
  }

  if (!canUseSemanticMatch(llmSettings)) {
    warnings.push(
      '未配置大模型 API Key：已完成关键词/解释本地打标；客户请求、需求痛点、问题原因与优化建议仍为规则初标结果。请在设置填写 Key 或配置服务端 LLM_API_KEY 后重新打标。',
    )
  } else {
    try {
      const journeyPending = countJourneyPendingAfterImport(out, llmSettings)
      for (const hint of buildEnrichmentRetagWarnings(enrichmentStats, journeyPending)) {
        if (!warnings.includes(hint)) warnings.push(hint)
      }
    } catch (err) {
      console.warn('[import] 增强统计警告构建失败:', err)
    }
  }

  onProgress?.('打标完成', records.length, records.length)
  return { records: out, warnings, enrichmentStats }
}
