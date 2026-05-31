import { extractFromRaw } from './extract.js'
import { analyzeTicketSentiment } from './sentiment.js'
import { buildSentimentAnalysisText } from './sentimentAnalysisText.js'
import { analyzeTicket } from './ticketAnalysis/ticketAnalysis.js'
import { themesFromJourney } from './applyThemes.js'
import { getTaxonomy } from './productTaxonomy.js'
import {
  captureProblemTypeCandidateIfNeeded,
  captureRequestSceneCandidateIfNeeded,
} from './tagCandidates.js'
import { pickImportRowMeta } from './importUtils.js'
import { buildSourceColumns } from './sourceColumns.js'
import { resolveProductFromSpec } from './productCatalog.js'
import { canonicalTaxonomyKey } from './taxonomyKeyAliases.js'
import { normalizeTicketId, normalizeCreatedAt } from './desensitize.js'
import { buildTaggingTextFromFields } from './taggingText.js'
import { preserveManualTags, applyForceRetagOverrides } from './manualTagFields.js'
import { assignComplaintCauseFieldsForImport } from '../domain/complaintCause.js'
import { normalizeCustomerTier, CUSTOMER_TIER_SOURCE_COLUMN } from '../domain/customerTier.js'

/**
 * @param {Object} row
 * @param {boolean} useRegex
 * @param {import('./storage.js').AppSettings | null} [settings]
 */
export function processRow(row, useRegex = true, settings = null) {
  const rawText = row.rawText?.trim() || ''
  const handlingText = row.handlingText?.trim() || ''
  const taggingText = buildTaggingTextFromFields({
    handlingText,
    rawText,
  })
  const dataSourceType = row.dataSourceType || 'complaint_ticket'
  const responseSource = handlingText || rawText
  const { responseText: extractedResponse } = extractFromRaw(responseSource, useRegex)
  const responseText = row.responseText?.trim() || extractedResponse || undefined

  const specRaw = row.productSpec?.trim() || row.product?.trim() || ''
  const resolved = resolveProductFromSpec(specRaw)
  if (!resolved.inScope) return null

  const taxonomyKey = resolved.taxonomyKey || resolved.productKey

  const tags = analyzeTicket(
    {
      rawText,
      handlingText,
      customerQuote: '',
      product: resolved.productName,
      productKey: taxonomyKey,
      resourcePool: row.resourcePool,
      rootCauseCol: row.rootCauseCol,
      solutionCol: responseText,
      sourceColumns: row.sourceColumns,
    },
    settings,
  )

  const recordId = crypto.randomUUID()
  const taxonomy = getTaxonomy(resolved.productName, taxonomyKey)
  captureProblemTypeCandidateIfNeeded({
    problemType: tags.problemType,
    problemTypes: taxonomy.problemTypes,
    recordId,
    sourceText: taggingText,
  })
  captureRequestSceneCandidateIfNeeded({
    requestScene: tags.requestScene,
    requestScenes: taxonomy.requestScenes,
    recordId,
    sourceText: taggingText,
  })

  const importMeta = pickImportRowMeta(row)
  const sourceColumns = buildSourceColumns(row)
  const complaintCauseFields = assignComplaintCauseFieldsForImport(row, dataSourceType)

  return {
    id: recordId,
    ...importMeta,
    sourceColumns,
    ...complaintCauseFields,
    source: row.source?.trim() || '工单',
    rawText: [rawText, handlingText ? `【处理意见】\n${handlingText}` : ''].filter(Boolean).join('\n\n'),
    handlingText: handlingText || undefined,
    customerQuote: tags.customerRequest || '',
    customerRequest: tags.customerRequest,
    customerRequestSource: tags.customerRequestSource,
    painPoint: tags.painPoint,
    painPointSource: tags.painPointSource,
    responseText,
    createdAt:
      normalizeCreatedAt(row.createdAt) ||
      row.createdAt?.trim() ||
      new Date().toISOString().slice(0, 10),
    product: resolved.productName,
    productSpec: resolved.productSpec,
    productKey: canonicalTaxonomyKey(resolved.taxonomyKey || tags.productKey),
    version: row.version?.trim() || undefined,
    ticketId: normalizeTicketId(row.ticketId),
    resourcePool: tags.resourcePool || row.resourcePool?.trim(),
    customerTier: normalizeCustomerTier(row.customerTierCol || row.customerTier),
    requestScene: tags.requestScene,
    problemType: tags.problemType,
    journeyL1: tags.journeyL1,
    journeyL2: tags.journeyL2,
    problemSummary: tags.problemSummary,
    solutionSummary: tags.solutionSummary,
    rootCause: tags.rootCause,
    optimizationSuggestion: tags.optimizationSuggestion,
    optimizationProduct: tags.optimizationProduct,
    optimizationService: tags.optimizationService,
    optimizationSource: tags.optimizationSource,
    sentiment: tags.sentiment,
    urgencyLevel: tags.urgencyLevel,
    themes: themesFromJourney(tags),
    status: 'open',
    importedAt: importMeta.importedAt || new Date().toISOString(),
  }
}

export function processRows(rows, useRegex = true, settings = null) {
  return rows
    .filter((r) => (r.handlingText || r.rawText)?.trim())
    .map((r) => processRow(r, useRegex, settings))
    .filter(Boolean)
}

/**
 * 对已有反馈记录重新跑打标流水线（保留 id、状态、备注、导入时间）
 * @param {import('./types.js').FeedbackRecord} fb
 * @param {import('./storage.js').AppSettings | null} [settings]
 * @param {{ forceOverrideManualTags?: boolean }} [options]
 */
export function reprocessFeedbackRecord(fb, settings = null, options = {}) {
  const useRegex = settings?.useRegex ?? true
  const source = options.forceOverrideManualTags ? applyForceRetagOverrides(fb) : fb
  const processed = processRow(
    {
      rawText: source.rawText,
      handlingText: source.handlingText,
      dataSourceType: source.dataSourceType,
      source: source.source,
      createdAt: source.createdAt,
      productSpec: source.productSpec || source.product,
      resourcePool: source.resourcePool,
      ticketId: source.ticketId,
      responseText: source.responseText || source.solutionSummary,
      rootCauseCol: source.rootCause,
      problemTypeL1FinalCol: source.sourceColumns?.['投诉原因 一级（终判）'],
      problemTypeL2FinalCol: source.sourceColumns?.['投诉原因 二级（终判）'],
      problemTypeL3FinalCol: source.sourceColumns?.['投诉原因 三级（终判）'],
      customerTierCol:
        source.customerTier ||
        source.sourceColumns?.[CUSTOMER_TIER_SOURCE_COLUMN] ||
        source.sourceColumns?.['客户等级'],
    },
    useRegex,
    settings,
  )

  const merged = {
    ...source,
    ...processed,
    id: source.id,
    status: source.status ?? 'open',
    note: source.note,
    manualReviewRootCause: source.manualReviewRootCause ?? '',
    manualReviewSolution: source.manualReviewSolution ?? '',
    manualReviewAction: source.manualReviewAction ?? '',
    manualReviewOptimization: source.manualReviewOptimization ?? '',
    manualTagFields: options.forceOverrideManualTags ? [] : source.manualTagFields,
    complaintCauseL1Final: source.complaintCauseL1Final ?? processed.complaintCauseL1Final,
    complaintCauseL2Final: source.complaintCauseL2Final ?? processed.complaintCauseL2Final,
    complaintCauseL3Final: source.complaintCauseL3Final ?? processed.complaintCauseL3Final,
    customerTier: source.customerTier ?? processed.customerTier,
    sourceColumns: source.sourceColumns,
    importMonth: source.importMonth,
    importBatchId: source.importBatchId,
    importBatchName: source.importBatchName,
    importFileName: source.importFileName,
    importSheetName: source.importSheetName,
    importedAt: source.importedAt,
  }
  return preserveManualTags(source, merged, {
    forceOverride: options.forceOverrideManualTags === true,
  })
}

/**
 * @deprecated 客户原话抽取已停用；情绪分析以客户请求内容、需求痛点为准
 * @param {import('./types.js').FeedbackRecord} fb
 * @param {import('./storage.js').AppSettings | null} [settings]
 */
export function reprocessCustomerQuoteForRecord(fb, settings = null) {
  void settings
  const { sentiment, urgencyLevel } = analyzeTicketSentiment(buildSentimentAnalysisText(fb))
  return {
    ...fb,
    customerQuote: fb.customerRequest?.trim() || fb.customerQuote || '',
    sentiment,
    urgencyLevel,
  }
}
