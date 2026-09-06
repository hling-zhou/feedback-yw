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
import { extractRootCauseWithLLM } from './rootCauseLLM.js'
import { extractTicketOptimizationsWithLLM } from './ticketOptimizationLLM.js'
import {
  extractTicketAnalysisUnifiedWithLLM,
  resolveTicketLlmMode,
} from './ticketAnalysisUnifiedLLM.js'
import { normalizeTicketRecordFields } from './recordNormalize.js'
import { validateTicketAnalysisPair } from './validateTicketAnalysisPair.js'
import { analyzeTicketSentiment } from '../sentiment.js'
import { buildSentimentAnalysisText } from '../sentimentAnalysisText.js'
import { getCatalogProduct, getCatalogProducts } from '../productCatalogLoader.js'
import {
  buildKnowledgeQuery,
  retrieveKnowledgeSnippets,
  formatKnowledgeSnippetsForPrompt,
} from '../knowledgeBaseClient.js'

/**
 * @param {string} [productKey]
 * @returns {string}
 */
function resolveProductName(productKey) {
  return getCatalogProduct(productKey)?.name || ''
}

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
 * @param {{ knowledgeSnippets?: string; productName?: string }} [extras]
 */
async function enrichRecordWithTicketLlmSeparate(record, settings, ctx, extras = {}) {
  const {
    corpus,
    candidates,
    ruleCustomerRequest,
    rulePainPoint,
    rootCause: ruleRootCause,
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
  let rootCause = record.rootCause?.trim() || ruleRootCause
  let rootCauseSource = record.rootCauseSource === 'llm' ? 'llm' : 'rule'
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

  try {
    const llmRootCause = await extractRootCauseWithLLM(
      {
        taggingText: corpus.taggingText,
        handlingText: input.handlingText,
        rootCause,
        painPoint,
      },
      settings,
    )
    if (llmRootCause) {
      rootCause = llmRootCause
      rootCauseSource = 'llm'
    }
  } catch (err) {
    console.warn('[ticket-llm] 问题原因 LLM 失败，保留规则/导入值:', err)
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
      extras,
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
    rootCause,
    rootCauseSource,
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
 * @param {{ knowledgeSnippets?: string; productName?: string }} [extras]
 */
async function enrichRecordWithTicketLlmUnified(record, settings, ctx, extras = {}) {
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
    extras,
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
    rootCause: unified.rootCause,
    rootCauseSource: unified.rootCauseSource,
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
 * @param {{ knowledgeSnippets?: string; productName?: string }} [extras]
 */
export async function enrichRecordWithTicketLlm(record, settings, extras = {}) {
  if (!canUseSemanticMatch(settings)) return record

  const productName = extras.productName ?? resolveProductName(record.productKey)
  let knowledgeSnippets = extras.knowledgeSnippets
  if (knowledgeSnippets === undefined) {
    const query = buildKnowledgeQuery(record, getCatalogProducts())
    const [snippets] = await retrieveKnowledgeSnippets([query])
    knowledgeSnippets = formatKnowledgeSnippetsForPrompt(snippets || [])
  }
  const mergedExtras = { productName, knowledgeSnippets }

  const ctx = buildTicketLlmRuleContext(record)
  const mode = resolveTicketLlmMode(settings)
  if (mode === 'separate' || mode === 'split2') {
    if (mode === 'split2') {
      console.warn('[ticket-llm] split2 尚未实现，回退 separate')
    }
    return enrichRecordWithTicketLlmSeparate(record, settings, ctx, mergedExtras)
  }
  return enrichRecordWithTicketLlmUnified(record, settings, ctx, mergedExtras)
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
  const catalogProducts = getCatalogProducts()

  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH)
    // 每批一次知识库检索，避免逐条往返
    const queries = chunk.map((record) => buildKnowledgeQuery(record, catalogProducts))
    let snippetsPerRecord = chunk.map(() => [])
    try {
      const results = await retrieveKnowledgeSnippets(queries)
      snippetsPerRecord = results.length === chunk.length ? results : chunk.map(() => [])
    } catch (err) {
      console.warn('[ticket-llm] 批量知识库检索失败，降级空片段:', err)
    }
    const enriched = await Promise.all(
      chunk.map(async (record, j) => {
        try {
          return await enrichRecordWithTicketLlm(record, settings, {
            productName: resolveProductName(record.productKey),
            knowledgeSnippets: formatKnowledgeSnippetsForPrompt(snippetsPerRecord[j] || []),
          })
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
