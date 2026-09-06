import { getUrgencyLevel, isNegativeSentiment } from './sentiment.js'
import { topValues } from './journeyInsights.js'
import { countCustomerTiers } from '../domain/customerTier.js'
import {
  collectPlanningPlaybookActionLines,
  detectProductActionsSource,
  inferPlanningJourneyContext,
  measureSourceLabelForProductActions,
} from './planningPlaybook.js'
import {
  CLUSTER_ACTION_SYNTHESIS_VERSION,
  synthesizeClusterProductActions,
} from './painPointClustering/clusterActionSynthesis.js'
import { collectEffectiveOptimizationsFromRecords } from './ticketAnalysis/effectiveOptimizationCollect.js'
import {
  PLANNING_ACTION_RE,
  stripProductActionAroundPrefix,
  PLANNING_RECOMMENDATION_LIMITS,
} from './planningRecommendationTemplate.js'
import { isGenericRecommendationText } from './journeyOptimizationLLM.js'
import {
  extractDemandClause,
  getClusteringPainText,
  getInsightPainText,
  looksLikeBackgroundInsightSummary,
  normalizeClusteringPainText,
  pickInsightRepresentativePain,
} from './painPointClustering/clusteringCorpus.js'
import {
  formatClusterRootCauseForExport,
  normalizeClusterRootCause,
} from './planningRecommendationDisplay.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/overviewConclusions.js').PlanningRecommendationSections} PlanningRecommendationSections */
/** @typedef {import('../domain/overviewConclusions.js').PlanningClusterRootCause} PlanningClusterRootCause */
/** @typedef {import('../domain/overviewConclusions.js').PlanningVerification} PlanningVerification */
/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

export const PLANNING_SECTION_LABELS = {
  executiveSummary: '执行摘要',
  clusterRootCause: '问题聚类与根因分析',
  productActions: '产品/技术优化',
  serviceActions: '服务/流程改进',
}

export const CLUSTER_SUB_LABELS = {
  painClusters: '簇内痛点',
  businessImpact: '业务影响',
}

/** 簇内痛点展示条数上限 */
export const CLUSTER_PAIN_DISPLAY_LIMIT = 5

/** 与代表痛点 Jaccard ≥ 此值则视为重复，不展示其他痛点 */
export const PAIN_CLUSTER_DEDUPE_THRESHOLD = 0.35

const MIN_PRODUCT_ACTIONS = 2
/** 举措与痛点摘要 token Jaccard 低于此值视为不对齐（P1-2） */
export const ACTION_PAIN_ALIGNMENT_THRESHOLD = 0.2
/** 保留举措的平均对齐分低于此值时标记 weak */
export const ACTION_PAIN_ALIGNMENT_WEAK_AVG = 0.25

/**
 * @param {FeedbackRecord[]} records
 * @returns {{ l1: string; l2: string } | null}
 */
function inferJourneyContextFromRecords(records) {
  return inferPlanningJourneyContext(records)
}

/**
 * 群组内工单优化字段不足时，用旅程/问题类型 playbook 补产品举措
 * @param {FeedbackRecord[]} pool
 * @param {OverviewRecommendation} rec
 * @returns {string[]}
 */
export function collectPlaybookFallbackProductActions(pool, rec) {
  if (!pool.length) return []

  const journeyCtx =
    rec.scope?.journeyL1 && rec.scope?.journeyL2
      ? { l1: rec.scope.journeyL1, l2: rec.scope.journeyL2 }
      : inferJourneyContextFromRecords(pool)
  const problemType =
    rec.scope?.problemType || topValues(pool, 'problemType', 1)[0]?.text || ''
  const product = rec.scope?.product || pool[0]?.product?.trim() || ''

  const lines = collectPlanningPlaybookActionLines({
    records: pool,
    product,
    journeyL1: journeyCtx?.l1,
    journeyL2: journeyCtx?.l2,
    problemType,
  })

  return dedupeActionLines(lines, MIN_PRODUCT_ACTIONS, { strict: false })
}

/**
 * @param {string} painSummary
 * @param {string} actionLine
 */
function actionPainSimilarity(painSummary, actionLine) {
  return jaccard(tokenizeZh(painSummary), tokenizeZh(actionLine))
}

/**
 * 校验 productActions 与痛点摘要的对齐度；偏低时替换为 playbook 并标记 weak（P1-2）
 * @param {PlanningRecommendationSections} sections
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} pool
 */
export function refineProductActionsForPainAlignment(sections, rec, pool) {
  const summary = (sections.executiveSummary || rec.summary || rec.text || '').trim()
  const originalActions = sections.productActions || []
  if (!summary || !originalActions.length) {
    return {
      sections,
      actionAlignmentWeak: false,
      actionAlignmentScore: null,
    }
  }

  const scored = originalActions.map((line) => ({
    line,
    score: actionPainSimilarity(summary, line),
  }))
  const aligned = scored
    .filter((item) => item.score >= ACTION_PAIN_ALIGNMENT_THRESHOLD)
    .map((item) => item.line)
  const misalignedCount = scored.length - aligned.length

  /** @type {string[]} */
  let productActions =
    aligned.length >= MIN_PRODUCT_ACTIONS ? aligned : [...aligned]
  let usedPlaybookFallback = false

  if (productActions.length < MIN_PRODUCT_ACTIONS) {
    const playbookFallback = collectPlaybookFallbackProductActions(pool, rec)
    productActions = dedupeActionLines(
      [...aligned, ...playbookFallback],
      4,
      { strict: false },
    )
    usedPlaybookFallback = misalignedCount > 0 || aligned.length < MIN_PRODUCT_ACTIONS
  } else if (misalignedCount > 0) {
    productActions = aligned
  }

  if ((productActions?.length || 0) < MIN_PRODUCT_ACTIONS) {
    productActions = originalActions
  }

  const avgScore = scored.length
    ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length
    : 0
  const alignedAvg = aligned.length
    ? scored
        .filter((item) => item.score >= ACTION_PAIN_ALIGNMENT_THRESHOLD)
        .reduce((sum, item) => sum + item.score, 0) / aligned.length
    : 0

  const actionAlignmentWeak =
    misalignedCount > 0 &&
    (aligned.length < MIN_PRODUCT_ACTIONS ||
      alignedAvg < ACTION_PAIN_ALIGNMENT_WEAK_AVG ||
      usedPlaybookFallback)

  return {
    sections: { ...sections, productActions },
    actionAlignmentWeak,
    actionAlignmentScore: Math.round(avgScore * 100) / 100,
    usedPlaybookFallback,
    usedAlignmentReplacement: misalignedCount > 0,
  }
}
const MAX_SUMMARY_LEN = PLANNING_RECOMMENDATION_LIMITS.maxSummaryLength
const MAX_ACTION_LEN = PLANNING_RECOMMENDATION_LIMITS.maxDetailLength
const MAX_BUSINESS_IMPACT_LEN = 120

/**
 * @param {string} text
 */
function hasActionVerb(text) {
  return PLANNING_ACTION_RE.test(text || '')
}

/**
 * @param {string} text
 * @param {number} maxLen
 */
function truncateSentence(text, maxLen) {
  const t = text?.trim()
  if (!t) return ''
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen - 1)}…`
}

/**
 * @param {string} text
 */
function usableActionLine(text, { strict = true } = {}) {
  const t = text?.trim()
  if (!t || t.length < 12) return null
  if (strict && isGenericRecommendationText(t)) return null
  if (!hasActionVerb(t)) return null
  return truncateSentence(t, MAX_ACTION_LEN)
}

/**
 * @param {string[]} lines
 * @param {number} [limit]
 */
function normalizeProductActionLine(text) {
  return stripProductActionAroundPrefix(text?.trim() || '')
}

function dedupeActionLines(lines, limit = 4, { strict = true } = {}) {
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const raw of lines) {
    const cleaned = normalizeProductActionLine(raw)
    const line = strict ? usableActionLine(cleaned) : truncateSentence(cleaned, MAX_ACTION_LEN)
    if (!line || line.length < 12) continue
    const key = line.slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= limit) break
  }
  return out
}

/**
 * 中文文本轻量分词（取 2+ 字连续片段 + 3+ 字英文）
 * @param {string} s
 * @returns {Set<string>}
 */
function tokenizeZh(s) {
  const lower = (s || '').toLowerCase()
  const tokens = new Set()
  const zhRe = /[\u4e00-\u9fa5]{2,}/g
  for (const m of lower.match(zhRe) || []) tokens.add(m)
  const enRe = /[a-zA-Z]{3,}/g
  for (const m of lower.match(enRe) || []) tokens.add(m.toLowerCase())
  return tokens
}

/**
 * 计算两组 token 的 Jaccard 相似度
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * 语义同义合并 + 频次聚合
 * 相似度 ≥ threshold 的条目合并为一个，保留最高频文本作为代表，累加频次
 *
 * @param {{ text: string; count: number }[]} items
 * @param {number} [limit]
 * @param {number} [threshold]
 * @returns {{ text: string; count: number }[]}
 */
function mergeSimilarAndTop(items, limit = 5, threshold = 0.4) {
  if (!items.length) return []
  /** @type {{ tokens: Set<string>; text: string; count: number }[]} */
  const enriched = items.map((it) => ({
    tokens: tokenizeZh(it.text),
    text: it.text,
    count: it.count,
  }))
  /** @type {{ text: string; count: number }[]} */
  const merged = []
  const claimed = new Set()

  // 按频次降序处理，高频项优先吸收相似低频项
  const sorted = [...enriched].sort((a, b) => b.count - a.count)
  for (const primary of sorted) {
    if (claimed.has(primary.text)) continue
    let totalCount = primary.count
    claimed.add(primary.text)
    // 吸收相似的低频条目
    for (const candidate of sorted) {
      if (claimed.has(candidate.text)) continue
      if (jaccard(primary.tokens, candidate.tokens) >= threshold) {
        totalCount += candidate.count
        claimed.add(candidate.text)
      }
    }
    merged.push({ text: primary.text, count: totalCount })
    if (merged.length >= limit) break
  }
  // 按 merged count 降序
  merged.sort((a, b) => b.count - a.count)
  return merged.slice(0, limit)
}

/**
 * v2.4 洞察摘要：优先用「问题原因」作类名，格式「因 {问题原因} 导致的问题（N 条工单…）」；
 * 无问题原因时回退痛点句。若该成因本期新增或环比激增（≥2 倍且 ≥3 条），追加突发标注。
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} pool
 * @param {string} representativePain
 */
export function buildInsightExecutiveSummary(rec, pool, representativePain) {
  const cause = (rec?.generationMeta?.representativeCause || '').trim()
  let title = ''
  if (cause) {
    title = truncateSentence(cause, 60)
  } else {
    let pain =
      getInsightPainText({ painPoint: representativePain }) ||
      refineStoredInsightPain(representativePain) ||
      getInsightPainText({ painPoint: rec.generationMeta?.representativePain }) ||
      refineStoredInsightPain(rec.generationMeta?.representativePain) ||
      refineStoredInsightPain(rec.summary || rec.text || '')
    if (!pain && pool.length) {
      pain = pickInsightRepresentativePain(pool)
    }
    if (!pain) return ''
    title = truncateSentence(
      extractDemandClause(pain) || pain.split(/[。；\n]/)[0]?.trim() || pain,
      72,
    )
  }
  if (!title) return ''

  const ticketCount = rec.evidenceBundle?.ticketCount ?? pool.length
  const sharePct = rec.evidenceBundle?.sharePct

  let line = cause ? `因 ${title} 导致的问题` : title
  if (ticketCount > 0) {
    line += `（${ticketCount} 条工单`
    if (sharePct != null && sharePct >= 5) {
      line += `，占该产品 ${Math.round(sharePct)}%`
    }
    line += '）'
  }

  // v2.4：突发集中化标注（本期新增 / 环比激增）
  const spike = formatCauseSpikeSuffix(rec)
  if (spike) line += spike

  return truncateSentence(line, MAX_SUMMARY_LEN)
}

/**
 * 突发集中化标注：本期新增或环比激增（≥2 倍且 ≥3 条）时返回后缀。
 * 依赖 rec.periodCompare（由 attachRecommendationPeriodCompare 注入）。
 * @param {OverviewRecommendation} rec
 * @returns {string}
 */
export function formatCauseSpikeSuffix(rec) {
  const cmp = rec?.periodCompare
  if (!cmp) return ''
  const currentCount =
    rec?.sections?.painClusterScores?.ticketCount
    ?? rec?.evidenceBundle?.ticketCount
    ?? rec?.evidenceRecordIds?.length
    ?? 0
  if (cmp.lifecycle === 'new' || cmp.change === 'new') {
    return '（本期新增）'
  }
  if (cmp.lifecycle === 'growing' && currentCount >= 3) {
    const prevCount = currentCount - (cmp.deltaCount || 0)
    if (prevCount > 0 && currentCount / prevCount >= 2) {
      return `（环比 ${Math.round((currentCount / prevCount) * 10) / 10} 倍）`
    }
    if (prevCount <= 0 && currentCount >= 3) {
      return '（本期新增）'
    }
  }
  return ''
}

/**
 * v2.4：在 attachRecommendationPeriodCompare 之后，为有「问题原因」类名且突发（新增/激增）的建议
 * 追加突发标注到 summary/text/executiveSummary。需传入 records 以重建摘要。
 * @param {OverviewRecommendation[]} recommendations
 * @param {FeedbackRecord[]} allRecords
 */
export function applyCauseSpikeHighlight(recommendations, allRecords = []) {
  if (!recommendations?.length) return recommendations
  const byId = new Map(allRecords.map((r) => [r.id, r]))
  return recommendations.map((rec) => {
    const cause = rec?.generationMeta?.representativeCause?.trim()
    if (!cause) return rec
    const spike = formatCauseSpikeSuffix(rec)
    if (!spike) return rec
    const pool = (rec.evidenceRecordIds || []).map((id) => byId.get(id)).filter(Boolean)
    // 重建摘要以包含突发标注（periodCompare 现已可用）
    const rebuilt = buildInsightExecutiveSummary(rec, pool, rec.generationMeta?.representativePain)
    if (!rebuilt) return rec
    return {
      ...rec,
      summary: rebuilt,
      text: rebuilt,
      sections: rec.sections ? { ...rec.sections, executiveSummary: rebuilt } : rec.sections,
    }
  })
}

/**
 * 旧快照里存的 representativePain/summary 可能混有 customerRequest，尝试提炼可展示痛点
 * @param {string | undefined | null} text
 */
function refineStoredInsightPain(text) {
  const normalized = normalizeClusteringPainText(text)
  if (normalized) {
    const fromPain = getInsightPainText({ painPoint: normalized })
    if (fromPain) return fromPain
  }
  return extractDemandClause(text) || ''
}

/**
 * 簇内 Top N 痛点：保留频次排序结果，标注代表痛点与占比（不再因与标题相似而隐藏）
 *
 * @param {{ text: string; count: number }[]} painClusters
 * @param {string} anchorPain
 * @param {number} poolSize
 * @param {number} [limit]
 */
export function buildPainClustersForDisplay(painClusters, anchorPain, poolSize, limit = CLUSTER_PAIN_DISPLAY_LIMIT) {
  if (!painClusters?.length) return []
  const total = poolSize > 0 ? poolSize : painClusters.reduce((sum, item) => sum + item.count, 0)
  const anchor = anchorPain?.trim() || ''

  return painClusters.slice(0, limit).map((item) => ({
    text: item.text,
    count: item.count,
    sharePct: total > 0 ? Math.round((item.count / total) * 100) : 0,
    isRepresentative:
      Boolean(anchor) && jaccard(tokenizeZh(anchor), tokenizeZh(item.text)) >= PAIN_CLUSTER_DEDUPE_THRESHOLD,
  }))
}

/**
 * @param {{ text: string; count: number }[]} painClusters
 * @param {string} anchorPain
 * @deprecated 请使用 buildPainClustersForDisplay；保留供旧测试兼容
 */
export function filterPainClustersForDisplay(painClusters, anchorPain) {
  if (!painClusters.length || !anchorPain?.trim()) return painClusters
  const filtered = painClusters.filter(
    (item) =>
      jaccard(tokenizeZh(anchorPain), tokenizeZh(item.text)) < PAIN_CLUSTER_DEDUPE_THRESHOLD,
  )
  if (!filtered.length && painClusters.length <= 2) return []
  return filtered
}

/**
 * 仅使用工单打标环节的「需求痛点挖掘」结果（painPoint），不 fallback 到工单原文
 * @param {FeedbackRecord[]} pool
 * @param {number} [limit]
 */
function topPainPoints(pool, limit = CLUSTER_PAIN_DISPLAY_LIMIT) {
  const map = new Map()
  for (const fb of pool) {
    const pain = getClusteringPainText(fb)
    if (!pain) continue
    const key = pain.slice(0, 80)
    map.set(key, (map.get(key) || 0) + 1)
  }
  const raw = [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([text, count]) => ({ text, count }))
  return mergeSimilarAndTop(raw, limit, 0.25)
}

/**
 * @param {FeedbackRecord[]} pool
 */
function collectProductAndServiceActions(pool) {
  /** @type {string[]} */
  const product = []
  /** @type {string[]} */
  const service = []

  for (const item of collectEffectiveOptimizationsFromRecords(pool, 10)) {
    const text = item.text
    const line =
      usableActionLine(text, {
        strict: item.source !== '单条优化建议' && item.source !== '人工复核优化建议',
      }) ||
      (text.length >= 12 && hasActionVerb(text)
        ? truncateSentence(text, MAX_ACTION_LEN)
        : null)
    if (!line) continue
    if (/SLA|协查|催办|流程|协同|回访|升级路径|知识库|空转/.test(text)) {
      service.push(line)
    } else {
      product.push(line)
    }
  }

  return {
    productActions: dedupeActionLines(product, 4, { strict: false }),
    serviceActions: dedupeActionLines(service, 2, { strict: false }),
  }
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} pool
 */
function buildBusinessImpactText(rec, pool) {
  /** @type {string[]} */
  const parts = []
  const negative = pool.filter((r) => isNegativeSentiment(r.sentiment)).length
  const urgent = pool.filter((r) => getUrgencyLevel(r) === 'high').length
  const topL2 = topValues(pool, 'journeyL2', 1)[0]
  const topPt = topValues(pool, 'problemType', 1)[0]
  const tierCounts = countCustomerTiers(pool)
  const highValueCount = (tierCounts['金牌'] || 0) + (tierCounts['银牌'] || 0)

  if (rec.scope?.journeyL2) {
    parts.push(`「${rec.scope.journeyL2}」环节体验断点`)
  } else if (topL2?.text) {
    parts.push(`「${topL2.text}」环节集中反馈`)
  } else if (rec.scope?.problemType) {
    parts.push(`「${rec.scope.problemType}」类问题持续出现`)
  } else if (topPt?.text) {
    parts.push(`「${topPt.text}」类问题持续出现`)
  }

  if (pool.length && negative / pool.length >= 0.4) {
    parts.push(`负面情绪占比约 ${Math.round((negative / pool.length) * 100)}%`)
  } else if (negative >= 2) {
    parts.push(`${negative} 单含负面情绪`)
  }
  if (urgent >= 2) {
    parts.push(`${urgent} 单含加急诉求`)
  }
  if (highValueCount >= 2) {
    parts.push(`含金牌/银牌客户 ${highValueCount} 单`)
  } else if ((tierCounts['金牌'] || 0) >= 1) {
    parts.push('含金牌客户诉求')
  }

  const sharePct = rec.evidenceBundle?.sharePct
  if (sharePct != null && sharePct >= 8 && !parts.some((p) => p.includes('占该产品'))) {
    parts.push(`占该产品工单约 ${Math.round(sharePct)}%`)
  }

  if (!parts.length) {
    return '若未及时修复，易引发重复进线与满意度下滑。'
  }
  return truncateSentence(`${parts.join('，')}，需优先闭环以避免重复进线与满意度下滑。`, MAX_BUSINESS_IMPACT_LEN)
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} pool
 * @returns {PlanningClusterRootCause | undefined}
 */
function buildClusterRootCauseStructured(rec, pool) {
  const anchorPain = (
    rec.generationMeta?.representativePain ||
    rec.summary ||
    rec.text ||
    ''
  ).trim()
  // v2.4：问题原因类名（簇内痛点表象仅作证据，不再当类名）
  const causeLabel = (rec.generationMeta?.representativeCause || '').trim()
  const painClustersRaw = topPainPoints(pool, CLUSTER_PAIN_DISPLAY_LIMIT)
  const painClusters = buildPainClustersForDisplay(
    painClustersRaw,
    anchorPain,
    pool.length,
    CLUSTER_PAIN_DISPLAY_LIMIT,
  )
  const businessImpact = buildBusinessImpactText(rec, pool)

  if (!causeLabel && !painClusters.length && !businessImpact) {
    return undefined
  }

  return {
    causeLabel: causeLabel || undefined,
    painClusters: painClusters.length ? painClusters : undefined,
    businessImpact,
  }
}

/**
 * @param {string} summary
 */
function enforceExecutiveSummary(summary) {
  const trimmed = summary?.trim() || ''
  if (!trimmed) return ''
  const first = trimmed.split(/[。；\n]/)[0]?.trim() || trimmed
  return truncateSentence(first, MAX_SUMMARY_LEN)
}

/**
 * Phase 3：收紧各 section 格式
 * @param {PlanningRecommendationSections} sections
 */
export function enforcePlanningSectionRules(sections) {
  const { opportunities: _removed, verification: _verification, ...rest } = sections
  const cluster = normalizeClusterRootCause(rest.clusterRootCause)

  return {
    ...rest,
    executiveSummary: enforceExecutiveSummary(rest.executiveSummary || ''),
    clusterRootCause: cluster,
    productActions: dedupeActionLines(rest.productActions || [], 4, { strict: false }),
    serviceActions: rest.serviceActions?.length
      ? dedupeActionLines(rest.serviceActions, 2, { strict: false })
      : undefined,
  }
}

/**
 * @param {PlanningRecommendationSections} sections
 * @param {string[]} [fallbackDetails]
 */
export function ensureMinProductActions(sections, fallbackDetails = []) {
  const product = [...(sections.productActions || [])]
  for (const line of fallbackDetails) {
    if (product.length >= MIN_PRODUCT_ACTIONS) break
    const normalized =
      usableActionLine(line) || (hasActionVerb(line) ? truncateSentence(line, MAX_ACTION_LEN) : null)
    if (normalized && !product.some((p) => p.slice(0, 40) === normalized.slice(0, 40))) {
      product.push(normalized)
    }
  }
  return { ...sections, productActions: product.slice(0, 4) }
}

/**
 * @param {PlanningRecommendationSections} sections
 */
export function sectionsToLegacyDetails(sections) {
  /** @type {string[]} */
  const out = []
  const clusterText = formatClusterRootCauseForExport(
    normalizeClusterRootCause(sections.clusterRootCause),
  )
  if (clusterText) out.push(clusterText)
  for (const line of sections.productActions || []) {
    out.push(`【产品/技术】${line}`)
  }
  for (const line of sections.serviceActions || []) {
    out.push(`【服务/流程】${line}`)
  }
  return out.slice(0, PLANNING_RECOMMENDATION_LIMITS.maxDetails)
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} evidencePool
 */
function buildPlanningRecommendationSectionsCore(rec, evidencePool = []) {
  const pool = evidencePool || []
  const isClusterV2 = ['pain_cluster_v2', 'high_risk_singleton', 'overview_fused_cluster'].includes(rec.signalType)
  const summary = isClusterV2
    ? buildInsightExecutiveSummary(rec, pool, rec.generationMeta?.representativePain) ||
      enforceExecutiveSummary((rec.summary || rec.text || '').trim())
    : enforceExecutiveSummary((rec.summary || rec.text || '').trim())

  const { productActions: ticketProductActions, serviceActions: ticketServiceActions } =
    collectProductAndServiceActions(pool)

  /** @type {string[]} */
  let productActions = ticketProductActions
  let serviceActions = ticketServiceActions
  let usedClusterSynthesis = false
  let usedEstablishedActionInSynthesis = false
  let usedPlaybookFallback = false

  if (isClusterV2) {
    const synthesized = synthesizeClusterProductActions(
      rec,
      pool,
      rec.generationMeta?.representativePain,
    )
    if (synthesized.actions.length >= MIN_PRODUCT_ACTIONS) {
      productActions = synthesized.actions
      usedClusterSynthesis = true
      usedEstablishedActionInSynthesis = synthesized.usedEstablishedAction
    }
  }

  /** @type {PlanningRecommendationSections} */
  let sections = {
    executiveSummary: summary,
    clusterRootCause: buildClusterRootCauseStructured(rec, pool),
    productActions,
    serviceActions: serviceActions.length ? serviceActions : undefined,
  }

  sections = ensureMinProductActions(sections, rec.details || [])

  if (!usedClusterSynthesis && (sections.productActions?.length || 0) < MIN_PRODUCT_ACTIONS) {
    const playbookFallback = collectPlaybookFallbackProductActions(pool, rec)
    if (playbookFallback.length) usedPlaybookFallback = true
    sections = ensureMinProductActions(sections, playbookFallback)
  }

  if (!usedClusterSynthesis && (sections.productActions?.length || 0) < MIN_PRODUCT_ACTIONS) {
    sections.productActions = dedupeActionLines(
      [...(sections.productActions || []), ...(rec.details || [])],
      MIN_PRODUCT_ACTIONS,
      { strict: false },
    )
  }

  const aligned = usedClusterSynthesis
    ? {
        sections,
        actionAlignmentWeak: false,
        actionAlignmentScore: null,
        usedPlaybookFallback: false,
        usedAlignmentReplacement: false,
      }
    : refineProductActionsForPainAlignment(sections, rec, pool)

  const productActionsSource = detectProductActionsSource(
    ticketProductActions,
    aligned.sections.productActions || [],
    {
      usedClusterSynthesis,
      usedEstablishedActionInSynthesis,
      usedPlaybookFallback: usedPlaybookFallback || aligned.usedPlaybookFallback,
      usedAlignmentReplacement: aligned.usedAlignmentReplacement,
    },
  )

  return {
    ...aligned,
    productActionsSource,
    measureSource: measureSourceLabelForProductActions(productActionsSource),
    generationMeta: usedClusterSynthesis
      ? {
          ...rec.generationMeta,
          actionSynthesisVersion: CLUSTER_ACTION_SYNTHESIS_VERSION,
        }
      : rec.generationMeta,
  }
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} evidencePool
 * @returns {PlanningRecommendationSections}
 */
export function buildPlanningRecommendationSections(rec, evidencePool = []) {
  const aligned = buildPlanningRecommendationSectionsCore(rec, evidencePool)
  return enforcePlanningSectionRules(aligned.sections)
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} evidencePool
 * @returns {ReturnType<typeof refineProductActionsForPainAlignment>}
 */
export function buildPlanningRecommendationSectionsWithMeta(rec, evidencePool = []) {
  const aligned = buildPlanningRecommendationSectionsCore(rec, evidencePool)
  return {
    ...aligned,
    sections: enforcePlanningSectionRules(aligned.sections),
  }
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} evidencePool
 * @returns {OverviewRecommendation}
 */
export function attachPlanningRecommendationSections(rec, evidencePool = []) {
  const aligned = buildPlanningRecommendationSectionsWithMeta(rec, evidencePool)
  const sections = aligned.sections
  const legacyDetails = sectionsToLegacyDetails(sections)
  const details =
    legacyDetails.length >= PLANNING_RECOMMENDATION_LIMITS.minDetails
      ? legacyDetails
      : rec.details || legacyDetails

  return {
    ...rec,
    summary: sections.executiveSummary || rec.summary,
    text: sections.executiveSummary || rec.text,
    sections,
    details: details.slice(0, PLANNING_RECOMMENDATION_LIMITS.maxDetails),
    actionAlignmentWeak: aligned.actionAlignmentWeak,
    actionAlignmentScore: aligned.actionAlignmentScore,
    productActionsSource: aligned.productActionsSource,
    measureSource: aligned.measureSource || rec.measureSource,
    generationMeta: aligned.generationMeta || rec.generationMeta,
  }
}

/**
 * LLM 润色后合并 sections 中的可编辑动作行
 * @param {PlanningRecommendationSections | undefined} base
 * @param {{ productActions?: string[]; serviceActions?: string[]; summary?: string }} patch
 */
export function mergePolishedPlanningSections(base, patch) {
  if (!base) return base
  const next = { ...base }
  if (patch.summary?.trim()) {
    next.executiveSummary = enforceExecutiveSummary(patch.summary)
  }
  if (Array.isArray(patch.productActions) && patch.productActions.length) {
    next.productActions = dedupeActionLines(patch.productActions, 4, { strict: false })
  }
  if (Array.isArray(patch.serviceActions) && patch.serviceActions.length) {
    next.serviceActions = dedupeActionLines(patch.serviceActions, 2, { strict: false })
  }
  return enforcePlanningSectionRules(ensureMinProductActions(next, []))
}
