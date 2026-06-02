import { getUrgencyLevel, isNegativeSentiment } from './sentiment.js'
import { topValues } from './journeyInsights.js'
import { isValidRootCause } from './journeyOptimizationLLM.js'
import { collectEffectiveOptimizationsFromRecords } from './ticketAnalysis/effectiveOptimizationCollect.js'
import {
  PLANNING_ACTION_RE,
  trackingMetricsForSignal,
  PLANNING_RECOMMENDATION_LIMITS,
} from './planningRecommendationTemplate.js'
import { isGenericRecommendationText } from './journeyOptimizationLLM.js'
import {
  formatClusterRootCauseForExport,
  formatVerificationForExport,
  normalizeClusterRootCause,
  normalizeVerification,
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
  verification: '闭环验证机制',
}

export const CLUSTER_SUB_LABELS = {
  dataMetrics: '数据表现',
  painClusters: '高频痛点',
  rootCauses: '高频根因',
  businessImpact: '业务影响',
}

const MIN_PRODUCT_ACTIONS = 2
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
function dedupeActionLines(lines, limit = 4, { strict = true } = {}) {
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const raw of lines) {
    const line = strict ? usableActionLine(raw) : truncateSentence(raw?.trim() || '', MAX_ACTION_LEN)
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
 * 仅使用工单打标环节的「需求痛点挖掘」结果（painPoint），不 fallback 到工单原文
 * @param {FeedbackRecord[]} pool
 * @param {number} [limit]
 */
function topPainPoints(pool, limit = 3) {
  const map = new Map()
  for (const fb of pool) {
    const pain = (fb.painPoint || '').trim()
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
 */
function buildContextNote(rec) {
  const scope = rec.scope
  if (scope?.journeyL2) {
    const path = scope.journeyL1 ? `${scope.journeyL1} → ${scope.journeyL2}` : scope.journeyL2
    return `聚焦用户旅程「${path}」`
  }
  if (scope?.problemType) {
    return `聚焦问题类型「${scope.problemType}」`
  }
  if (scope?.product) {
    return `聚焦产品「${scope.product}」`
  }
  const note = rec.evidenceNote?.trim()
  if (note && !/^依据\s*\d+\s*条/.test(note)) {
    return truncateSentence(note, 100)
  }
  return undefined
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} pool
 */
function buildDataMetrics(rec, pool) {
  const bundle = rec.evidenceBundle
  const ticketCount = bundle?.ticketCount ?? pool.length
  if (!ticketCount) return []
  return [`工单：${ticketCount} 条`]
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

  if (rec.scope?.journeyL2) {
    parts.push(`「${rec.scope.journeyL2}」环节体验断点`)
  } else if (rec.scope?.problemType) {
    parts.push(`「${rec.scope.problemType}」类问题持续出现`)
  }

  if (pool.length && negative / pool.length >= 0.4) {
    parts.push('负面情绪占比较高')
  }
  if (urgent >= 2) {
    parts.push(`${urgent} 单含加急诉求`)
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
  const painClusters = topPainPoints(pool, 3)
  const rawRootCauses = topValues(pool, 'rootCause', 8)
    .filter((r) => isValidRootCause(r.text))
    .map((r) => ({ text: r.text, count: r.count }))
  const rootCauses = mergeSimilarAndTop(rawRootCauses, 3, 0.35)

  const dataMetrics = buildDataMetrics(rec, pool)
  const contextNote = buildContextNote(rec)
  const businessImpact = buildBusinessImpactText(rec, pool)

  if (!contextNote && !painClusters.length && !rootCauses.length && !dataMetrics.length && !businessImpact) {
    return undefined
  }

  return {
    contextNote,
    dataMetrics: dataMetrics.length ? dataMetrics : undefined,
    painClusters: painClusters.length ? painClusters : undefined,
    rootCauses: rootCauses.length ? rootCauses : undefined,
    businessImpact,
  }
}

/**
 * @param {OverviewRecommendation} rec
 * @returns {PlanningVerification}
 */
function buildVerificationStructured(rec) {
  const metrics = (
    rec.trackingMetrics?.length
      ? rec.trackingMetrics
      : trackingMetricsForSignal(
          /** @type {import('./planningRecommendationTemplate.js').PlanningSignalType} */ (
            rec.signalType || 'journey_hotspot'
          ),
        )
  ).slice(0, 4)

  return {
    metrics,
    userValidation: '抽样回访已修复工单，并跟踪同类问题 30 天内复现率。',
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
  const { opportunities: _removed, ...rest } = sections
  const cluster = normalizeClusterRootCause(rest.clusterRootCause)
  const verification = normalizeVerification(rest.verification)

  return {
    ...rest,
    executiveSummary: enforceExecutiveSummary(rest.executiveSummary || ''),
    clusterRootCause: cluster,
    productActions: dedupeActionLines(rest.productActions || [], 4, { strict: false }),
    serviceActions: rest.serviceActions?.length
      ? dedupeActionLines(rest.serviceActions, 2, { strict: false })
      : undefined,
    verification,
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
  const verificationText = formatVerificationForExport(normalizeVerification(sections.verification))
  if (verificationText) out.push(verificationText)
  return out.slice(0, PLANNING_RECOMMENDATION_LIMITS.maxDetails)
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} evidencePool
 * @returns {PlanningRecommendationSections}
 */
export function buildPlanningRecommendationSections(rec, evidencePool = []) {
  const pool = evidencePool || []
  const summary = enforceExecutiveSummary((rec.summary || rec.text || '').trim())
  const { productActions, serviceActions } = collectProductAndServiceActions(pool)

  /** @type {PlanningRecommendationSections} */
  let sections = {
    executiveSummary: summary,
    clusterRootCause: buildClusterRootCauseStructured(rec, pool),
    productActions,
    serviceActions: serviceActions.length ? serviceActions : undefined,
    verification: buildVerificationStructured(rec),
  }

  sections = ensureMinProductActions(sections, rec.details || [])

  if ((sections.productActions?.length || 0) < MIN_PRODUCT_ACTIONS) {
    sections.productActions = dedupeActionLines(
      [...(sections.productActions || []), ...(rec.details || [])],
      MIN_PRODUCT_ACTIONS,
      { strict: false },
    )
  }

  return enforcePlanningSectionRules(sections)
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} evidencePool
 * @returns {OverviewRecommendation}
 */
export function attachPlanningRecommendationSections(rec, evidencePool = []) {
  const sections = buildPlanningRecommendationSections(rec, evidencePool)
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
