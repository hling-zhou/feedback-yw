import { extractFromRaw } from './extract.js'
import {
  extractQuoteForRecord,
  extractQuoteFromFields,
  extractQuoteMetaForRecord,
} from './quoteExtraction.js'
import { analyzeSentiment } from './sentiment.js'
import { themesFromJourney } from './applyThemes.js'
import { tagTicket } from './ticketTagging.js'
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
import { preserveManualTags } from './manualTagFields.js'

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
  const { customerQuote, quoteExtractionVersion } = extractQuoteFromFields(
    {
      rawText,
      handlingText,
      commentText: row.commentText,
      openText: row.openText,
      sourceColumns: row.sourceColumns,
    },
    { dataSourceType, useRegex, settings },
  )
  const responseSource = handlingText || rawText
  const { responseText: extractedResponse } = extractFromRaw(responseSource, useRegex)
  const quoteForAnalysis = customerQuote || rawText
  const sentiment = analyzeSentiment(quoteForAnalysis)
  const responseText = row.responseText?.trim() || extractedResponse || undefined

  const specRaw = row.productSpec?.trim() || row.product?.trim() || ''
  const resolved = resolveProductFromSpec(specRaw)
  if (!resolved.inScope) return null

  const taxonomyKey = resolved.taxonomyKey || resolved.productKey

  const tags = tagTicket(
    {
      rawText: taggingText,
      product: resolved.productName,
      productKey: taxonomyKey,
      resourcePool: row.resourcePool,
      rootCauseCol: row.rootCauseCol,
      solutionCol: responseText,
    },
    {
      useRequestNodeForJourney: settings?.useRequestNodeForJourney === true,
    },
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

  return {
    id: recordId,
    ...importMeta,
    sourceColumns,
    source: row.source?.trim() || '工单',
    rawText: [rawText, handlingText ? `【处理意见】\n${handlingText}` : ''].filter(Boolean).join('\n\n'),
    handlingText: handlingText || undefined,
    customerQuote: quoteForAnalysis,
    quoteExtractionVersion,
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
    requestScene: tags.requestScene,
    problemType: tags.problemType,
    journeyL1: tags.journeyL1,
    journeyL2: tags.journeyL2,
    problemSummary: tags.problemSummary,
    solutionSummary: tags.solutionSummary,
    rootCause: tags.rootCause,
    optimizationSuggestion: tags.optimizationSuggestion,
    sentiment,
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
 */
export function reprocessFeedbackRecord(fb, settings = null) {
  const useRegex = settings?.useRegex ?? true
  const processed = processRow(
    {
      rawText: fb.rawText,
      handlingText: fb.handlingText,
      dataSourceType: fb.dataSourceType,
      source: fb.source,
      createdAt: fb.createdAt,
      productSpec: fb.productSpec || fb.product,
      resourcePool: fb.resourcePool,
      ticketId: fb.ticketId,
      responseText: fb.responseText || fb.solutionSummary,
      rootCauseCol: fb.rootCause,
      problemTypeCol: fb.problemType,
    },
    useRegex,
    settings,
  )

  const merged = {
    ...fb,
    ...processed,
    id: fb.id,
    status: fb.status ?? 'open',
    note: fb.note,
    manualReviewRootCause: fb.manualReviewRootCause ?? '',
    manualReviewSolution: fb.manualReviewSolution ?? '',
    manualReviewAction: fb.manualReviewAction ?? '',
    manualTagFields: fb.manualTagFields,
    sourceColumns: fb.sourceColumns,
    importMonth: fb.importMonth,
    importBatchId: fb.importBatchId,
    importBatchName: fb.importBatchName,
    importFileName: fb.importFileName,
    importSheetName: fb.importSheetName,
    importedAt: fb.importedAt,
  }
  return preserveManualTags(fb, merged)
}

/**
 * 仅按当前团队规则重算 customerQuote 与用户情绪（不重打四维标签）
 * @param {import('./types.js').FeedbackRecord} fb
 * @param {import('./storage.js').AppSettings | null} [settings]
 */
export function reprocessCustomerQuoteForRecord(fb, settings = null) {
  const { customerQuote, quoteExtractionVersion } = extractQuoteMetaForRecord(fb, settings)
  const sentiment = analyzeSentiment(customerQuote)
  return { ...fb, customerQuote, sentiment, quoteExtractionVersion }
}
