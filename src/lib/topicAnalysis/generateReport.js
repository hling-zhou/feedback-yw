import { listActionItems } from '../actionItemClient.js'
import { loadVisitRecords } from '../postUseRating/visitRecords.js'
import { collectTopicEvidence } from './collectEvidence.js'
import { buildTopicBrief } from './buildBrief.js'
import { polishTopicAnalysisWithLlm, polishTopicBriefWithLlm } from './llmBrief.js'
import { qualifyTopicEvidenceWithLlm } from './llmQualify.js'

/**
 * @param {object} visit
 * @param {{ customFromMonth?: string, customToMonth?: string, startDate?: string, endDate?: string } | null | undefined} period
 */
function visitInTopicPeriod(visit, period) {
  if (!period) return true
  const ym = String(visit.importMonth || visit.visitMonth || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(ym)) return true
  const from = period.customFromMonth || period.startDate?.slice(0, 7)
  const to = period.customToMonth || period.endDate?.slice(0, 7)
  if (!from || !to) return true
  return ym >= from && ym <= to
}

/**
 * @param {{
 *   adapter?: { getMeta?: Function },
 *   settings?: object,
 *   topic: object,
 *   records?: object[],
 *   period?: object | null,
 *   periodLabel?: string,
 *   supplements?: object[],
 * }} input
 */
export async function generateTopicReportBrief(input) {
  const topic = input.topic
  const records = Array.isArray(input.records) ? input.records : []
  const supplements = Array.isArray(input.supplements) ? input.supplements : []
  const periodLabel = input.periodLabel || '近9个月'

  let visits = []
  try {
    visits = input.adapter ? await loadVisitRecords(input.adapter) : []
    visits = visits.filter((visit) => visitInTopicPeriod(visit, input.period))
  } catch {
    visits = []
  }

  let actionItems = []
  try {
    const result = await listActionItems({
      search: topic.product || topic.problemKey || topic.query || topic.customerName || '',
      limit: 30,
    })
    actionItems = result?.items || []
  } catch {
    actionItems = []
  }

  let evidence = collectTopicEvidence({
    topic,
    records,
    visits,
    actionItems,
    periodLabel,
    period: input.period,
  })
  try {
    evidence = await qualifyTopicEvidenceWithLlm(evidence, input.settings)
  } catch {
    // A semantic qualifier must never block the deterministic report.
  }
  let brief = buildTopicBrief({ evidence, supplements })
  try {
    const llmDecision = await polishTopicBriefWithLlm(brief, input.settings)
    if (llmDecision) {
      brief = buildTopicBrief({
        evidence,
        supplements,
        llmDecision,
        generatedAt: brief.generatedAt,
      })
    }
  } catch {
    // keep rule brief
  }
  try {
    brief = await polishTopicAnalysisWithLlm(brief, input.settings)
  } catch {
    // keep rule chapters
  }
  return brief
}
