import { canUseSemanticMatch } from '../themeSemantic.js'
import { buildTaggingTextForRecord } from '../taggingText.js'
import { buildTicketAnalysisCorpus } from './ticketAnalysisCorpus.js'
import {
  buildCustomerRequestExtractionContext,
} from './customerRequestExtract.js'
import { extractCustomerRequestWithLLM } from './customerRequestLLM.js'
import { extractPainPoint } from './painPointExtract.js'
import { extractTicketOptimizations } from './ticketOptimizationExtract.js'
import { extractPainPointWithLLM } from './painPointLLM.js'
import { extractTicketOptimizationsWithLLM } from './ticketOptimizationLLM.js'
import {
  extractTicketAnalysisUnifiedWithLLM,
  resolveTicketLlmMode,
} from './ticketAnalysisUnifiedLLM.js'
import { normalizeTicketRecordFields } from './recordNormalize.js'
import { validateTicketAnalysisPair } from './validateTicketAnalysisPair.js'
import { analyzeTicketSentiment } from '../sentiment.js'
import { buildSentimentAnalysisText } from '../sentimentAnalysisText.js'

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function recordToTicketAnalysisInput(record) {
  return {
    rawText: record.rawText,
    handlingText: record.handlingText,
    customerQuote: record.customerQuote,
    product: record.product,
    productKey: record.productKey,
    resourcePool: record.resourcePool,
    rootCauseCol: record.rootCause,
    solutionCol: record.responseText || record.solutionSummary,
    sourceColumns: record.sourceColumns,
  }
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
function buildTicketLlmRuleContext(record) {
  const input = recordToTicketAnalysisInput(record)
  const corpus = buildTicketAnalysisCorpus(input)
  const { candidates, ruleFallback: ruleCustomerRequest } =
    buildCustomerRequestExtractionContext(input)
  const rulePainPoint =
    extractPainPoint({
      taggingText: corpus.taggingText,
      customerRequest: ruleCustomerRequest,
      handlingText: input.handlingText,
      rootCauseCol: input.rootCauseCol,
    }) || record.painPoint?.trim() || ''

  const rootCause = record.rootCause?.trim() || ''
  const solutionSummary = record.solutionSummary?.trim() || ''
  const journeyL2 = record.journeyL2?.trim() || ''
  const ruleOptimizations = extractTicketOptimizations({
    text: corpus.taggingText,
    solutionSummary,
    rootCause,
    journeyL2,
    painPoint: rulePainPoint,
    fuzzy: corpus.fuzzy,
  })

  return {
    input,
    corpus,
    candidates,
    ruleCustomerRequest,
    rulePainPoint,
    rootCause,
    solutionSummary,
    journeyL2,
    ruleOptimizations,
  }
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 * @param {import('../storage.js').AppSettings} settings
 * @param {ReturnType<typeof buildTicketLlmRuleContext>} ctx
 */
async function enrichRecordWithTicketLlmSeparate(record, settings, ctx) {
  const {
    corpus,
    candidates,
    ruleCustomerRequest,
    rulePainPoint,
    rootCause,
    solutionSummary,
    journeyL2,
    ruleOptimizations,
    input,
  } = ctx

  let customerRequest = record.customerRequest?.trim() || ruleCustomerRequest
  let customerRequestSource =
    record.customerRequestSource === 'llm' ? 'llm' : 'rule'
  let painPoint = record.painPoint?.trim() || rulePainPoint
  let painPointSource = record.painPointSource === 'llm' ? 'llm' : 'rule'
  let optimizationProduct =
    record.optimizationProduct?.trim() || ruleOptimizations.optimizationProduct
  let optimizationService =
    record.optimizationService?.trim() || ruleOptimizations.optimizationService
  let optimizationSource = record.optimizationSource === 'llm' ? 'llm' : 'rule'

  try {
    const llmRequest = await extractCustomerRequestWithLLM(
      {
        taggingText: corpus.taggingText,
        candidates,
        ruleFallback: ruleCustomerRequest,
      },
      settings,
    )
    if (llmRequest) {
      customerRequest = llmRequest
      customerRequestSource = 'llm'
    }
  } catch (err) {
    console.warn('[ticket-llm] 客户请求 LLM 失败，保留规则结果:', err)
  }

  try {
    const llmPain = await extractPainPointWithLLM(
      {
        taggingText: corpus.taggingText,
        customerRequest,
        handlingText: input.handlingText,
        rootCause,
      },
      settings,
    )
    if (llmPain) {
      painPoint = llmPain
      painPointSource = 'llm'
    }
  } catch (err) {
    console.warn('[ticket-llm] 痛点挖掘失败，保留规则结果:', err)
  }

  const validated = validateTicketAnalysisPair(
    customerRequest,
    painPoint,
    ruleCustomerRequest,
    rulePainPoint,
  )
  customerRequest = validated.customerRequest
  painPoint = validated.painPoint

  const { sentiment, urgencyLevel } = analyzeTicketSentiment(
    buildSentimentAnalysisText({ customerRequest, painPoint }),
  )

  try {
    const llmOpt = await extractTicketOptimizationsWithLLM(
      {
        text: corpus.taggingText,
        solutionSummary,
        rootCause,
        journeyL2,
        painPoint,
        requestScene: record.requestScene,
        problemType: record.problemType,
        fuzzy: corpus.fuzzy,
      },
      settings,
    )
    if (llmOpt.optimizationProduct) optimizationProduct = llmOpt.optimizationProduct
    if (llmOpt.optimizationService) optimizationService = llmOpt.optimizationService
    if (llmOpt.optimizationProduct || llmOpt.optimizationService) {
      optimizationSource = 'llm'
    }
  } catch (err) {
    console.warn('[ticket-llm] 单条优化建议失败，保留规则结果:', err)
  }

  const optimizationSuggestion = [optimizationProduct, optimizationService].filter(Boolean).join('\n')

  return normalizeTicketRecordFields({
    ...record,
    customerRequest,
    customerRequestSource,
    painPoint,
    problemSummary: painPoint,
    painPointSource,
    optimizationProduct,
    optimizationService,
    optimizationSuggestion,
    optimizationSource,
    sentiment,
    urgencyLevel,
  })
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 * @param {import('../storage.js').AppSettings} settings
 * @param {ReturnType<typeof buildTicketLlmRuleContext>} ctx
 */
async function enrichRecordWithTicketLlmUnified(record, settings, ctx) {
  const {
    corpus,
    candidates,
    ruleCustomerRequest,
    rulePainPoint,
    rootCause,
    solutionSummary,
    journeyL2,
    ruleOptimizations,
  } = ctx

  const unified = await extractTicketAnalysisUnifiedWithLLM(
    {
      taggingText: corpus.taggingText,
      candidates,
      ruleFallback: {
        customerRequest: ruleCustomerRequest,
        painPoint: rulePainPoint,
        optimizationProduct: ruleOptimizations.optimizationProduct,
        optimizationService: ruleOptimizations.optimizationService,
      },
      rootCause,
      solutionSummary,
      journeyL2,
      requestScene: record.requestScene,
      problemType: record.problemType,
      fuzzy: corpus.fuzzy,
    },
    settings,
  )

  const { sentiment, urgencyLevel } = analyzeTicketSentiment(
    buildSentimentAnalysisText({
      customerRequest: unified.customerRequest,
      painPoint: unified.painPoint,
    }),
  )

  return normalizeTicketRecordFields({
    ...record,
    customerRequest: unified.customerRequest,
    customerRequestSource: unified.customerRequestSource,
    painPoint: unified.painPoint,
    problemSummary: unified.painPoint,
    painPointSource: unified.painPointSource,
    optimizationProduct: unified.optimizationProduct,
    optimizationService: unified.optimizationService,
    optimizationSuggestion: unified.optimizationSuggestion,
    optimizationSource: unified.optimizationSource,
    sentiment,
    urgencyLevel,
  })
}

/**
 * 对已有初标记录用 LLM 增强客户请求、痛点与单条优化建议（不覆盖四维标签）
 * @param {import('../types.js').FeedbackRecord} record
 * @param {import('../storage.js').AppSettings} settings
 */
export async function enrichRecordWithTicketLlm(record, settings) {
  if (!canUseSemanticMatch(settings)) return record

  const ctx = buildTicketLlmRuleContext(record)
  const mode = resolveTicketLlmMode(settings)
  if (mode === 'separate' || mode === 'split2') {
    if (mode === 'split2') {
      console.warn('[ticket-llm] split2 尚未实现，回退 separate')
    }
    return enrichRecordWithTicketLlmSeparate(record, settings, ctx)
  }
  return enrichRecordWithTicketLlmUnified(record, settings, ctx)
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {import('../storage.js').AppSettings} settings
 * @param {(done: number, total: number) => void} [onProgress]
 * @param {{ onBatchPersist?: (records: import('../types.js').FeedbackRecord[]) => Promise<void> | void }} [options]
 */
export async function enrichRecordsWithTicketLlm(records, settings, onProgress, options = {}) {
  if (!records.length || !canUseSemanticMatch(settings)) {
    onProgress?.(records.length, records.length)
    return records
  }

  const BATCH = 4
  const out = [...records]

  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH)
    const enriched = await Promise.all(
      chunk.map(async (record) => {
        try {
          return await enrichRecordWithTicketLlm(record, settings)
        } catch (err) {
          console.warn('[ticket-llm] 单条增强失败:', err)
          return record
        }
      }),
    )
    enriched.forEach((record, j) => {
      out[i + j] = record
    })
    if (options.onBatchPersist) {
      await options.onBatchPersist(enriched)
    }
    onProgress?.(Math.min(i + BATCH, records.length), records.length)
  }

  return out
}

/**
 * 供非 record 场景使用：从 tagging 文本构建 LLM 上下文
 * @param {import('../types.js').FeedbackRecord} record
 */
export function buildTaggingTextFromRecord(record) {
  return buildTaggingTextForRecord(record)
}
