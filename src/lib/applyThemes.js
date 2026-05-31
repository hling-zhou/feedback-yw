import { analyzeTicketSentiment } from './sentiment.js'
import {
  enrichRecordsWithJourneys,
  recordsNeedJourneyLlmProposal,
  recordHasUnknownJourney,
} from './journeySemantic.js'
import { resolveSettingsForLlm } from './llmClient.js'
import { enrichRecordsWithSharedDimensions } from './dimensionTagging.js'
import { enrichRecordsWithTicketLlm } from './ticketAnalysis/ticketLlmEnrichment.js'
import { canUseSemanticMatch } from './themeSemantic.js'
import { preserveManualTags } from './manualTagFields.js'
import { buildSentimentAnalysisText } from './sentimentAnalysisText.js'

/**
 * 旅程标签由用户旅程同步（二级环节名即标签；无二级时取一级）
 * @param {{ journeyL1?: string; journeyL2?: string }} record
 */
export function themesFromJourney(record) {
  const tags = []
  if (record.journeyL2?.trim()) tags.push(record.journeyL2.trim())
  else if (record.journeyL1?.trim()) tags.push(record.journeyL1.trim())
  return tags.length ? tags : ['未分类']
}

/**
 * @param {import('./storage.js').AppSettings} settings
 */
export function needsAsyncThemeEnrichment(settings) {
  return false
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} _settings
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function enrichRecordsWithThemes(records, _settings, onProgress) {
  return records.map((r, i) => {
    onProgress?.(i + 1, records.length)
    return { ...r, themes: themesFromJourney(r) }
  })
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} settings
 * @param {(done: number, total: number, stage?: string) => void} [onProgress]
 * @param {{ forceOverrideManualTags?: boolean; onTicketLlmBatchPersist?: (records: import('./types.js').FeedbackRecord[]) => Promise<void> | void; ticketLlmOnly?: boolean }} [options]
 */
export async function reprocessAllThemesAndSentiment(records, settings, onProgress, options = {}) {
  const total = records.length
  const llmSettings = await resolveSettingsForLlm(settings)

  if (options.ticketLlmOnly) {
    let enriched = records
    if (canUseSemanticMatch(llmSettings)) {
      enriched = await enrichRecordsWithTicketLlm(
        enriched,
        llmSettings,
        (done) => {
          onProgress?.(done, total, '客户请求/痛点/优化建议')
        },
        { onBatchPersist: options.onTicketLlmBatchPersist },
      )
    }
    const originalById = new Map(records.map((r) => [r.id, r]))
    return enriched.map((r, i) => {
      onProgress?.(i + 1, total, '用户情绪')
      const original = originalById.get(r.id) ?? r
      const { sentiment, urgencyLevel } = analyzeTicketSentiment(buildSentimentAnalysisText(r))
      const next = {
        ...r,
        themes: themesFromJourney(r),
        sentiment,
        urgencyLevel,
        customerQuote: r.customerRequest?.trim() || r.customerQuote || '',
      }
      return preserveManualTags(original, next, {
        forceOverride: options.forceOverrideManualTags === true,
      })
    })
  }

  const needsJourneyLlm =
    recordsNeedJourneyLlmProposal(records) || records.some(recordHasUnknownJourney)

  let enriched = records
  enriched = await enrichRecordsWithSharedDimensions(enriched, llmSettings, (done) => {
    onProgress?.(done, total, '请求场景与问题类型')
  })
  if (canUseSemanticMatch(llmSettings)) {
    enriched = await enrichRecordsWithJourneys(enriched, llmSettings, (done) => {
      onProgress?.(done, total, '用户旅程')
    })
  } else if (needsJourneyLlm) {
    console.warn(
      '[reprocess] 未配置可用的大模型 API Key，用户旅程无法 LLM 提案；请在设置填写 Key 或配置服务端 LLM_API_KEY 后重试。',
    )
  }

  if (canUseSemanticMatch(llmSettings)) {
    enriched = await enrichRecordsWithTicketLlm(
      enriched,
      llmSettings,
      (done) => {
        onProgress?.(done, total, '客户请求/痛点/优化建议')
      },
      { onBatchPersist: options.onTicketLlmBatchPersist },
    )
  }

  const originalById = new Map(records.map((r) => [r.id, r]))

  return enriched.map((r, i) => {
    onProgress?.(i + 1, total, '用户情绪')
    const original = originalById.get(r.id) ?? r
    const { sentiment, urgencyLevel } = analyzeTicketSentiment(buildSentimentAnalysisText(r))
    const next = {
      ...r,
      themes: themesFromJourney(r),
      sentiment,
      urgencyLevel,
      customerQuote: r.customerRequest?.trim() || r.customerQuote || '',
    }
    return preserveManualTags(original, next, {
      forceOverride: options.forceOverrideManualTags === true,
    })
  })
}

export { settingsWithTaxonomy } from './taxonomyLoader.js'
