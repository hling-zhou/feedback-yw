import { normalizeCustomerTier } from '../domain/customerTier.js'
import { getUrgencyLevel, isNegativeSentiment } from './sentiment.js'
import { canUseSemanticMatch } from './themeSemantic.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from './llmClient.js'
import {
  isFallbackReferenceRecommendation,
  isFormalPainClusterRecommendation,
} from './planningRecommendations.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */

const TOP_THEME_LIMIT = 4
const THEME_EVIDENCE_LIMIT = 6
const TICKET_COUNT_SUFFIX_RE = /（\d+ 条工单[^）]*）$/

function painOf(record) {
  return String(record?.painPoint || record?.problemSummary || '').trim()
}

function themeIdOf(recommendation) {
  const stableKey = String(recommendation?.stableKey || '').trim()
  if (stableKey) return stableKey
  const id = String(recommendation?.id || '').trim()
  if (id) return id
  return [
    recommendation?.signalType,
    recommendation?.scope?.product,
    recommendation?.scope?.journeyL1,
    recommendation?.scope?.problemType,
    themeLabelOf(recommendation),
  ].map((value) => String(value || '').trim()).join(':')
}

function themeTypeOf(recommendation) {
  return isFormalPainClusterRecommendation(recommendation) ? 'formal_cluster' : 'fallback_reference'
}

function themeLabelOf(recommendation) {
  const raw = String(recommendation?.summary || recommendation?.text || '未命名主题').trim() || '未命名主题'
  return raw.replace(TICKET_COUNT_SUFFIX_RE, '').trim() || '未命名主题'
}

function tokenize(text) {
  return (String(text || '').match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}/g) || []).map((token) => token.toLowerCase())
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const item of a) if (b.has(item)) overlap += 1
  return overlap / (a.size + b.size - overlap)
}

function buildThemeMatchText(recommendation) {
  return [
    themeLabelOf(recommendation),
    recommendation?.scope?.problemType,
    recommendation?.scope?.journeyL1,
    recommendation?.scope?.journeyL2,
  ].filter(Boolean).join(' ')
}

function isHighValueCustomer(record) {
  const tier = normalizeCustomerTier(record?.customerTier)
  return tier === '金牌' || tier === '银牌'
}

function hasImpactSignal(record) {
  return Boolean(
    isHighValueCustomer(record)
      || isNegativeSentiment(record?.sentiment)
      || getUrgencyLevel(record) === 'high'
      || record?.followUpSatisfaction?.problemResolved === 'unresolved',
  )
}

function buildImpactSignals(records) {
  const rows = records || []
  return {
    highValueCount: rows.filter(isHighValueCustomer).length,
    negativeCount: rows.filter((record) => isNegativeSentiment(record?.sentiment)).length,
    urgentCount: rows.filter((record) => getUrgencyLevel(record) === 'high').length,
    unresolvedCount: rows.filter((record) => record?.followUpSatisfaction?.problemResolved === 'unresolved').length,
  }
}

function impactSignalTags(signals) {
  const tags = []
  if (signals.highValueCount > 0) tags.push('高价值客户')
  if (signals.negativeCount > 0) tags.push('负向情绪')
  if (signals.urgentCount > 0) tags.push('紧急催办')
  if (signals.unresolvedCount > 0) tags.push('回访未解决')
  return tags
}

function computeRiskScore(signals, evidenceCount, themeType) {
  return (
    signals.highValueCount * 3
    + signals.negativeCount * 2
    + signals.urgentCount * 3
    + signals.unresolvedCount * 4
    + Math.min(evidenceCount, 6)
    + (themeType === 'formal_cluster' ? 1 : 0)
  )
}

function riskLevelOf(score) {
  if (score >= 10) return 'high'
  if (score >= 5) return 'medium'
  return 'low'
}

function compareEvidenceRows(a, b) {
  const score = (record) =>
    (record?.followUpSatisfaction?.problemResolved === 'unresolved' ? 4 : 0)
    + (getUrgencyLevel(record) === 'high' ? 3 : 0)
    + (isHighValueCustomer(record) ? 3 : 0)
    + (isNegativeSentiment(record?.sentiment) ? 2 : 0)

  return score(b) - score(a) || String(a?.ticketId || a?.id || '').localeCompare(String(b?.ticketId || b?.id || ''))
}

function weakMatchRecommendation(recommendation, record) {
  const scope = recommendation?.scope || {}
  if (scope.product && String(scope.product).trim() !== String(record?.product || record?.productSpec || '').trim()) {
    return false
  }
  const structureScore =
    (scope.problemType && String(scope.problemType).trim() === String(record?.problemType || '').trim() ? 2 : 0)
    + (scope.journeyL1 && String(scope.journeyL1).trim() === String(record?.journeyL1 || '').trim() ? 2 : 0)
    + (scope.journeyL2 && String(scope.journeyL2).trim() === String(record?.journeyL2 || '').trim() ? 1 : 0)
  const themeTokens = new Set(tokenize(buildThemeMatchText(recommendation)))
  const recordTokens = new Set(tokenize(`${painOf(record)} ${record?.customerRequest || ''} ${record?.problemType || ''}`))
  const textScore = jaccard(themeTokens, recordTokens)
  return structureScore >= 4 || (structureScore >= 2 && textScore >= 0.18) || textScore >= 0.34
}

function dedupeTicketIds(records) {
  const seen = new Set()
  const ticketIds = []
  for (const record of records || []) {
    const ticketId = String(record?.ticketId || '').trim()
    if (!ticketId || seen.has(ticketId)) continue
    seen.add(ticketId)
    ticketIds.push(ticketId)
  }
  return ticketIds
}

/**
 * @param {OverviewRecommendation[]} recommendations
 */
function collectThemeRecommendations(recommendations) {
  return (recommendations || []).filter((recommendation) =>
    isFormalPainClusterRecommendation(recommendation) || isFallbackReferenceRecommendation(recommendation))
}

/**
 * @param {OverviewRecommendation} recommendation
 * @param {Map<string, FeedbackRecord>} recordById
 * @param {FeedbackRecord[]} impactRecords
 */
function buildImpactThemeLink(recommendation, recordById, impactRecords) {
  const linked = new Map()
  for (const id of recommendation?.evidenceRecordIds || []) {
    const record = recordById.get(id)
    if (record && hasImpactSignal(record)) linked.set(record.id, record)
  }

  const desiredEvidence = Number(
    recommendation?.sections?.painClusterScores?.ticketCount
      ?? recommendation?.evidenceBundle?.ticketCount
      ?? 1,
  )
  const minimumEvidence = Math.min(2, Number.isFinite(desiredEvidence) ? Math.max(1, desiredEvidence) : 1)

  if (linked.size < minimumEvidence) {
    for (const record of impactRecords) {
      if (!record?.id || linked.has(record.id)) continue
      if (weakMatchRecommendation(recommendation, record)) linked.set(record.id, record)
      if (linked.size >= Math.max(minimumEvidence, 2)) break
    }
  }

  const rows = [...linked.values()].sort(compareEvidenceRows).slice(0, THEME_EVIDENCE_LIMIT)
  const impactSignals = buildImpactSignals(rows)
  const riskScore = computeRiskScore(impactSignals, rows.length, themeTypeOf(recommendation))
  const clusterRecords = (recommendation?.evidenceRecordIds || [])
    .map((id) => recordById.get(id))
    .filter(Boolean)
  const clusterTicketIds = dedupeTicketIds(clusterRecords)
  const ticketCount = Number(
    recommendation?.sections?.painClusterScores?.ticketCount
      ?? recommendation?.evidenceBundle?.ticketCount
      ?? clusterTicketIds.length
      ?? (recommendation?.evidenceRecordIds || []).length,
  )

  return {
    themeId: themeIdOf(recommendation),
    recommendationId: String(recommendation?.id || '').trim(),
    themeType: themeTypeOf(recommendation),
    themeLabel: themeLabelOf(recommendation),
    product: recommendation?.scope?.product || '',
    ticketCount: Number.isFinite(ticketCount) ? ticketCount : clusterTicketIds.length,
    clusterTicketIds,
    evidenceRecordIds: rows.map((row) => row.id).filter(Boolean),
    evidenceTicketIds: dedupeTicketIds(rows),
    impactSignals,
    topEvidenceRecordIds: rows.map((row) => row.id).filter(Boolean),
    riskScore,
    riskLevel: riskLevelOf(riskScore),
    inferred: themeTypeOf(recommendation) === 'fallback_reference',
  }
}

function buildFocusItemSummary(link) {
  const tags = impactSignalTags(link.impactSignals)
  const reason = []
  if (link.impactSignals.highValueCount) reason.push(`影响 ${link.impactSignals.highValueCount} 条高价值客户反馈`)
  if (link.impactSignals.urgentCount) reason.push(`出现 ${link.impactSignals.urgentCount} 条紧急催办`)
  if (link.impactSignals.unresolvedCount) reason.push(`有 ${link.impactSignals.unresolvedCount} 条回访未解决`)
  if (link.impactSignals.negativeCount) reason.push(`伴随 ${link.impactSignals.negativeCount} 条负向反馈`)
  const tail = reason.length ? reason.join('，') : `当前命中 ${link.evidenceRecordIds.length} 条高风险证据`
  return `${link.themeLabel}${tags.length ? `，${tags.join('、')}` : ''}，${tail}。`
}

function buildExecutiveSummary(focusItems) {
  if (!focusItems.length) return ''
  const top = focusItems[0]
  const tags = top.riskSignals.join('、')
  const extra = focusItems[1]?.themeLabel ? `，其次为「${focusItems[1].themeLabel}」` : ''
  return `当前最需要重点关注的是「${top.themeLabel}」${tags ? `，该主题已同时出现${tags}` : ''}${extra}。`
}

function buildRuleImpactFocusSummary({
  scopeLabel,
  recommendations,
  impactRecords,
  themeLinks,
}) {
  const themes = collectThemeRecommendations(recommendations)
  const linkedThemeLinks = (themeLinks || []).filter((link) => link.evidenceRecordIds.length > 0)
    .sort((a, b) => b.riskScore - a.riskScore || b.evidenceRecordIds.length - a.evidenceRecordIds.length)
  const focusItems = linkedThemeLinks.slice(0, TOP_THEME_LIMIT).map((link) => ({
    themeId: link.themeId,
    themeType: link.themeType,
    themeLabel: link.themeLabel,
    product: link.product,
    riskLevel: link.riskLevel,
    riskScore: link.riskScore,
    riskSignals: impactSignalTags(link.impactSignals),
    summary: buildFocusItemSummary(link),
    evidenceRecordIds: link.evidenceRecordIds,
    evidenceTicketIds: link.evidenceTicketIds,
    inferred: link.inferred,
  }))

  if (focusItems.length) {
    return {
      status: 'linked',
      source: 'rule',
      scopeLabel,
      sampleSize: impactRecords.length,
      executiveSummary: buildExecutiveSummary(focusItems),
      focusItems,
      meta: {
        hasThemes: themes.length > 0,
        hasEvidence: impactRecords.length > 0,
        linkedThemeCount: linkedThemeLinks.length,
      },
    }
  }

  if (themes.length) {
    return {
      status: 'theme_without_evidence',
      source: 'rule',
      scopeLabel,
      sampleSize: impactRecords.length,
      executiveSummary: `当前已识别 ${themes.length} 个主题，但在${scopeLabel || '当前范围'}内暂未命中高价值客户、负向情绪、紧急催办或回访未解决证据。`,
      focusItems: themes.slice(0, TOP_THEME_LIMIT).map((theme) => ({
        themeId: themeIdOf(theme),
        themeType: themeTypeOf(theme),
        themeLabel: themeLabelOf(theme),
        product: theme?.scope?.product || '',
        riskLevel: 'low',
        riskScore: 0,
        riskSignals: [],
        summary: `已识别主题「${themeLabelOf(theme)}」，但当前未挂载高风险证据。`,
        evidenceRecordIds: [],
        evidenceTicketIds: [],
        inferred: themeTypeOf(theme) === 'fallback_reference',
      })),
      meta: {
        hasThemes: true,
        hasEvidence: impactRecords.length > 0,
        linkedThemeCount: 0,
      },
    }
  }

  if (impactRecords.length) {
    return {
      status: 'evidence_only',
      source: 'rule',
      scopeLabel,
      sampleSize: impactRecords.length,
      executiveSummary: `当前未形成稳定主题，以下为${scopeLabel || '当前范围'}内命中的高风险信号证据，可先据此核查重点问题。`,
      focusItems: [],
      meta: {
        hasThemes: false,
        hasEvidence: true,
        linkedThemeCount: 0,
      },
    }
  }

  return {
    status: 'empty',
    source: 'rule',
    scopeLabel,
    sampleSize: 0,
    executiveSummary: `${scopeLabel || '当前范围'}暂无可展示的主题或高风险证据。`,
    focusItems: [],
    meta: {
      hasThemes: false,
      hasEvidence: false,
      linkedThemeCount: 0,
    },
  }
}

/**
 * @param {ReturnType<typeof buildRuleImpactFocusSummary>} ruleSummary
 * @param {unknown} patch
 */
export function mergeImpactFocusSummary(ruleSummary, patch) {
  if (!patch || typeof patch !== 'object') return ruleSummary
  const allowedThemeIds = new Set((ruleSummary?.focusItems || []).map((item) => item.themeId))
  const llmItems = Array.isArray(patch.focusItems) ? patch.focusItems : []
  const mergedItems = ruleSummary.focusItems.map((item) => {
    const llmItem = llmItems.find((candidate) => candidate?.themeId === item.themeId)
    if (!llmItem) return item
    const summary = String(llmItem.summary || '').trim()
    const riskLevel = ['high', 'medium', 'low'].includes(String(llmItem.riskLevel || ''))
      ? String(llmItem.riskLevel)
      : item.riskLevel
    return {
      ...item,
      riskLevel,
      summary: summary || item.summary,
    }
  })

  if (llmItems.some((item) => item?.themeId && !allowedThemeIds.has(item.themeId))) {
    return ruleSummary
  }

  const executiveSummary = String(patch.executiveSummary || '').trim()
  return {
    ...ruleSummary,
    source: mergedItems.some((item, index) => item.summary !== ruleSummary.focusItems[index]?.summary)
      || (executiveSummary && executiveSummary !== ruleSummary.executiveSummary)
      ? 'hybrid'
      : ruleSummary.source,
    executiveSummary: executiveSummary || ruleSummary.executiveSummary,
    focusItems: mergedItems,
  }
}

async function polishImpactFocusSummary(summary, settings) {
  if (!canUseSemanticMatch(settings)) return summary
  if (summary.status !== 'linked' || !summary.focusItems.length) return summary

  const systemPrompt = `你是云产品体验洞察分析师。请围绕既有主题生成“重点关注”总结。
禁止新增主题、禁止修改 themeId、禁止编造工单量或风险信号。
只返回 JSON：
{"executiveSummary":"string","focusItems":[{"themeId":"string","summary":"string","riskLevel":"high|medium|low"}]}`

  const userPrompt = `范围：${summary.scopeLabel || '当前范围'}

已有重点主题：
${summary.focusItems.map((item, index) => `${index + 1}. themeId=${item.themeId}
- 主题：${item.themeLabel}
- 风险等级：${item.riskLevel}
- 风险信号：${item.riskSignals.join('、') || '无'}
- 当前说明：${item.summary}`).join('\n')}

请基于以上主题输出更凝练的“重点关注”总结。`

  try {
    const data = await llmChatCompletion(settings, {
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
    const parsed = parseLlmMessageContent(getLlmCompletionText(data))
    return mergeImpactFocusSummary(summary, parsed)
  } catch (error) {
    console.warn('[ticket-impact-focus] LLM 总结失败，保留规则结果:', error)
    return {
      ...summary,
      meta: {
        ...(summary.meta || {}),
        llmError: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

/**
 * @param {{
 *   scopeLabel?: string
 *   recommendations?: OverviewRecommendation[]
 *   records?: FeedbackRecord[]
 *   settings?: import('./storage.js').AppSettings | null
 * }} params
 */
export function buildImpactFocusSummaryRule(params) {
  const {
    scopeLabel = '',
    recommendations = [],
    records = [],
  } = params || {}
  const themeRecommendations = collectThemeRecommendations(recommendations)
  const impactRecords = (records || []).filter(hasImpactSignal).sort(compareEvidenceRows)
  const recordById = new Map((records || []).map((record) => [record.id, record]))
  const themeLinks = themeRecommendations.map((recommendation) =>
    buildImpactThemeLink(recommendation, recordById, impactRecords))
  const ruleSummary = buildRuleImpactFocusSummary({
    scopeLabel,
    recommendations: themeRecommendations,
    impactRecords,
    themeLinks,
  })

  return {
    summary: ruleSummary,
    themeLinks,
    ungroupedEvidenceRecordIds: impactRecords.slice(0, 20).map((record) => record.id).filter(Boolean),
  }
}

/**
 * @param {{
 *   scopeLabel?: string
 *   recommendations?: OverviewRecommendation[]
 *   records?: FeedbackRecord[]
 *   settings?: import('./storage.js').AppSettings | null
 * }} params
 */
export async function buildImpactFocusSummary(params) {
  const result = buildImpactFocusSummaryRule(params)
  return {
    ...result,
    summary: await polishImpactFocusSummary(result.summary, params?.settings || null),
  }
}

/**
 * @param {{
 *   sourceLabel: string
 *   recommendations?: OverviewRecommendation[]
 *   records?: FeedbackRecord[]
 *   settings?: import('./storage.js').AppSettings | null
 * }} params
 */
export async function buildImpactFocusSummaries(params) {
  const {
    sourceLabel,
    recommendations = [],
    records = [],
    settings = null,
  } = params

  const all = await buildImpactFocusSummary({
    scopeLabel: `${sourceLabel || '当前范围'}整体`,
    recommendations,
    records,
    settings,
  })

  const productNames = [...new Set((records || []).map((record) => String(record?.product || record?.productSpec || '').trim()).filter(Boolean))]
  const byProduct = {}

  for (const product of productNames) {
    const scopedRecommendations = (recommendations || []).filter((recommendation) => recommendation?.scope?.product === product)
    const scopedRecords = (records || []).filter((record) => String(record?.product || record?.productSpec || '').trim() === product)
    byProduct[product] = await buildImpactFocusSummary({
      scopeLabel: `产品「${product}」`,
      recommendations: scopedRecommendations,
      records: scopedRecords,
      settings,
    })
  }

  return {
    all,
    byProduct,
    generatedAt: new Date().toISOString(),
  }
}
