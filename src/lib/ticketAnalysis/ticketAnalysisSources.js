/** @typedef {'rule' | 'llm' | 'manual' | 'import'} TicketAnalysisFieldSource */

import { getEstablishedActionDisplay } from '../../domain/establishedAction.js'
import { getManualTagFields } from '../manualTagFields.js'
import { recordHasUnknownJourney } from '../journeySemantic.js'
import { resolveJourneyLlmSkipScoreThreshold } from '../journeyMatchConfidence.js'

export const TICKET_ANALYSIS_SOURCE_LABELS = {
  rule: '规则',
  llm: '大模型',
  manual: '人工',
  import: '人工',
}

/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

const TICKET_LIKE_SOURCES = /** @type {const} */ (['complaint_ticket', 'consultation_ticket'])

/**
 * 投诉/咨询工单是否仍缺 LLM 增强（任一：客户请求 / 痛点 / 优化建议 非 llm）
 * @param {FeedbackRecord | null | undefined} record
 */
export function recordNeedsTicketLlmEnrichment(record) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  if (getCustomerRequestSource(record) !== 'llm') return true
  if (getPainPointSource(record) !== 'llm') return true
  if (getOptimizationSource(record) === 'manual') return false
  if (getOptimizationSource(record) !== 'llm') return true
  return false
}

/**
 * 投诉/咨询工单是否已完成 LLM 三件套增强
 * @param {FeedbackRecord | null | undefined} record
 */
export function recordHasFullTicketLlmEnrichment(record) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  return !recordNeedsTicketLlmEnrichment(record)
}

/**
 * @param {FeedbackRecord[]} records
 */
export function countRecordsNeedingTicketLlmEnrichment(records) {
  if (!records?.length) return 0
  return records.filter(recordNeedsTicketLlmEnrichment).length
}

/**
 * 投诉/咨询工单是否仍待旅程 LLM 增强（门控高置信 rule 跳过视为已完成）。
 * @param {FeedbackRecord | null | undefined} record
 * @param {import('../storage.js').AppSettings} [settings]
 */
export function recordNeedsJourneyLlmEnrichment(record, settings) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  if (record?.journeySource === 'llm') return false

  const threshold = resolveJourneyLlmSkipScoreThreshold(settings)
  const score = record?.journeyMatchScore
  if (
    record?.journeySource === 'rule' &&
    typeof score === 'number' &&
    score >= threshold &&
    !recordHasUnknownJourney(record)
  ) {
    return false
  }

  return true
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {import('../storage.js').AppSettings} [settings]
 */
export function recordHasJourneyLlmEnrichment(record, settings) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  return !recordNeedsJourneyLlmEnrichment(record, settings)
}

/**
 * @param {FeedbackRecord[]} records
 * @param {import('../storage.js').AppSettings} [settings]
 */
export function countRecordsNeedingJourneyLlmEnrichment(records, settings) {
  if (!records?.length) return 0
  return records.filter((r) => recordNeedsJourneyLlmEnrichment(r, settings)).length
}

/**
 * @param {FeedbackRecord[]} before
 * @param {FeedbackRecord[]} after
 * @param {import('../storage.js').AppSettings} [settings]
 */
export function computeJourneyEnrichmentDelta(before, after, settings) {
  let completed = 0
  let skippedByGating = 0
  for (let i = 0; i < after.length; i++) {
    const prev = before[i]
    const next = after[i]
    if (next.journeySource === 'llm' && prev.journeySource !== 'llm') {
      completed++
      continue
    }
    if (
      next.journeySource === 'rule' &&
      recordNeedsJourneyLlmEnrichment(prev, settings) &&
      !recordNeedsJourneyLlmEnrichment(next, settings)
    ) {
      skippedByGating++
    }
  }
  return { journeyLlmCompleted: completed, journeySkippedByGating: skippedByGating }
}

/**
 * 库内 manual/import → UI「人工」；其余按 rule/llm 展示。
 *
 * @param {TicketAnalysisFieldSource | string | undefined | null} storedSource
 * @returns {'rule' | 'llm' | 'manual'}
 */
export function normalizeTicketAnalysisFieldSource(storedSource) {
  if (storedSource === 'llm') return 'llm'
  if (storedSource === 'manual' || storedSource === 'import') return 'manual'
  return 'rule'
}

/**
 * @param {import('../types.js').FeedbackRecord | null | undefined} record
 * @param {'customerRequest' | 'painPoint'} dimension
 * @param {() => string} readContent
 * @returns {'rule' | 'llm' | 'manual'}
 */
function getManualDimensionAnalysisSource(record, dimension, readContent) {
  const normalized = normalizeTicketAnalysisFieldSource(
    dimension === 'customerRequest'
      ? record?.customerRequestSource
      : record?.painPointSource,
  )
  if (normalized !== 'rule') return normalized
  if (getManualTagFields(record).includes(dimension) && readContent().trim()) {
    return 'manual'
  }
  return 'rule'
}

/**
 * @param {TicketAnalysisFieldSource | string | undefined | null} source
 */
export function getTicketAnalysisSourceLabel(source) {
  if (!source) return TICKET_ANALYSIS_SOURCE_LABELS.rule
  if (source === 'manual' || source === 'import') return TICKET_ANALYSIS_SOURCE_LABELS.manual
  return TICKET_ANALYSIS_SOURCE_LABELS[source] || String(source)
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getPainPointSource(record) {
  return getManualDimensionAnalysisSource(record, 'painPoint', () =>
    getDisplayPainPoint(record),
  )
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getCustomerRequestSource(record) {
  return getManualDimensionAnalysisSource(record, 'customerRequest', () =>
    getDisplayCustomerRequest(record),
  )
}

/**
 * 优化建议来源：确立举措优先 → 人工；否则读 optimizationSource（import/manual → 人工）。
 *
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getOptimizationSource(record) {
  if (getEstablishedActionDisplay(record)) {
    return 'manual'
  }
  return normalizeTicketAnalysisFieldSource(record?.optimizationSource)
}

/**
 * 自动生成优化建议来源：仅读 optimizationSource，不含人工复核/确立举措。
 *
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getAutoOptimizationSource(record) {
  return normalizeTicketAnalysisFieldSource(record?.optimizationSource)
}

/**
 * @param {'rule' | 'llm' | 'manual' | 'import'} source
 */
export function getOptimizationSourceLabel(source) {
  if (source === 'manual' || source === 'import') return '人工'
  return getTicketAnalysisSourceLabel(source)
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getDisplayCustomerRequest(record) {
  return record?.customerRequest?.trim() || ''
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getDisplayPainPoint(record) {
  return record?.painPoint?.trim() || record?.problemSummary?.trim() || ''
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function formatListOptimizationPreview(record) {
  const product = record?.optimizationProduct?.trim()
  const service = record?.optimizationService?.trim()
  if (product && service) return `${product}；${service}`
  return product || service || record?.optimizationSuggestion?.trim() || ''
}

/**
 * 「常见优化建议」聚合用文案：确立举措优先，否则产品/服务优化建议（自动）。
 *
 * @param {import('../types.js').FeedbackRecord | null | undefined} record
 */
export function getCommonOptimizationText(record) {
  const established = getEstablishedActionDisplay(record)
  if (established) return established
  return formatListOptimizationPreview(record)
}
