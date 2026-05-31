import { analyzeTicketSentiment } from './sentiment.js'
import { buildSentimentAnalysisText } from './sentimentAnalysisText.js'
import { themesFromJourney } from './applyThemes.js'
import { enrichRecordsWithSharedDimensions } from './dimensionTagging.js'
import { enrichRecordsWithJourneys } from './journeySemantic.js'
import { enrichRecordsWithTicketLlm } from './ticketAnalysis/ticketLlmEnrichment.js'
import { canUseSemanticMatch } from './themeSemantic.js'

/**
 * @typedef {Object} ImportEnrichmentResult
 * @property {import('./types.js').FeedbackRecord[]} records
 * @property {string[]} warnings
 */

/**
 * @param {Error | unknown} err
 */
function errMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 导入工单：在规则初标后依次增强请求场景/问题类型、用户旅程、客户请求/痛点/优化建议与用户情绪。
 * 各步骤独立容错，避免 LLM/网络异常导致整批导入失败。
 *
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} settings
 * @param {(label: string, done?: number, total?: number) => void} [onProgress]
 * @returns {Promise<ImportEnrichmentResult>}
 */
export async function enrichTicketRecordsForImport(records, settings, onProgress) {
  if (!records.length) return { records, warnings: [] }

  /** @type {string[]} */
  const warnings = []
  let out = records

  try {
    onProgress?.('请求场景与问题类型', 0, records.length)
    out = await enrichRecordsWithSharedDimensions(out, settings, (done, total) => {
      onProgress?.('请求场景与问题类型', done, total)
    })
  } catch (err) {
    console.warn('[import] 请求场景/问题类型打标失败，保留流水线初标:', err)
    warnings.push(`请求场景与问题类型：${errMessage(err)}（已保留初标结果）`)
  }

  try {
    onProgress?.('用户旅程', 0, records.length)
    out = await enrichRecordsWithJourneys(out, settings, (done, total) => {
      onProgress?.('用户旅程', done, total)
    })
    out = out.map((r) => ({ ...r, themes: themesFromJourney(r) }))
  } catch (err) {
    console.warn('[import] 用户旅程打标失败:', err)
    warnings.push(`用户旅程：${errMessage(err)}（已保留初标结果）`)
  }

  try {
    onProgress?.('客户请求、需求痛点与优化建议', 0, records.length)
    out = await enrichRecordsWithTicketLlm(out, settings, (done, total) => {
      onProgress?.('客户请求、需求痛点与优化建议', done, total)
    })
  } catch (err) {
    console.warn('[import] 客户请求/痛点/优化建议 LLM 增强失败，保留初标:', err)
    warnings.push(`客户请求、需求痛点与优化建议：${errMessage(err)}（已保留初标结果）`)
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

  if (!canUseSemanticMatch(settings)) {
    warnings.push(
      '未配置大模型 API Key：已完成关键词/解释本地打标；客户请求、需求痛点与优化建议仍为规则初标结果。请在设置填写 Key 或配置服务端 LLM_API_KEY 后重新打标。',
    )
  }

  onProgress?.('打标完成', records.length, records.length)
  return { records: out, warnings }
}
