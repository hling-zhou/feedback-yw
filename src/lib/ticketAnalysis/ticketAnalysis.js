import { canUseSemanticMatch } from '../themeSemantic.js'
import { getTaxonomy, resolveProductKey } from '../productTaxonomy.js'
import { analyzeTicketSentiment } from '../sentiment.js'
import { buildSentimentAnalysisText } from '../sentimentAnalysisText.js'
import {
  extractProblemSummary,
  extractRootCause,
  extractSolutionSummary,
} from '../ticketTagging.js'
import { buildTicketAnalysisCorpus } from './ticketAnalysisCorpus.js'
import {
  buildCustomerRequestExtractionContext,
  extractCustomerRequestRule,
} from './customerRequestExtract.js'
import { extractCustomerRequestWithLLM } from './customerRequestLLM.js'
import { extractPainPoint } from './painPointExtract.js'
import { extractPainPointWithLLM } from './painPointLLM.js'
import { extractRootCauseWithLLM } from './rootCauseLLM.js'
import { tagTicketDimensions } from './ticketDimensionTagging.js'
import { extractTicketOptimizations } from './ticketOptimizationExtract.js'
import { extractTicketOptimizationsWithLLM } from './ticketOptimizationLLM.js'
import {
  extractTicketAnalysisUnifiedWithLLM,
  resolveTicketLlmMode,
} from './ticketAnalysisUnifiedLLM.js'
import { normalizeTicketRecordFields } from './recordNormalize.js'
import { validateTicketAnalysisPair } from './validateTicketAnalysisPair.js'

/**
 * @param {Object} input
 * @param {import('../storage.js').AppSettings | null} [settings]
 * @param {ReturnType<typeof buildTicketAnalysisCorpus>} corpus
 */
function analyzeTicketCore(input, settings, corpus) {
  const taxonomyKey = input.productKey?.trim() || resolveProductKey(input.product?.trim() || '')
  const taxonomy = getTaxonomy(input.product, taxonomyKey)

  const { candidates, ruleFallback: ruleCustomerRequest } =
    buildCustomerRequestExtractionContext(input)
  const customerRequest = ruleCustomerRequest
  const solutionSummary = extractSolutionSummary(corpus.taggingText, input.solutionCol)
  const rootCause = extractRootCause(corpus.taggingText, input.rootCauseCol)
  const rulePainPoint =
    extractPainPoint({
      taggingText: corpus.taggingText,
      customerRequest,
      handlingText: input.handlingText,
      rootCauseCol: input.rootCauseCol,
    }) || extractProblemSummary(corpus.taggingText).slice(0, 80)
  const painPoint = rulePainPoint

  const taggingInput = {
    ...input,
    customerRequest,
    painPoint,
    problemSummary: painPoint,
  }

  const dims = tagTicketDimensions({
    text: corpus.taggingText,
    input: taggingInput,
    taxonomy,
    taxonomyKey,
    settings: {
      useRequestNodeForJourney: settings?.useRequestNodeForJourney !== false,
    },
  })

  const { sentiment, urgencyLevel } = analyzeTicketSentiment(
    buildSentimentAnalysisText({ customerRequest, painPoint }),
  )

  const optimizations = extractTicketOptimizations({
    text: corpus.taggingText,
    solutionSummary,
    rootCause,
    journeyL2: dims.journeyL2,
    painPoint,
    fuzzy: corpus.fuzzy,
  })

  return {
    corpus,
    candidates,
    ruleCustomerRequest,
    rulePainPoint,
    customerRequest,
    solutionSummary,
    rootCause,
    painPoint,
    dims,
    sentiment,
    urgencyLevel,
    optimizations,
    taxonomyKey,
    taxonomy,
  }
}

/**
 * @param {Object} input
 * @param {Object} core
 * @param {import('../storage.js').AppSettings | null} [settings]
 */
async function enrichTicketAnalysisWithLlm(input, core, settings) {
  let { customerRequest, painPoint, optimizations, sentiment, urgencyLevel } = core
  const {
    corpus,
    candidates,
    ruleCustomerRequest,
    rulePainPoint,
    solutionSummary,
    rootCause,
    dims,
  } = core
  let customerRequestSource = /** @type {'rule' | 'llm'} */ ('rule')
  let painPointSource = /** @type {'rule' | 'llm'} */ ('rule')
  let rootCauseSource = /** @type {'rule' | 'llm'} */ ('rule')
  let optimizationSource = /** @type {'rule' | 'llm'} */ ('rule')

  if (!canUseSemanticMatch(settings)) {
    return {
      customerRequest,
      painPoint,
      rootCause,
      optimizations,
      sentiment,
      urgencyLevel,
      customerRequestSource,
      painPointSource,
      rootCauseSource,
      optimizationSource,
    }
  }

  if (resolveTicketLlmMode(settings) === 'unified') {
    const unified = await extractTicketAnalysisUnifiedWithLLM(
      {
        taggingText: corpus.taggingText,
        candidates,
        ruleFallback: {
          customerRequest: ruleCustomerRequest,
          painPoint: rulePainPoint,
          optimizationProduct: optimizations.optimizationProduct,
          optimizationService: optimizations.optimizationService,
        },
        handlingText: input.handlingText,
        rootCause,
        solutionSummary,
        journeyL2: dims.journeyL2,
        requestScene: dims.requestScene,
        problemType: dims.problemType,
        fuzzy: corpus.fuzzy,
      },
      settings,
    )
    const sentimentResult = analyzeTicketSentiment(
      buildSentimentAnalysisText({
        customerRequest: unified.customerRequest,
        painPoint: unified.painPoint,
      }),
    )
    return {
      customerRequest: unified.customerRequest,
      painPoint: unified.painPoint,
      rootCause: unified.rootCause,
      optimizations: {
        optimizationProduct: unified.optimizationProduct,
        optimizationService: unified.optimizationService,
        optimizationSuggestion: unified.optimizationSuggestion,
      },
      sentiment: sentimentResult.sentiment,
      urgencyLevel: sentimentResult.urgencyLevel,
      customerRequestSource: unified.customerRequestSource,
      painPointSource: unified.painPointSource,
      rootCauseSource: unified.rootCauseSource,
      optimizationSource: unified.optimizationSource,
    }
  }

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
    console.warn('[analyzeTicketAsync] 客户请求 LLM 失败，使用规则结果:', err)
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
    console.warn('[analyzeTicketAsync] 痛点 LLM 失败，使用规则结果:', err)
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
    console.warn('[analyzeTicketAsync] 问题原因 LLM 失败，保留规则/导入值:', err)
  }

  const validated = validateTicketAnalysisPair(
    customerRequest,
    painPoint,
    ruleCustomerRequest,
    rulePainPoint,
  )
  customerRequest = validated.customerRequest
  painPoint = validated.painPoint

  const sentimentResult = analyzeTicketSentiment(
    buildSentimentAnalysisText({ customerRequest, painPoint }),
  )
  sentiment = sentimentResult.sentiment
  urgencyLevel = sentimentResult.urgencyLevel

  try {
    const llmOpt = await extractTicketOptimizationsWithLLM(
      {
        text: corpus.taggingText,
        solutionSummary,
        rootCause,
        journeyL2: dims.journeyL2,
        painPoint,
        requestScene: dims.requestScene,
        problemType: dims.problemType,
        fuzzy: corpus.fuzzy,
      },
      settings,
    )
    if (llmOpt.optimizationProduct || llmOpt.optimizationService) {
      optimizations = {
        optimizationProduct: llmOpt.optimizationProduct || optimizations.optimizationProduct,
        optimizationService: llmOpt.optimizationService || optimizations.optimizationService,
        optimizationSuggestion:
          llmOpt.optimizationSuggestion || optimizations.optimizationSuggestion,
      }
      optimizationSource = 'llm'
    }
  } catch (err) {
    console.warn('[analyzeTicketAsync] 优化建议 LLM 失败，使用规则结果:', err)
  }

  return {
    customerRequest,
    painPoint,
    rootCause,
    optimizations,
    sentiment,
    urgencyLevel,
    customerRequestSource,
    painPointSource,
    rootCauseSource,
    optimizationSource,
  }
}

/**
 * @param {Object} core
 * @param {Object} input
 * @param {Object} enriched
 */
function buildTicketAnalysisResult(input, core, enriched) {
  const { dims, solutionSummary, rootCause, taxonomyKey, taxonomy } = core
  const {
    customerRequest = core.customerRequest,
    painPoint = core.painPoint,
    rootCause: enrichedRootCause = rootCause,
    rootCauseSource = 'rule',
    optimizations = core.optimizations,
    sentiment = core.sentiment,
    urgencyLevel = core.urgencyLevel,
    customerRequestSource = 'rule',
    painPointSource = 'rule',
    optimizationSource = 'rule',
  } = enriched

  return normalizeTicketRecordFields({
    productKey: taxonomy.key || taxonomyKey,
    requestScene: dims.requestScene,
    problemType: dims.problemType,
    overlayHits: dims.overlayHits || [],
    journeyL1: dims.journeyL1,
    journeyL2: dims.journeyL2,
    customerRequest,
    customerRequestSource,
    painPoint,
    problemSummary: painPoint,
    painPointSource,
    solutionSummary,
    rootCause: enrichedRootCause || rootCause || '待分析',
    rootCauseSource,
    optimizationProduct: optimizations.optimizationProduct,
    optimizationService: optimizations.optimizationService,
    optimizationSuggestion: optimizations.optimizationSuggestion,
    optimizationSource,
    sentiment,
    urgencyLevel,
    resourcePool: input.resourcePool?.trim() || undefined,
  })
}

/**
 * 单条工单分析（规则版）
 * @param {Object} input
 * @param {import('../storage.js').AppSettings | null} [settings]
 */
export function analyzeTicket(input, settings = null) {
  const corpus = buildTicketAnalysisCorpus(input)
  const core = analyzeTicketCore(input, settings, corpus)
  return buildTicketAnalysisResult(input, core, {
    painPoint: core.painPoint,
    optimizations: core.optimizations,
    customerRequestSource: 'rule',
    painPointSource: 'rule',
    optimizationSource: 'rule',
  })
}

/**
 * 单条工单分析（规则初标 + LLM 增强客户请求、痛点与优化建议）
 * @param {Object} input
 * @param {import('../storage.js').AppSettings | null} [settings]
 */
export async function analyzeTicketAsync(input, settings = null) {
  const corpus = buildTicketAnalysisCorpus(input)
  const core = analyzeTicketCore(input, settings, corpus)
  const enriched = await enrichTicketAnalysisWithLlm(input, core, settings)
  return buildTicketAnalysisResult(input, core, enriched)
}
