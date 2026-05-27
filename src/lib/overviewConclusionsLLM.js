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

/** @typedef {import('../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/overviewConclusions.js').OverviewConclusionHighlight} OverviewConclusionHighlight */

const DEFAULT_MODEL = 'gpt-4o-mini'
const MIN_SUMMARY_LENGTH = PLANNING_RECOMMENDATION_LIMITS.minSummaryLength
const MAX_RECOMMENDATIONS = PLANNING_RECOMMENDATION_LIMITS.maxItems

/**
 * @param {OverviewConclusions} conclusions
 */
export function buildLlmContextPayload(conclusions) {
  return {
    periodLabel: conclusions.periodLabel,
    sampleSize: conclusions.sampleSize,
    executiveSummary: conclusions.executiveSummary,
    dataCoverageNotes: conclusions.dataCoverageNotes || [],
    highlights: (conclusions.highlights || []).map((h) => ({
      id: h.id,
      type: h.type,
      title: h.title,
      body: h.body,
      metrics: h.metrics,
    })),
    recommendations: (conclusions.recommendations || []).map((r) => ({
      id: r.id,
      text: r.text,
      summary: r.summary,
      details: r.details,
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
 * @param {{ summary?: string; text?: string; details?: string[] }} llmPatch
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

  let details = ruleRec.details
  if (Array.isArray(llmPatch.details) && llmPatch.details.length) {
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
    userOverride: ruleRec.userOverride,
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
      JSON.stringify(polished.details) !== JSON.stringify(ruleRec.details)

    return changed
      ? { ...polished, measureSource: 'AI 润色' }
      : sanitizePlanningRecommendation(ruleRec)
  })

  return dedupeRecommendationsSemantically(merged, MAX_RECOMMENDATIONS)
}

/**
 * @param {OverviewConclusionHighlight[]} ruleHighlights
 * @param {unknown[]} llmHighlights
 * @returns {OverviewConclusionHighlight[]}
 */
export function mergePolishedHighlights(ruleHighlights, llmHighlights) {
  if (!Array.isArray(llmHighlights) || !llmHighlights.length) {
    return ruleHighlights
  }

  const bodyById = new Map(
    llmHighlights
      .filter((h) => h?.id && h?.body)
      .map((h) => [h.id, { title: h.title, body: h.body }]),
  )

  return ruleHighlights.map((h) => {
    const patch = bodyById.get(h.id)
    if (!patch) return h
    return {
      ...h,
      title: patch.title?.trim() || h.title,
      body: patch.body.trim(),
      metrics: h.metrics,
    }
  })
}

/**
 * @param {OverviewConclusions} conclusions
 * @param {Record<string, unknown>} parsed
 * @returns {OverviewConclusions}
 */
/**
 * @param {OverviewConclusions} conclusions
 * @param {Record<string, unknown>} parsed
 * @param {{ includeRecommendations?: boolean }} [opts]
 */
export function applyLlmPolishToConclusions(conclusions, parsed, opts = {}) {
  const includeRecommendations = opts.includeRecommendations !== false
  const ruleExecutiveSummary = conclusions.executiveSummary
  const highlights = mergePolishedHighlights(conclusions.highlights || [], parsed.highlights)
  const recList = parsed.recommendations || parsed.measures || parsed.items
  const recommendations = includeRecommendations
    ? limitPlanningRecommendations(
        Array.isArray(recList)
          ? mergePolishedRecommendations(conclusions.recommendations || [], recList)
          : (conclusions.recommendations || []).map((r) => sanitizePlanningRecommendation(r)),
      )
    : conclusions.recommendations || []

  const polishedRecIds = includeRecommendations
    ? recommendations
        .filter((r) => r.measureSource === 'AI 润色')
        .map((r) => r.id)
    : []

  return {
    ...conclusions,
    source: 'hybrid',
    ruleExecutiveSummary,
    executiveSummary:
      typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
        ? parsed.executiveSummary.trim()
        : ruleExecutiveSummary,
    highlights,
    recommendations,
    llmPolishedAt: new Date().toISOString(),
    recommendationsLlm: includeRecommendations
      ? {
          polishedAt: new Date().toISOString(),
          itemIds: polishedRecIds,
        }
      : conclusions.recommendationsLlm,
  }
}

/**
 * @param {OverviewConclusions} conclusions
 * @param {import('./storage.js').AppSettings} settings
 * @returns {Promise<OverviewConclusions>}
 */
/**
 * @param {OverviewConclusions} conclusions
 * @param {import('./storage.js').AppSettings} settings
 * @param {{ includeRecommendations?: boolean }} [opts]
 */
export async function polishOverviewConclusionsWithLLM(conclusions, settings, opts = {}) {
  if (!canUseSemanticMatch(settings)) {
    throw new Error('服务端未配置 LLM（LLM_API_KEY），无法润色结论')
  }
  if (conclusions.insufficientData) {
    return conclusions
  }

  const ctx = buildLlmContextPayload(conclusions)

  const systemPrompt = `你是移动云用户反馈洞察分析师，面向产品规划与体验改进负责人撰写「周期洞察概览」。

要求：
1. 基于输入的规则聚合结论与指标，输出更易读、可决策的中文表述；不得编造输入中不存在的数据、产品名称、工单号或数量。
2. executiveSummary：2～4 句，概括体量、核心问题、旅程热点、风险与建议方向。
3. highlights：按 id 逐条润色 body（title 可微调），保持 metrics 含义不变，每条 body 80～160 字。
4. recommendations：${opts.includeRecommendations === false ? '本次不需要输出 recommendations 字段。' : '必须对输入中的每一条规则建议逐条润色（id 一一对应，不可遗漏）；仅润色 summary 与 details。'}
${opts.includeRecommendations === false ? '' : buildPlanningRecommendationLlmRules()}
5. 禁止空泛套话（如「持续关注」「纳入规划」而无实质内容）。
6. 只返回 JSON：
{
  "executiveSummary": "string",
  "highlights": [{"id":"string","title":"string","body":"string"}],
  ${opts.includeRecommendations === false ? '' : '"recommendations": [{"id":"string","summary":"string","details":["string",...]}, ...]'}
}`

  const userPrompt = `洞察周期：${ctx.periodLabel}
工单样本：${ctx.sampleSize} 条
数据说明：${ctx.dataCoverageNotes.join('；') || '无'}

【规则摘要】
${ctx.executiveSummary}

【分维度结论】
${ctx.highlights.map((h) => `- [${h.id}] ${h.title}：${h.body}`).join('\n')}

${
  opts.includeRecommendations === false
    ? ''
    : `【规则行动建议】（润色时保留 id，勿改 priority/category/工单依据）
${ctx.recommendations
  .map(
    (r, i) =>
      `${i + 1}. id=${r.id} [${r.priority}/${r.category}] ${r.summary || r.text}${
        r.details?.length ? `\n   详细：${r.details.join('；')}` : ''
      }${r.evidenceNote ? `\n   依据说明：${r.evidenceNote}` : ''}${
        r.evidenceTicketIds?.length ? `\n   工单：${r.evidenceTicketIds.join('、')}` : ''
      }`,
  )
  .join('\n') || '无'}`
}

请润色并输出 JSON。`

  const data = await llmChatCompletion(settings, {
    model: settings.llmModel || DEFAULT_MODEL,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  return applyLlmPolishToConclusions(conclusions, parsed, opts)
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
  const systemPrompt = `你是移动云产品规划顾问，仅润色「行动建议」的概述与详细意见。
${buildPlanningRecommendationLlmRules()}
禁止修改 id、priority、category、scope、evidence 相关字段；不得编造工单号或数量。
只返回 JSON：{"recommendations":[{"id":"string","summary":"string","details":["string"]}]}`

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
    model: settings.llmModel || DEFAULT_MODEL,
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
      model: settings.llmModel || DEFAULT_MODEL,
      itemIds: polishedIds,
    },
  }
}
