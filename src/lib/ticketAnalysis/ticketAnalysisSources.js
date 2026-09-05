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
  learned: '学习规则',
}

/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

const TICKET_LIKE_SOURCES = /** @type {const} */ (['complaint_ticket', 'consultation_ticket'])

/** @typedef {'requestScene' | 'problemType' | 'sentiment'} RuleManualDimension */

/** @type {Record<string, string>} */
export const TICKET_LLM_FILTER_HINTS = {
  '':
    '不按打标增强进度筛选，显示当前周期内全部工单（含非投诉/咨询来源）。',
  needs_llm:
    '投诉/咨询工单中，客户请求内容或需求痛点至少有一项的来源不是「大模型」（含规则初标、人工编辑、导入回写）。常见原因：导入时未配置 API Key、LLM 调用失败或尚未补打。不含优化建议；用户旅程请用「待增强 · 用户旅程」筛选。',
  full_llm:
    '投诉/咨询工单中，客户请求内容与需求痛点的来源均为「大模型」。不含优化建议与用户旅程；旅程是否完成增强请查看详情来源 Tag 或「待增强 · 用户旅程」筛选。',
  needs_journey_llm:
    '投诉/咨询工单中，用户旅程尚未经大模型增强，且未满足「规则匹配置信度高且非未识别环节」而自动跳过的条件。详情中人工修改过的用户旅程视为已完成，不会出现在本项。',
}

/** @type {{ label: string; value: string; title?: string }[]} */
export const TICKET_LLM_FILTER_OPTIONS = [
  { label: '全部LLM增强进度', value: '', title: TICKET_LLM_FILTER_HINTS[''] },
  {
    label: '待增强 · 请求/痛点',
    value: 'needs_llm',
    title: TICKET_LLM_FILTER_HINTS.needs_llm,
  },
  {
    label: '已增强 · 请求/痛点',
    value: 'full_llm',
    title: TICKET_LLM_FILTER_HINTS.full_llm,
  },
  {
    label: '待增强 · 用户旅程',
    value: 'needs_journey_llm',
    title: TICKET_LLM_FILTER_HINTS.needs_journey_llm,
  },
]

/**
 * 投诉/咨询工单：客户请求、痛点展示来源均为「人工」。
 * @param {FeedbackRecord | null | undefined} record
 */
export function recordHasManualTicketAnalysisPair(record) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  return (
    getCustomerRequestSource(record) === 'manual' &&
    getPainPointSource(record) === 'manual'
  )
}

/** @deprecated 使用 recordHasManualTicketAnalysisPair */
export function recordHasManualTicketAnalysisTrio(record) {
  return recordHasManualTicketAnalysisPair(record)
}

/**
 * @param {FeedbackRecord[]} records
 */
export function countRecordsWithManualTicketAnalysisPair(records) {
  if (!records?.length) return 0
  return records.filter(recordHasManualTicketAnalysisPair).length
}

/** @deprecated 使用 countRecordsWithManualTicketAnalysisPair */
export function countRecordsWithManualTicketAnalysisTrio(records) {
  return countRecordsWithManualTicketAnalysisPair(records)
}

/**
 * 投诉/咨询工单是否仍缺 LLM 增强（客户请求或痛点展示来源非 llm）。
 * 优化建议不参与判定；用户旅程见 recordNeedsJourneyLlmEnrichment。
 * @param {FeedbackRecord | null | undefined} record
 */
export function recordNeedsTicketLlmEnrichment(record) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  if (getCustomerRequestSource(record) !== 'llm') return true
  if (getPainPointSource(record) !== 'llm') return true
  return false
}

/**
 * 投诉/咨询工单是否已完成客户请求 + 痛点 LLM 增强。
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
  if (getManualTagFields(record).includes('journey')) return false
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
 * 用户旅程展示来源：人工维护优先，其次 llm / 规则。
 * @param {FeedbackRecord | null | undefined} record
 * @returns {'rule' | 'llm' | 'manual'}
 */
export function getJourneyDisplaySource(record) {
  if (getManualTagFields(record).includes('journey')) return 'manual'
  if (record?.journeySource === 'llm') return 'llm'
  return 'rule'
}

/**
 * 请求场景 / 问题类型 / 用户情绪：仅规则或人工（无 LLM 来源字段）。
 * @param {FeedbackRecord | null | undefined} record
 * @param {RuleManualDimension} dimension
 * @returns {'rule' | 'manual'}
 */
export function getRuleManualDimensionSource(record, dimension) {
  if (getManualTagFields(record).includes(dimension)) return 'manual'
  if (
    (dimension === 'requestScene' || dimension === 'problemType') &&
    record?.lastAutoTags?.overlayHits?.includes(dimension)
  ) {
    return 'learned'
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
 * 自动优化建议来源（规则/大模型）；确立举措等人工维护字段不参与 LLM 状态筛选。
 *
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getAutoOptimizationSource(record) {
  return normalizeTicketAnalysisFieldSource(record?.optimizationSource)
}

/** @deprecated 同 getAutoOptimizationSource；优化建议不参与 LLM 状态筛选 */
export function getOptimizationSource(record) {
  return getAutoOptimizationSource(record)
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
