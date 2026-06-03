import { analyzeTicketSentiment } from './sentiment.js'
import { buildSentimentAnalysisText } from './sentimentAnalysisText.js'
import { themesFromJourney } from './applyThemes.js'
import { enrichRecordsWithSharedDimensions, retagRecordsSharedDimensionsAfterTicketLlm } from './dimensionTagging.js'
import { enrichRecordsWithJourneys } from './journeySemantic.js'
import { enrichRecordsWithTicketLlm } from './ticketAnalysis/ticketLlmEnrichment.js'
import { resolveSettingsForLlm } from './llmClient.js'
import { canUseSemanticMatch } from './themeSemantic.js'
import { llmStageOrderAfterShared, resolveTaggingPipelineOrder } from './taggingPipeline.js'
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
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} settings
 * @param {(label: string, done?: number, total?: number) => void} [onProgress]
 * @returns {Promise<ImportEnrichmentResult>}
 */
export async function enrichTicketRecordsForImport(records, settings, onProgress) {
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

  out = await runImportStage(
    out,
    llmSettings,
    onProgress,
    '请求场景与问题类型',
    () =>
      enrichRecordsWithSharedDimensions(out, llmSettings, (done, total) => {
        onProgress?.('请求场景与问题类型', done, total)
      }),
    '请求场景/问题类型打标',
    warnings,
  )

  for (const stage of llmStageOrderAfterShared(pipelineOrder)) {
    if (stage === 'ticketLlm') {
      const beforeTicket = out.map((r) => ({ ...r }))
      out = await runImportStage(
        out,
        llmSettings,
        onProgress,
        '客户请求、需求痛点与优化建议',
        () =>
          enrichRecordsWithTicketLlm(out, llmSettings, (done, total) => {
            onProgress?.('客户请求、需求痛点与优化建议', done, total)
          }),
        '客户请求/痛点/优化建议 LLM 增强',
        warnings,
      )
      Object.assign(enrichmentStats, computeTicketLlmEnrichmentDelta(beforeTicket, out))
      out = await runImportStage(
        out,
        llmSettings,
        onProgress,
        '请求场景与问题类型（LLM 语料）',
        () =>
          retagRecordsSharedDimensionsAfterTicketLlm(out, llmSettings, (done, total) => {
            onProgress?.('请求场景与问题类型（LLM 语料）', done, total)
          }),
        'LLM 语料维度重打',
        warnings,
      )
      continue
    }

    const beforeJourney = out.map((r) => ({ ...r }))
    out = await runImportStage(
      out,
      llmSettings,
      onProgress,
      '用户旅程',
      async () => {
        const journeyOut = await enrichRecordsWithJourneys(out, llmSettings, (done, total) => {
          onProgress?.('用户旅程', done, total)
        })
        return journeyOut.map((r) => ({ ...r, themes: themesFromJourney(r) }))
      },
      '用户旅程打标',
      warnings,
    )
    Object.assign(enrichmentStats, computeJourneyEnrichmentDelta(beforeJourney, out, llmSettings))
  }

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

  enrichmentStats.optimizationRetryCount = countOptimizationRetries(out)

  if (!canUseSemanticMatch(llmSettings)) {
    warnings.push(
      '未配置大模型 API Key：已完成关键词/解释本地打标；客户请求、需求痛点与优化建议仍为规则初标结果。请在设置填写 Key 或配置服务端 LLM_API_KEY 后重新打标。',
    )
  } else {
    const journeyPending = countJourneyPendingAfterImport(out, llmSettings)
    for (const hint of buildEnrichmentRetagWarnings(enrichmentStats, journeyPending)) {
      if (!warnings.includes(hint)) warnings.push(hint)
    }
  }

  onProgress?.('打标完成', records.length, records.length)
  return { records: out, warnings, enrichmentStats }
}
