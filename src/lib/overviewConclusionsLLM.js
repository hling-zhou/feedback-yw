import { canUseSemanticMatch } from './themeSemantic.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from './llmClient.js'
import {
  dedupeRecommendationsSemantically,
  isStatsOrDescriptiveText,
  limitPlanningRecommendations,
  sanitizePlanningRecommendation,
} from './planningRecommendations.js'
import { buildPlanningRecommendationLlmRules, PLANNING_RECOMMENDATION_LIMITS } from './planningRecommendationTemplate.js'
import { isGenericRecommendationText } from './journeyOptimizationLLM.js'
import {
  mergePolishedPlanningSections,
  sectionsToLegacyDetails,
} from './planningRecommendationSections.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */

const MIN_SUMMARY_LENGTH = PLANNING_RECOMMENDATION_LIMITS.minSummaryLength
const MAX_RECOMMENDATIONS = PLANNING_RECOMMENDATION_LIMITS.maxItems

/**
 * @param {OverviewConclusions} conclusions
 */
export function buildLlmContextPayload(conclusions) {
  return {
    periodLabel: conclusions.periodLabel,
    sampleSize: conclusions.sampleSize,
    dataCoverageNotes: conclusions.dataCoverageNotes || [],
    recommendations: (conclusions.recommendations || []).map((r) => ({
      id: r.id,
      text: r.text,
      summary: r.summary,
      details: r.details,
      productActions: r.sections?.productActions,
      serviceActions: r.sections?.serviceActions,
      priority: r.priority,
      category: r.category,
      evidenceNote: r.evidenceNote,
      evidenceTicketIds: r.evidenceTicketIds,
      metrics: r.metrics,
      scope: r.scope,
      signalType: r.signalType,
      trackingMetrics: r.trackingMetrics,
    })),
  }
}

/**
 * @param {OverviewRecommendation} ruleRec
 * @param {{ summary?: string; text?: string; details?: string[]; productActions?: string[]; serviceActions?: string[] }} llmPatch
 * @returns {OverviewRecommendation}
 */
export function mergePolishedRecommendation(ruleRec, llmPatch) {
  const llmSummary = String(llmPatch.summary || llmPatch.text || '').trim()
  const ruleSummary = (ruleRec.summary || ruleRec.text || '').trim()

  let summary = ruleSummary
  if (
    llmSummary.length >= MIN_SUMMARY_LENGTH &&
    !isStatsOrDescriptiveText(llmSummary) &&
    !isGenericRecommendationText(llmSummary)
  ) {
    summary = llmSummary
  }

  let sections = ruleRec.sections
  let details = ruleRec.details

  if (sections) {
    const patch = {
      summary,
      productActions: Array.isArray(llmPatch.productActions)
        ? llmPatch.productActions
        : undefined,
      serviceActions: Array.isArray(llmPatch.serviceActions)
        ? llmPatch.serviceActions
        : undefined,
    }
    if (!patch.productActions?.length && Array.isArray(llmPatch.details) && llmPatch.details.length) {
      patch.productActions = llmPatch.details.filter((d) => typeof d === 'string' && d.trim())
    }
    sections = mergePolishedPlanningSections(sections, patch)
    summary = sections.executiveSummary || summary
    details = sectionsToLegacyDetails(sections)
  } else if (Array.isArray(llmPatch.details) && llmPatch.details.length) {
    const sanitized = sanitizePlanningRecommendation({
      ...ruleRec,
      summary,
      text: summary,
      details: llmPatch.details
        .filter((d) => typeof d === 'string' && d.trim())
        .map((d) => d.trim()),
    })
    if ((sanitized.details?.length ?? 0) >= 2) {
      details = sanitized.details
    }
  }

  const merged = sanitizePlanningRecommendation({
    ...ruleRec,
    text: summary,
    summary,
    sections,
    details: details || [],
    evidenceRecordIds: ruleRec.evidenceRecordIds,
    evidenceTicketIds: ruleRec.evidenceTicketIds,
    evidenceNote: ruleRec.evidenceNote,
    scope: ruleRec.scope,
    signalType: ruleRec.signalType,
    metrics: ruleRec.metrics,
    trackingMetrics: ruleRec.trackingMetrics,
    priority: ruleRec.priority,
    category: ruleRec.category,
    insufficientEvidence: ruleRec.insufficientEvidence,
    linkedJourneyL2: ruleRec.linkedJourneyL2,
    measureSource: ruleRec.measureSource,
    evidenceStrength: ruleRec.evidenceStrength,
    evidenceBundle: ruleRec.evidenceBundle,
    generationMeta: ruleRec.generationMeta,
    periodCompare: ruleRec.periodCompare,
  })

  if ((merged.summary || merged.text || '').length < MIN_SUMMARY_LENGTH
    || isStatsOrDescriptiveText(merged.summary || merged.text || '')
    || isGenericRecommendationText(merged.summary || merged.text || '')) {
    return sanitizePlanningRecommendation(ruleRec)
  }

  return merged
}

/**
 * @param {OverviewRecommendation[]} ruleRecs
 * @param {unknown[]} llmItems
 * @returns {OverviewRecommendation[]}
 */
export function mergePolishedRecommendations(ruleRecs, llmItems) {
  if (!Array.isArray(llmItems) || !llmItems.length || !ruleRecs.length) {
    return ruleRecs.map((r) => sanitizePlanningRecommendation(r))
  }

  /** @type {Map<string, unknown>} */
  const llmById = new Map()

  for (let i = 0; i < llmItems.length; i++) {
    const item = llmItems[i]
    if (item && typeof item === 'object' && item.id) {
      llmById.set(item.id, item)
    } else if (typeof item === 'string' && ruleRecs[i]) {
      llmById.set(ruleRecs[i].id, { summary: item })
    } else if (ruleRecs[i]) {
      llmById.set(ruleRecs[i].id, item)
    }
  }

  const merged = ruleRecs.map((ruleRec) => {
    const patch = llmById.get(ruleRec.id)
    if (!patch) {
      return sanitizePlanningRecommendation(ruleRec)
    }

    const polished = mergePolishedRecommendation(ruleRec, patch)
    const changed =
      polished.summary !== (ruleRec.summary || ruleRec.text) ||
      JSON.stringify(polished.details) !== JSON.stringify(ruleRec.details) ||
      JSON.stringify(polished.sections) !== JSON.stringify(ruleRec.sections)

    return changed
      ? { ...polished, measureSource: 'AI 润色' }
      : sanitizePlanningRecommendation(ruleRec)
  })

  return dedupeRecommendationsSemantically(merged, MAX_RECOMMENDATIONS)
}

/**
 * @param {OverviewConclusions} conclusions
 * @param {import('./storage.js').AppSettings} settings
 */
export async function polishPlanningRecommendationsWithLLM(conclusions, settings) {
  if (!canUseSemanticMatch(settings)) {
    throw new Error('服务端未配置 LLM（LLM_API_KEY），无法润色行动建议')
  }
  if (!conclusions.recommendations?.length) {
    throw new Error('当前周期暂无行动建议可润色')
  }

  const ctx = buildLlmContextPayload(conclusions)
  const systemPrompt = `你是移动云产品规划顾问，仅润色「行动建议」的概述与可执行动作行。
${buildPlanningRecommendationLlmRules()}
禁止修改 id、priority、category、scope、evidence、clusterRootCause、verification 相关字段；不得编造工单号或数量。
只返回 JSON：{"recommendations":[{"id":"string","summary":"string","productActions":["string",...],"serviceActions":["string",...]}]}`

  const userPrompt = `洞察周期：${ctx.periodLabel}
工单样本：${ctx.sampleSize} 条

【规则行动建议】
${ctx.recommendations
  .map(
    (r, i) =>
      `${i + 1}. id=${r.id} [${r.priority}/${r.category}] ${r.summary || r.text}${
        r.details?.length ? `\n   详细：${r.details.join('；')}` : ''
      }`,
  )
  .join('\n')}

请逐条润色并输出 JSON。`

  const data = await llmChatCompletion(settings, {
    temperature: 0.3,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const recList = parsed.recommendations || parsed.measures || parsed.items
  const recommendations = limitPlanningRecommendations(
    Array.isArray(recList)
      ? mergePolishedRecommendations(conclusions.recommendations || [], recList)
      : (conclusions.recommendations || []).map((r) => sanitizePlanningRecommendation(r)),
  )
  const polishedIds = recommendations.filter((r) => r.measureSource === 'AI 润色').map((r) => r.id)

  return {
    ...conclusions,
    source: conclusions.source === 'hybrid' ? 'hybrid' : polishedIds.length ? 'hybrid' : conclusions.source,
    recommendations,
    recommendationsLlm: {
      polishedAt: new Date().toISOString(),
      itemIds: polishedIds,
    },
  }
}
