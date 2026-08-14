import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { TOPIC_ANALYSIS_DEMO, TOPIC_TYPE_LABELS } from './constants.js'

/**
 * @param {object} evidence
 * @param {object[]} [supplements]
 */
function supplementHighlights(supplements = []) {
  return supplements.flatMap((item, index) => {
    const notes = Array.isArray(item.notes) ? item.notes.filter(Boolean) : []
    if (notes.length) {
      return notes.slice(0, 8).map((note, noteIndex) => ({
        id: `sup:${item.id || index}:${noteIndex}`,
        kind: 'user_supplement',
        text: String(note).slice(0, 400),
        fileName: item.fileName || '',
      }))
    }
    const text = String(item.text || '').trim()
    if (!text) return []
    return [{
      id: `sup:${item.id || index}:text`,
      kind: 'user_supplement',
      text: text.slice(0, 400),
      fileName: item.fileName || '',
    }]
  })
}

/**
 * @param {object} evidence
 */
function ruleJudgments(evidence) {
  const judgments = []
  if (evidence.total > 0) {
    const topProblem = evidence.problemTypes?.[0]
    const topProduct = evidence.products?.[0]
    const sourceBits = Object.entries(evidence.countsBySource || {}).map(
      ([type, count]) => `${DATA_SOURCE_LABELS[type] || type} ${count} 条`,
    )
    judgments.push({
      id: 'rule-scale',
      kind: 'system_stat',
      text: `当前周期匹配 ${evidence.total} 条系统记录${sourceBits.length ? `（${sourceBits.join('，')}）` : ''}。`,
      sourceIds: (evidence.evidenceIds || []).slice(0, 8),
    })
    if (topProblem) {
      judgments.push({
        id: 'rule-problem',
        kind: 'system_stat',
        text: `最集中的问题类型是「${topProblem.name}」（${topProblem.count} 条${evidence.total ? `，约占 ${Math.round((topProblem.count / evidence.total) * 100)}%` : ''}）。`,
        sourceIds: (evidence.evidenceIds || []).slice(0, 8),
      })
    }
    if (topProduct && evidence.products.length > 1) {
      judgments.push({
        id: 'rule-product',
        kind: 'system_stat',
        text: `涉及 ${evidence.products.length} 个产品，最多的是「${topProduct.name}」（${topProduct.count} 条）。`,
        sourceIds: (evidence.evidenceIds || []).slice(0, 8),
      })
    }
  } else {
    judgments.push({
      id: 'rule-empty',
      kind: 'system_stat',
      text: '系统数据中尚未匹配到足够记录，以下结论主要依赖用户补充材料（如有）。',
      sourceIds: [],
    })
  }
  return judgments
}

/**
 * @param {{ evidence: object, supplements?: object[], llmJudgments?: object[], generatedAt?: string }} input
 */
export function buildTopicBrief(input) {
  const evidence = input.evidence
  const topic = evidence.topic || {}
  const supplements = Array.isArray(input.supplements) ? input.supplements : []
  const supplementItems = supplementHighlights(supplements)
  const llmJudgments = Array.isArray(input.llmJudgments) ? input.llmJudgments : []
  const toSupplement = [...(evidence.gaps || [])]
  if (supplements.length === 0) {
    toSupplement.push('可将本地 Word / Excel / Markdown / PDF 作为补充材料提供给系统，例如产品侧进展、JIRA、拜访结论')
  } else {
    const filled = toSupplement.filter((gap) => /拜访|回访|举措/.test(gap) && supplementItems.length)
    if (filled.length) {
      // keep remaining gaps that supplements likely didn't cover
    }
  }

  return {
    demo: TOPIC_ANALYSIS_DEMO,
    generatedAt: input.generatedAt || new Date().toISOString(),
    topic: {
      ...topic,
      typeLabel: topic.typeLabel || TOPIC_TYPE_LABELS[topic.type] || topic.type,
    },
    scope: {
      periodLabel: evidence.periodLabel,
      matchNote: evidence.matchNote,
      total: evidence.total,
      countsBySource: evidence.countsBySource,
    },
    whyNow: topic.whyNow || '用户指定或系统推荐深入',
    whatHappened: {
      products: evidence.products || [],
      problemTypes: evidence.problemTypes || [],
    },
    quotes: evidence.quotes || [],
    judgments: llmJudgments.length ? llmJudgments : ruleJudgments(evidence),
    llmApplied: llmJudgments.length > 0,
    actions: evidence.actionItems || [],
    supplements,
    supplementItems,
    toSupplement,
    sources: evidence.sources || [],
    visits: evidence.visits || [],
    evidenceIds: evidence.evidenceIds || [],
  }
}

/**
 * @param {object} brief
 */
export function allowedEvidenceIdSet(brief) {
  const ids = new Set()
  for (const id of brief.evidenceIds || []) ids.add(String(id))
  for (const quote of brief.quotes || []) {
    if (quote.id) ids.add(String(quote.id))
    if (quote.recordId) ids.add(String(quote.recordId))
    if (quote.ticketId) ids.add(String(quote.ticketId))
  }
  for (const source of brief.sources || []) {
    if (source.id) ids.add(String(source.id))
    if (source.ticketId) ids.add(String(source.ticketId))
  }
  for (const item of brief.supplementItems || []) {
    if (item.id) ids.add(String(item.id))
  }
  for (const sup of brief.supplements || []) {
    if (sup.id) ids.add(String(sup.id))
  }
  return ids
}
