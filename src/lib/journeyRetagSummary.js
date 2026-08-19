import {
  catalogHasJourneyOptions,
  recordHasUnknownJourney,
  recordTaxonomyKey,
} from './journeySemantic.js'
import { resolveJourneyTaggingText } from './ticketAnalysis/dimensionTaggingText.js'
import { buildTaggingTextForRecord } from './taggingText.js'
import { BULK_RETAG_SCOPE_LABELS } from './retagSession.js'
import { formatTicketLlmRemainRuleMessage } from './importEnrichmentStats.js'
import { getProductByKey } from './taxonomyLoader.js'
import Papa from 'papaparse'

/** @typedef {'empty_text' | 'short_text' | 'no_journey_catalog' | 'unmatched'} UnknownJourneyReason */

/** @type {Record<UnknownJourneyReason, string>} */
export const UNKNOWN_JOURNEY_REASON_LABELS = {
  empty_text: '打标正文为空（无处理意见/受理内容/客户原话）',
  short_text: '打标正文过短，难以判断旅程阶段',
  no_journey_catalog: '产品未配置用户旅程模板（或模板无二级环节）',
  unmatched: '正文与旅程模板均无法匹配（本地与 LLM 均判为未识别）',
}

/**
 * @param {import('./types.js').FeedbackRecord} record
 */
export function journeyTaggingText(record) {
  return resolveJourneyTaggingText(record) || buildTaggingTextForRecord(record)
}

/**
 * @param {import('./types.js').FeedbackRecord} record
 * @returns {UnknownJourneyReason}
 */
export function diagnoseUnknownJourneyReason(record) {
  const text = journeyTaggingText(record)
  if (!text) return 'empty_text'
  if (text.length < 15) return 'short_text'
  const key = recordTaxonomyKey(record)
  const journeys = getProductByKey(key)?.journeys || []
  if (!catalogHasJourneyOptions(journeys)) return 'no_journey_catalog'
  return 'unmatched'
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 */
export function listUnknownJourneyRecords(records) {
  return records.filter(recordHasUnknownJourney)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 */
export function summarizeUnknownJourneyRecords(records) {
  const unknownRecords = listUnknownJourneyRecords(records)
  /** @type {Record<UnknownJourneyReason, number>} */
  const reasons = {
    empty_text: 0,
    short_text: 0,
    no_journey_catalog: 0,
    unmatched: 0,
  }
  for (const record of unknownRecords) {
    reasons[diagnoseUnknownJourneyReason(record)] += 1
  }
  return {
    count: unknownRecords.length,
    reasons,
    samples: unknownRecords.slice(0, 5).map((record) => ({
      id: record.id,
      ticketId: record.ticketId,
      product: record.product,
      importMonth: record.importMonth,
      reason: diagnoseUnknownJourneyReason(record),
    })),
  }
}

/** 重打标后若痛点变更达到阈值，提示刷新洞察（P0-3） */
export const RETAG_PAIN_POINT_REFRESH_MIN_CHANGED = 3
export const RETAG_PAIN_POINT_REFRESH_MIN_RATE = 0.05

/**
 * @param {{ id: string; painPoint?: string }[]} beforeRecords
 * @param {{ id: string; painPoint?: string }[]} afterRecords
 */
export function summarizeRetagPainPointChanges(beforeRecords, afterRecords) {
  const beforeById = new Map(
    beforeRecords.map((record) => [record.id, (record.painPoint || '').trim()]),
  )
  let changed = 0
  let newlyFilled = 0
  let cleared = 0

  for (const after of afterRecords) {
    const before = beforeById.get(after.id)
    if (before === undefined) continue
    const afterPain = (after.painPoint || '').trim()
    if (before === afterPain) continue
    changed += 1
    if (!before && afterPain) newlyFilled += 1
    if (before && !afterPain) cleared += 1
  }

  const total = afterRecords.length
  const changeRate = total > 0 ? changed / total : 0
  const shouldPromptInsightRefresh =
    changed > 0 &&
    (changed >= RETAG_PAIN_POINT_REFRESH_MIN_CHANGED ||
      changeRate >= RETAG_PAIN_POINT_REFRESH_MIN_RATE)

  return {
    changed,
    total,
    changeRate,
    newlyFilled,
    cleared,
    shouldPromptInsightRefresh,
  }
}

/**
 * @param {{
 *   total: number
 *   beforeUnknown: number
 *   afterUnknown: number
 *   summary: ReturnType<typeof summarizeUnknownJourneyRecords>
 *   painPointDelta?: ReturnType<typeof summarizeRetagPainPointChanges>
 *   ticketLlmCompleted?: number
 *   ticketLlmFailed?: number
 * }} result
 */
export function formatBulkRetagResultMessage(result) {
  const { total, beforeUnknown, afterUnknown, summary, scope } = result
  const resolved = Math.max(0, beforeUnknown - afterUnknown)
  const scopeLabel = scope && scope !== 'all' ? BULK_RETAG_SCOPE_LABELS[scope] : null
  const lines = [
    scopeLabel
      ? `已完成 ${total} 条工单的四维重新打标（${scopeLabel}）。`
      : `已完成 ${total} 条工单的四维重新打标。`,
    `用户旅程：原先未识别 ${beforeUnknown} 条 → 现仍 ${afterUnknown} 条${
      resolved > 0 ? `（新识别 ${resolved} 条）` : ''
    }。`,
  ]
  const ticketLlmMsg = formatTicketLlmRemainRuleMessage(result.ticketLlmFailed ?? 0)
  if (ticketLlmMsg) {
    lines.push('')
    lines.push(ticketLlmMsg)
  }
  if (afterUnknown > 0) {
    lines.push('')
    lines.push('仍未能识别的主要原因：')
    for (const [key, count] of Object.entries(summary.reasons)) {
      if (!count) continue
      lines.push(`· ${UNKNOWN_JOURNEY_REASON_LABELS[key]}：${count} 条`)
    }
  }
  const painDelta = result.painPointDelta
  if (painDelta?.changed > 0) {
    lines.push('')
    lines.push(
      `需求痛点：${painDelta.changed} 条已变更（占 ${Math.round(painDelta.changeRate * 100)}%）。`,
    )
    if (painDelta.shouldPromptInsightRefresh) {
      lines.push('行动建议依赖痛点聚类，请刷新洞察工作台以同步最新结果。')
    }
  }
  return lines.join('\n')
}

/**
 * @param {Parameters<typeof formatBulkRetagResultMessage>[0]} result
 */
export function formatBulkRetagResultShort(result) {
  const { total, beforeUnknown, afterUnknown } = result
  const resolved = Math.max(0, beforeUnknown - afterUnknown)
  let line = `已完成 ${total} 条四维重新打标`
  if (beforeUnknown > 0 || afterUnknown > 0) {
    line += `；未识别旅程 ${beforeUnknown} → ${afterUnknown}`
    if (resolved > 0) line += `（新识别 ${resolved} 条）`
  }
  return line
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 */
export function unknownJourneyRecordsToExportRows(records) {
  return listUnknownJourneyRecords(records).map((record) => {
    const reason = diagnoseUnknownJourneyReason(record)
    return {
      工单号: record.ticketId || '',
      产品: record.product || '',
      数据月份: record.importMonth || '',
      问题摘要: (record.problemSummary || '').slice(0, 300),
      打标正文: journeyTaggingText(record).slice(0, 500),
      未识别原因: UNKNOWN_JOURNEY_REASON_LABELS[reason],
    }
  })
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {string} [filename]
 * @returns {boolean} 是否有可导出的行
 */
export function downloadUnknownJourneyCsv(records, filename = '未识别旅程样本.csv') {
  const rows = unknownJourneyRecordsToExportRows(records)
  if (!rows.length) return false
  const csv = Papa.unparse(rows)
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return true
}
