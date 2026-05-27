import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { MAX_PLANNING_RECOMMENDATIONS } from '../domain/overviewConclusions.js'
import {
  buildDetailFallbackLine,
  buildEvidenceNoteForSignal,
  buildFallbackPrimaryAction,
  buildPrimaryActionForSignal,
  buildProblemTypePrimaryAction,
  buildProductPrimaryAction,
  buildScopeLabelFromContext,
  formatScopedSummary,
  LARGE_PRODUCT_REC_MAX,
  LARGE_PRODUCT_REC_MIN,
  LARGE_PRODUCT_TICKET_THRESHOLD,
  planningCategoryRank,
  PLANNING_ACTION_RE,
  PLANNING_ACTION_VERBS,
  PLANNING_EXPORT_LABELS,
  PLANNING_RECOMMENDATION_LIMITS,
  trackingMetricsForSignal,
} from './planningRecommendationTemplate.js'
import { isNegativeSentiment } from './sentiment.js'
import { synthesizePlanningMeasures, topValues } from './journeyInsights.js'
import { isGenericRecommendationText, isTicketDerivedPlanningText, isValidRootCause } from './journeyOptimizationLLM.js'
import { formatWanTouRatio } from './wanTouRatio.js'
import { buildWorkbenchAnalysisUrl } from './workbenchAnalysisLink.js'
import { getSignalWeight } from './planningConfigLoader.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/overviewConclusions.js').RecommendationCategory} RecommendationCategory */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

const MAX_RECOMMENDATIONS = MAX_PLANNING_RECOMMENDATIONS
const MIN_EVIDENCE = 3
const PLAYBOOK_SOURCE_RE = /playbook/i
const MIN_DETAILS = PLANNING_RECOMMENDATION_LIMITS.minDetails

const SIGNAL_LABELS = {
  journey_hotspot: '旅程热点',
  problem_type: '问题类型',
  wan_tou: '万投比',
  root_cause: '根因聚集',
  risk_negative: '负面风险',
  risk_trend: '趋势风险',
}

/**
 * @param {FeedbackRecord[]} pool
 * @param {number} [periodTicketCount]
 */
export function buildRecommendationEvidenceBundle(pool, periodTicketCount) {
  const records = pool || []
  const ticketCount = records.length
  const negativeCount = records.filter((r) => isNegativeSentiment(r.sentiment)).length
  const sharePct =
    periodTicketCount > 0 ? Math.round((ticketCount / periodTicketCount) * 100) : undefined

  /** @type {{ ticketId: string; problemSummary?: string }[]} */
  const sampleSummaries = []
  const seen = new Set()
  for (const r of records) {
    if (!r.ticketId || seen.has(r.ticketId)) continue
    seen.add(r.ticketId)
    sampleSummaries.push({
      ticketId: r.ticketId,
      problemSummary: (r.problemSummary || r.handlingText || '').trim().slice(0, 120) || undefined,
    })
    if (sampleSummaries.length >= 3) break
  }

  const manualActions = collectManualReviewActions(records, 3).map((a) => a.text)

  return {
    ticketCount,
    negativeCount,
    sharePct,
    sampleSummaries,
    manualActions,
  }
}

/**
 * @param {FeedbackRecord[]} pool
 * @param {boolean} [insufficientEvidence]
 * @param {string} [measureSource]
 * @returns {import('../domain/overviewConclusions.js').EvidenceStrength}
 */
export function computeRecommendationEvidenceStrength(pool, insufficientEvidence, measureSource) {
  if (insufficientEvidence || !pool?.length) return 'weak'
  const count = pool.length
  const hasRoot = pool.some((r) => isValidRootCause(r.rootCause || r.manualReviewRootCause))
  const hasManual = collectManualReviewActions(pool, 1).length > 0
  const hasPlaybook = PLAYBOOK_SOURCE_RE.test(measureSource || '')
  if (count >= MIN_EVIDENCE && (hasRoot || hasManual || hasPlaybook)) return 'strong'
  if (count >= MIN_EVIDENCE) return 'moderate'
  return 'weak'
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} [evidencePool]
 */
export function buildGenerationSelectedReason(rec, evidencePool = []) {
  const signal = SIGNAL_LABELS[/** @type {keyof typeof SIGNAL_LABELS} */ (rec.signalType)] || rec.signalType || '综合'
  const parts = []
  if (rec.scope?.product) parts.push(rec.scope.product)
  if (rec.scope?.journeyL2) {
    parts.push(
      rec.scope.journeyL1
        ? `旅程 ${rec.scope.journeyL1}→${rec.scope.journeyL2}`
        : `旅程 ${rec.scope.journeyL2}`,
    )
  } else if (rec.scope?.journeyL1) {
    parts.push(`旅程 ${rec.scope.journeyL1}`)
  }
  if (rec.scope?.problemType) parts.push(`问题类型 ${rec.scope.problemType}`)
  if (rec.scope?.requestScene) parts.push(`场景 ${rec.scope.requestScene}`)
  const scopeLabel = parts.length ? parts.join(' · ') : '跨产品'
  const count = evidencePool.length || rec.evidenceBundle?.ticketCount || 0
  const countPart = count > 0 ? `（${count} 条工单）` : ''
  return `${scopeLabel}：${signal}信号${countPart}`
}

/**
 * @param {OverviewRecommendation} rec
 */
export function describeRecommendationAxis(rec) {
  const signal = SIGNAL_LABELS[/** @type {keyof typeof SIGNAL_LABELS} */ (rec.signalType)] || rec.signalType || ''
  const s = rec.scope || {}
  const bits = [signal, s.product, s.journeyL2 || s.journeyL1, s.problemType].filter(Boolean)
  return bits.join(' / ') || rec.id
}

/**
 * @param {import('../domain/overviewConclusions.js').EvidenceStrength} [a]
 * @param {import('../domain/overviewConclusions.js').EvidenceStrength} [b]
 */
export function compareEvidenceStrength(a, b) {
  const score = { strong: 3, moderate: 2, weak: 1 }
  return (score[b] || 0) - (score[a] || 0)
}

/**
 * @param {OverviewRecommendation} rec
 * @param {{ source?: import('../domain/enums.js').DataSourceType }} [opts]
 */
export function buildPlanningAnalysisLink(rec, opts = {}) {
  let tab = 'request'
  if (rec.scope?.journeyL2 || rec.scope?.journeyL1) tab = 'journey'
  else if (rec.scope?.problemType) tab = 'problem'
  else if (rec.scope?.requestScene) tab = 'request'

  return buildWorkbenchAnalysisUrl({
    ...(opts.source ? { source: opts.source } : {}),
    product: rec.scope?.product,
    journeyL1: rec.scope?.journeyL1,
    journeyL2: rec.scope?.journeyL2,
    problemType: rec.scope?.problemType,
    requestScene: rec.scope?.requestScene,
    tab,
  })
}
const THEMATIC_JOURNEY_LIMIT = 6
const THEMATIC_PROBLEM_TYPE_LIMIT = 6
const SKIPPED_PROBLEM_TYPES = new Set(['未分类'])
const SKIPPED_JOURNEY_RE = /未知|未识别/
const SEMANTIC_SUMMARY_THRESHOLD = 0.52
const SEMANTIC_SCOPE_SUMMARY_THRESHOLD = 0.38
const SEMANTIC_DETAIL_THRESHOLD = 0.62
const SAME_PRODUCT_SUMMARY_THRESHOLD = 0.4
const SAME_PRODUCT_PROBLEM_TYPE_THRESHOLD = 0.3
const MIN_PRODUCT_TICKETS_FOR_COVERAGE = 3
const SKIPPED_REQUEST_SCENES = new Set(['未分类'])

/**
 * @param {number} sampleSize
 */
function minAxisRecords(sampleSize) {
  if (sampleSize <= 20) return 2
  return Math.max(12, Math.floor(sampleSize * 0.012))
}

/**
 * @param {number} productCount 该产品工单数
 * @param {number} [_globalSample]
 */
export function minAxisRecordsForProduct(productCount, _globalSample = productCount) {
  if (productCount <= 5) return 2
  if (productCount < 30) return 3
  if (productCount < LARGE_PRODUCT_TICKET_THRESHOLD) {
    return Math.max(4, Math.floor(productCount * 0.03))
  }
  return Math.max(5, Math.floor(productCount * 0.004))
}

/**
 * @param {number} productTicketCount
 */
export function targetRecommendationCountForProduct(productTicketCount) {
  if (productTicketCount < MIN_PRODUCT_TICKETS_FOR_COVERAGE) return 0
  if (productTicketCount < 30) return 1
  if (productTicketCount < 100) return 2
  if (productTicketCount < LARGE_PRODUCT_TICKET_THRESHOLD) return 3
  const scaled = Math.round(3 + (productTicketCount / LARGE_PRODUCT_TICKET_THRESHOLD) * 4)
  return Math.min(LARGE_PRODUCT_REC_MAX, Math.max(LARGE_PRODUCT_REC_MIN, scaled))
}

/**
 * @param {FeedbackRecord[]} ticketRecords
 */
export function computeMaxPlanningRecommendations(ticketRecords) {
  const names = topValues(ticketRecords, 'product', 24).map((p) => p.text)
  let total = 0
  for (const name of names) {
    if (!name) continue
    const count = ticketRecords.filter((r) => r.product === name).length
    total += targetRecommendationCountForProduct(count)
  }
  return Math.min(MAX_RECOMMENDATIONS, Math.max(total, 4))
}

/**
 * @param {OverviewRecommendation} rec
 */
/**
 * @param {OverviewRecommendation} rec
 */
export function recommendationProductName(rec) {
  return rec.scope?.product?.trim() || ''
}

/**
 * @param {OverviewRecommendation} rec
 */
export function planningContentAxisKey(rec) {
  const s = rec.scope || {}
  return [
    s.product || '',
    s.journeyL1 || '',
    s.journeyL2 || '',
    s.problemType || '',
    s.requestScene || '',
    rec.signalType || '',
  ].join('\0')
}

export function recommendationAxisKey(rec) {
  const s = rec.scope || {}
  const signal = rec.signalType || ''
  if (signal === 'problem_type' && s.problemType) {
    return ['pt', s.product || '', s.problemType].join('\0')
  }
  if (signal === 'journey_hotspot' && s.journeyL2) {
    return ['j', s.product || '', s.journeyL1 || '', s.journeyL2].join('\0')
  }
  if (signal === 'root_cause') {
    return ['rc', s.product || '', s.journeyL2 || '', s.problemType || ''].join('\0')
  }
  return [signal, s.product || '', s.journeyL1 || '', s.journeyL2 || '', s.problemType || ''].join('\0')
}

/**
 * @param {import('../domain/overviewConclusions.js').OverviewRecommendationScope | undefined} scope
 */
function hasDistinctPlanningAxis(scope) {
  return Boolean(scope?.journeyL2 || scope?.problemType)
}

/**
 * @param {string} text
 * @param {string} [measureSource]
 */
export function recommendationCategory(text, measureSource) {
  if (/文档|FAQ|帮助中心|话术|知识库/.test(text)) return 'docs'
  if (/监控|预警|看板|SLA|流程|协查|运营/.test(text)) return 'monitoring'
  if (measureSource === '环节 playbook' || measureSource === '阶段 playbook') return 'process'
  return 'product'
}

/**
 * @param {number} score
 */
function priorityFromScore(score) {
  if (score >= 8) return 'high'
  if (score >= 4) return 'medium'
  return 'low'
}

/**
 * @param {string} text
 */
function dedupeKey(text) {
  return (text || '').trim().slice(0, 48).replace(/\s+/g, '')
}

/**
 * @param {string} text
 */
export function tokenizeRecommendationText(text) {
  const s = (text || '').toLowerCase()
  /** @type {Set<string>} */
  const tokens = new Set()
  for (const w of s.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    tokens.add(w)
  }
  for (const hint of PLANNING_ACTION_VERBS) {
    if (s.includes(hint.toLowerCase())) tokens.add(hint)
  }
  return tokens
}

/**
 * @param {string} a
 * @param {string} b
 */
export function textTokenSimilarity(a, b) {
  const A = tokenizeRecommendationText(a)
  const B = tokenizeRecommendationText(b)
  if (!A.size && !B.size) return 1
  let inter = 0
  for (const t of A) {
    if (B.has(t)) inter += 1
  }
  return inter / (A.size + B.size - inter)
}

/**
 * @param {OverviewRecommendation} a
 * @param {OverviewRecommendation} b
 */
export function recommendationsSimilar(a, b) {
  const summarySim = textTokenSimilarity(a.summary || a.text, b.summary || b.text)
  const axisA = recommendationAxisKey(a)
  const axisB = recommendationAxisKey(b)
  const contentA = planningContentAxisKey(a)
  const contentB = planningContentAxisKey(b)
  const prodA = recommendationProductName(a)
  const prodB = recommendationProductName(b)
  const sameProduct = Boolean(prodA && prodB && prodA === prodB)

  if (axisA && axisB && axisA === axisB) return true
  if (contentA && contentB && contentA === contentB) return true

  if (
    sameProduct &&
    a.scope?.journeyL2 &&
    a.scope.journeyL2 === b.scope?.journeyL2 &&
    (a.scope?.problemType || '') === (b.scope?.problemType || '')
  ) {
    return true
  }

  if (
    axisA &&
    axisB &&
    axisA !== axisB &&
    hasDistinctPlanningAxis(a.scope) &&
    hasDistinctPlanningAxis(b.scope) &&
    !sameProduct
  ) {
    return false
  }

  if (sameProduct) {
    const journeyA = a.scope?.journeyL2 || ''
    const journeyB = b.scope?.journeyL2 || ''
    const problemA = a.scope?.problemType || ''
    const problemB = b.scope?.problemType || ''
    const sceneA = a.scope?.requestScene || ''
    const sceneB = b.scope?.requestScene || ''
    if (journeyA && journeyB && journeyA !== journeyB) return false
    if (problemA && problemB && problemA !== problemB) return false
    if (sceneA && sceneB && sceneA !== sceneB) return false
    if (contentA && contentB && contentA !== contentB) return false
    if (summarySim >= SAME_PRODUCT_SUMMARY_THRESHOLD) return true
    const sharedProblemType = problemA && problemB && problemA === problemB
    if (sharedProblemType && summarySim >= SAME_PRODUCT_PROBLEM_TYPE_THRESHOLD) return true
  }

  if (summarySim >= SEMANTIC_SUMMARY_THRESHOLD) return true

  const sameJourney =
    a.scope?.journeyL2 &&
    a.scope.journeyL2 === b.scope?.journeyL2 &&
    (a.scope.journeyL1 || '') === (b.scope?.journeyL1 || '')
  if (sameJourney && summarySim >= SEMANTIC_SCOPE_SUMMARY_THRESHOLD) return true

  const sharedJourneyL2 =
    a.scope?.journeyL2 && b.scope?.journeyL2 && a.scope.journeyL2 === b.scope.journeyL2
  const sharedProblemType =
    a.scope?.problemType &&
    b.scope?.problemType &&
    a.scope.problemType === b.scope.problemType
  if (sharedJourneyL2 && sharedProblemType) return true

  const detailsSim = textTokenSimilarity(
    (a.details || []).join(' '),
    (b.details || []).join(' '),
  )
  if (detailsSim >= SEMANTIC_DETAIL_THRESHOLD && (sharedJourneyL2 || sharedProblemType)) {
    return true
  }

  return false
}

/**
 * @param {OverviewRecommendation} primary
 * @param {OverviewRecommendation} secondary
 */
export function mergeRecommendations(primary, secondary) {
  const priorityScore = { high: 3, medium: 2, low: 1 }
  const keep =
    priorityScore[primary.priority] >= priorityScore[secondary.priority]
      ? primary
      : secondary
  const other = keep === primary ? secondary : primary

  /** @type {string[]} */
  const mergedDetails = []
  const detailKeys = new Set()
  for (const d of [...(keep.details || []), ...(other.details || [])]) {
    const trimmed = (d || '').trim()
    if (!trimmed) continue
    const key = dedupeKey(trimmed)
    if (detailKeys.has(key)) continue
    if (mergedDetails.some((x) => textTokenSimilarity(x, trimmed) >= 0.72)) continue
    detailKeys.add(key)
    mergedDetails.push(trimmed)
    if (mergedDetails.length >= 4) break
  }

  const evidenceRecordIds = [
    ...new Set([...(keep.evidenceRecordIds || []), ...(other.evidenceRecordIds || [])]),
  ].slice(0, 8)
  const evidenceTicketIds = [
    ...new Set([...(keep.evidenceTicketIds || []), ...(other.evidenceTicketIds || [])]),
  ].slice(0, 8)

  const notes = [keep.evidenceNote, other.evidenceNote].filter(Boolean)
  const evidenceNote =
    notes.length > 1 ? notes.join('；') : notes[0] || keep.evidenceNote || other.evidenceNote

  const summary = keep.summary || keep.text

  return {
    ...keep,
    text: summary,
    summary,
    details: mergedDetails,
    evidenceRecordIds,
    evidenceTicketIds,
    evidenceNote,
    scope: { ...other.scope, ...keep.scope },
    metrics: keep.metrics?.length ? keep.metrics : other.metrics,
    trackingMetrics: [
      ...new Set([...(keep.trackingMetrics || []), ...(other.trackingMetrics || [])]),
    ],
    measureSource: [keep.measureSource, other.measureSource].filter(Boolean).join(' + ') || keep.measureSource,
  }
}

/**
 * @param {OverviewRecommendation[]} list
 * @param {number} [max]
 */
export function dedupeRecommendationsSemantically(list, max = MAX_RECOMMENDATIONS) {
  /** @type {OverviewRecommendation[]} */
  const merged = []
  for (const rec of list) {
    const contentKey = planningContentAxisKey(rec)
    const axisKey = recommendationAxisKey(rec)
    const idx = merged.findIndex((m) => {
      const mAxis = recommendationAxisKey(m)
      if (axisKey && mAxis && axisKey === mAxis) return true
      const mKey = planningContentAxisKey(m)
      if (contentKey && mKey && contentKey !== mKey) return false
      return recommendationsSimilar(m, rec)
    })
    if (idx >= 0) {
      merged[idx] = mergeRecommendations(merged[idx], rec)
    } else {
      merged.push({ ...rec })
    }
  }
  const priorityScore = { high: 3, medium: 2, low: 1 }
  return merged.sort((a, b) => priorityScore[b.priority] - priorityScore[a.priority]).slice(0, max)
}

/**
 * @param {FeedbackRecord[]} ticketRecords
 * @param {number} [minTickets]
 */
export function listProductsForPlanningCoverage(ticketRecords, minTickets = MIN_PRODUCT_TICKETS_FOR_COVERAGE) {
  return topValues(ticketRecords, 'product', 24)
    .map((p) => p.text)
    .filter((name) => {
      const count = ticketRecords.filter((r) => r.product === name).length
      return name && count >= minTickets
    })
}

/**
 * @param {OverviewRecommendation[]} selected
 * @param {OverviewRecommendation} rec
 * @param {number} maxPerProduct
 */
function canAddRecommendation(selected, rec, maxPerProduct) {
  if (selected.some((s) => recommendationsSimilar(s, rec))) return false
  const prod = recommendationProductName(rec)
  if (!prod) return true
  const sameProdCount = selected.filter((s) => recommendationProductName(s) === prod).length
  if (sameProdCount >= maxPerProduct) return false
  const axis = planningContentAxisKey(rec)
  if (selected.some((s) => planningContentAxisKey(s) === axis)) return false
  return true
}

/**
 * 按产品配额选取：每产品至少 1 条；300+ 单产品 3～8 条；优先产品功能类举措
 *
 * @param {OverviewRecommendation[]} candidates
 * @param {FeedbackRecord[]} ticketRecords
 * @param {number} [max]
 */
export function selectDiversePlanningRecommendations(
  candidates,
  ticketRecords,
  max = computeMaxPlanningRecommendations(ticketRecords),
  mergedByAxisKey = /** @type {Map<string, string[]> | undefined} */ (undefined),
) {
  if (!candidates.length) return []

  const priorityScore = { high: 3, medium: 2, low: 1 }
  const weightedPriority = (rec) =>
    priorityScore[rec.priority] * getSignalWeight(rec.signalType)
  const sortRecs = (list) =>
    [...list].sort((a, b) => {
      const er = compareEvidenceStrength(a.evidenceStrength, b.evidenceStrength)
      if (er !== 0) return er
      const cr = planningCategoryRank(a.category) - planningCategoryRank(b.category)
      if (cr !== 0) return cr
      return weightedPriority(b) - weightedPriority(a)
    })

  const attachMerged = (rec) => {
    const axisKey = `${rec.signalType || ''}:${recommendationAxisKey(rec)}`
    const mergedFrom = mergedByAxisKey?.get(axisKey) || rec.generationMeta?.mergedFrom || []
    if (!mergedFrom.length && rec.generationMeta) return rec
    return {
      ...rec,
      generationMeta: {
        selectedReason:
          rec.generationMeta?.selectedReason || buildGenerationSelectedReason(rec),
        mergedFrom,
        score: weightedPriority(rec),
        signalWeight: getSignalWeight(rec.signalType),
      },
    }
  }

  const products = listProductsForPlanningCoverage(ticketRecords)
  /** @type {OverviewRecommendation[]} */
  const selected = []

  for (const product of products) {
    const productCount = ticketRecords.filter((r) => r.product === product).length
    const quota = targetRecommendationCountForProduct(productCount)
    if (!quota) continue

    const productPool = sortRecs(
      candidates.filter((rec) => recommendationProductName(rec) === product),
    )

    let added = 0
    for (const rec of productPool) {
      if (added >= quota || selected.length >= max) break
      if (canAddRecommendation(selected, rec, quota)) {
        selected.push(attachMerged(rec))
        added += 1
      }
    }

    if (added === 0) {
      const fallback = buildProductCoverageRecommendation(product, ticketRecords)
      if (fallback && canAddRecommendation(selected, fallback, quota) && selected.length < max) {
        selected.push(attachMerged(fallback))
      }
    }
  }

  for (const rec of sortRecs(candidates)) {
    if (selected.length >= max) break
    if (canAddRecommendation(selected, rec, LARGE_PRODUCT_REC_MAX)) {
      selected.push(attachMerged(rec))
    }
  }

  return sortRecs(selected).slice(0, max)
}

/**
 * @param {Object} params
 * @param {string} params.product
 * @param {FeedbackRecord[]} params.pool
 * @param {FeedbackRecord[]} params.productRecords
 * @param {import('./planningRecommendationTemplate.js').PlanningSignalType} params.signalType
 * @param {string} params.idSuffix
 * @param {{ l1: string; l2: string } | null} [params.journeyCtx]
 * @param {string} [params.problemType]
 * @param {string} [params.requestScene]
 * @param {number} params.count
 * @param {number} [params.sharePct]
 * @param {Set<string>} params.coveredProductProblemAxes
 * @param {(rec: Partial<OverviewRecommendation>, pool: FeedbackRecord[]) => void} params.addCandidate
 */
function pushProductAxisCandidate(params) {
  const {
    product,
    pool,
    productRecords,
    signalType,
    idSuffix,
    journeyCtx,
    problemType,
    requestScene,
    count,
    sharePct,
    coveredProductProblemAxes,
    addCandidate,
  } = params

  const rootCauses = topValues(pool, 'rootCause', 2).filter((rc) => isValidRootCause(rc.text))
  const actionItems = collectManualReviewActions(pool, 5)
  const mergedPreview = collectMergedOptimizationDetails(pool, journeyCtx, 2)
  if (!rootCauses[0] && !actionItems.length && mergedPreview.length < 2) return false

  const summary = buildPlanningSummary({
    product,
    journeyL1: journeyCtx?.l1,
    journeyL2: journeyCtx?.l2,
    problemType,
    requestScene,
    rootCause: rootCauses[0],
    topAction: actionItems[0],
    topMeasure: pickTopOptimizationDirection(pool, journeyCtx),
    primaryAction:
      buildProductPrimaryAction(product, {
        journeyL2: journeyCtx?.l2,
        problemType,
        requestScene,
      }) ||
      buildProblemTypePrimaryAction(problemType || '') ||
      undefined,
  })
  if (!summary) return false
  const details = buildPlanningDetails(pool, rootCauses, journeyCtx)
  if (details.length < MIN_DETAILS) return false

  if (problemType) {
    coveredProductProblemAxes.add(`${product}\0${problemType}`)
  }

  let category = recommendationCategory(details[0] || summary, actionItems[0]?.source)
  if (
    category !== 'product' &&
    /控制台|监听|配置|开通|向导|诊断|后端|转发|证书|链路|订单/.test(summary)
  ) {
    category = 'product'
  }

  /** @type {import('./planningRecommendationTemplate.js').PlanningSignalType} */
  const st = signalType
  addCandidate(
    {
      id: `rec-${product}-${idSuffix}`.slice(0, 96),
      signalType: st,
      priority: priorityFromScore(
        count >= productRecords.length * 0.25 ? 9 : count >= productRecords.length * 0.1 ? 7 : 5,
      ),
      category,
      summary,
      details,
      metrics: [
        { label: '产品', value: product },
        ...(journeyCtx?.l2
          ? [
              { label: '二级旅程', value: journeyCtx.l2 },
              { label: '工单数', value: `${count} 条` },
            ]
          : []),
        ...(problemType ? [{ label: '问题类型', value: problemType }] : []),
        ...(requestScene ? [{ label: '请求场景', value: requestScene }] : []),
        ...(sharePct != null ? [{ label: '占该产品', value: `${sharePct}%` }] : []),
      ].filter(Boolean),
      scope: {
        product,
        journeyL1: journeyCtx?.l1,
        journeyL2: journeyCtx?.l2,
        problemType,
        requestScene,
      },
      trackingMetrics: trackingMetricsForSignal(st),
      evidenceNote:
        st === 'journey_hotspot'
          ? buildEvidenceNoteForSignal({
              signalType: 'journey_hotspot',
              journeyL1: journeyCtx?.l1,
              journeyL2: journeyCtx?.l2,
              count,
              topRootCause: rootCauses[0],
            })
          : buildEvidenceNoteForSignal({
              signalType: 'problem_type',
              problemType: problemType || requestScene || '—',
              count,
              sharePct: sharePct ?? 0,
            }),
      measureSource:
        actionItems[0]?.source ||
        (details.some((d) => hasPlanningActionVerb(d)) ? '业务优化举措' : '产品议题'),
    },
    pool,
  )
  return true
}

/**
 * 按产品生成候选：旅程 × 问题类型 × 请求场景（结合工单分布，避免仅全局聚合）
 *
 * @param {string} product
 * @param {FeedbackRecord[]} productRecords
 * @param {number} globalSample
 * @param {(rec: Partial<OverviewRecommendation>, pool: FeedbackRecord[]) => void} addCandidate
 * @param {Set<string>} coveredProductProblemAxes
 */
function buildProductScopedPlanningCandidates(
  product,
  productRecords,
  globalSample,
  addCandidate,
  coveredProductProblemAxes,
) {
  const n = productRecords.length
  if (n < MIN_PRODUCT_TICKETS_FOR_COVERAGE) return

  const minSeg = minAxisRecordsForProduct(n, globalSample)
  const journeyLimit = n >= LARGE_PRODUCT_TICKET_THRESHOLD ? 8 : 5
  const problemLimit = n >= LARGE_PRODUCT_TICKET_THRESHOLD ? 6 : 4
  const sceneLimit = n >= LARGE_PRODUCT_TICKET_THRESHOLD ? 4 : 3

  for (const seg of topValues(productRecords, 'journeyL2', journeyLimit)) {
    if (!seg.text || SKIPPED_JOURNEY_RE.test(seg.text) || seg.count < minSeg) continue
    const l1 = productRecords.find((r) => r.journeyL2 === seg.text)?.journeyL1 || ''
    const pool = productRecords.filter((r) => r.journeyL1 === l1 && r.journeyL2 === seg.text)
    const topPt = topValues(pool, 'problemType', 1)[0]
    const dominantProblemType =
      topPt?.count >= Math.max(3, pool.length * 0.2) ? topPt.text : undefined
    if (dominantProblemType) {
      coveredProductProblemAxes.add(`${product}\0${dominantProblemType}`)
    }
    pushProductAxisCandidate({
      product,
      pool,
      productRecords,
      signalType: 'journey_hotspot',
      idSuffix: `j-${seg.text.slice(0, 12)}`,
      journeyCtx: { l1, l2: seg.text },
      problemType: dominantProblemType,
      count: seg.count,
      sharePct: Math.round((seg.count / n) * 100),
      coveredProductProblemAxes,
      addCandidate,
    })
  }

  for (const pt of topValues(productRecords, 'problemType', problemLimit)) {
    if (!pt.text || SKIPPED_PROBLEM_TYPES.has(pt.text) || pt.count < minSeg) continue
    if (coveredProductProblemAxes.has(`${product}\0${pt.text}`)) continue
    const pool = productRecords.filter((r) => r.problemType === pt.text)
    const journeyCtx = inferJourneyContext(pool)
    pushProductAxisCandidate({
      product,
      pool,
      productRecords,
      signalType: 'problem_type',
      idSuffix: `pt-${pt.text.slice(0, 12)}`,
      journeyCtx,
      problemType: pt.text,
      count: pt.count,
      sharePct: Math.round((pt.count / n) * 100),
      coveredProductProblemAxes,
      addCandidate,
    })
  }

  for (const rs of topValues(productRecords, 'requestScene', sceneLimit)) {
    if (!rs.text || SKIPPED_REQUEST_SCENES.has(rs.text) || rs.count < minSeg) continue
    const pool = productRecords.filter((r) => r.requestScene === rs.text)
    const topPt = topValues(pool, 'problemType', 1)[0]
    const problemType =
      topPt?.count >= Math.max(3, pool.length * 0.25) ? topPt.text : undefined
    const journeyCtx = inferJourneyContext(pool)
    const axisKey = `${product}\0${journeyCtx?.l2 || ''}\0${problemType || ''}\0${rs.text}`
    if (coveredProductProblemAxes.has(`${product}\0${problemType || ''}`) && problemType) {
      continue
    }
    pushProductAxisCandidate({
      product,
      pool,
      productRecords,
      signalType: 'problem_type',
      idSuffix: `rs-${rs.text.slice(0, 10)}`,
      journeyCtx,
      problemType,
      requestScene: rs.text,
      count: rs.count,
      sharePct: Math.round((rs.count / n) * 100),
      coveredProductProblemAxes,
      addCandidate,
    })
    coveredProductProblemAxes.add(axisKey)
  }
}

/**
 * 为周期内某产品补一条基于真实工单分布的行动建议
 * @param {string} product
 * @param {FeedbackRecord[]} ticketRecords
 */
function buildProductCoverageRecommendation(product, ticketRecords) {
  const productRecords = ticketRecords.filter((r) => r.product === product)
  if (productRecords.length < MIN_PRODUCT_TICKETS_FOR_COVERAGE) return null

  const topJourney = topValues(productRecords, 'journeyL2', 1)[0]
  const topProblem = topValues(productRecords, 'problemType', 1)[0]
  if (!topJourney?.text && !topProblem?.text) return null

  const journeyCtx = topJourney?.text
    ? {
        l1: productRecords.find((r) => r.journeyL2 === topJourney.text)?.journeyL1 || '',
        l2: topJourney.text,
      }
    : inferJourneyContext(productRecords)

  if (journeyCtx?.l2 && SKIPPED_JOURNEY_RE.test(journeyCtx.l2)) {
    return null
  }

  const segmentRecords = journeyCtx?.l2
    ? productRecords.filter(
        (r) => r.journeyL1 === journeyCtx.l1 && r.journeyL2 === journeyCtx.l2,
      )
    : productRecords.filter((r) => r.problemType === topProblem?.text)

  const pool = segmentRecords.length ? segmentRecords : productRecords
  const rootCauses = topValues(pool, 'rootCause', 2).filter((rc) => isValidRootCause(rc.text))
  const actionItems = collectManualReviewActions(pool, 5)
  const dominantProblemType =
    topProblem?.count >= Math.max(3, pool.length * 0.2) ? topProblem.text : undefined

  const summary = buildPlanningSummary({
    product,
    journeyL1: journeyCtx?.l1,
    journeyL2: journeyCtx?.l2,
    problemType: dominantProblemType,
    rootCause: rootCauses[0],
    topAction: actionItems[0],
    topMeasure: pickTopOptimizationDirection(pool, journeyCtx),
    primaryAction:
      buildProductPrimaryAction(product, {
        journeyL2: journeyCtx?.l2,
        problemType: dominantProblemType,
      }) ||
      buildProblemTypePrimaryAction(dominantProblemType || '') ||
      undefined,
  })
  const details = buildPlanningDetails(pool, rootCauses, journeyCtx)
  if (!summary || details.length < MIN_DETAILS) return null

  const rec = finalizeRecommendation(
    {
      id: `rec-product-cover-${product}-${journeyCtx?.l2 || topProblem?.text || 'general'}`,
      signalType: journeyCtx?.l2 ? 'journey_hotspot' : 'problem_type',
      priority: priorityFromScore(pool.length >= 20 ? 7 : 5),
      category: 'product',
      summary,
      details,
      metrics: [
        { label: '产品', value: product },
        ...(journeyCtx?.l2
          ? [
              { label: '二级旅程', value: journeyCtx.l2 },
              { label: '工单数', value: `${pool.length} 条` },
            ]
          : [
              { label: '问题类型', value: topProblem?.text || '—' },
              { label: '工单数', value: `${pool.length} 条` },
            ]),
      ],
      scope: {
        product,
        journeyL1: journeyCtx?.l1,
        journeyL2: journeyCtx?.l2,
        problemType: dominantProblemType,
      },
      trackingMetrics: trackingMetricsForSignal(journeyCtx?.l2 ? 'journey_hotspot' : 'problem_type'),
      evidenceNote: journeyCtx?.l2
        ? buildEvidenceNoteForSignal({
            signalType: 'journey_hotspot',
            journeyL1: journeyCtx.l1,
            journeyL2: journeyCtx.l2,
            count: pool.length,
            topRootCause: rootCauses[0],
          })
        : buildEvidenceNoteForSignal({
            signalType: 'problem_type',
            problemType: topProblem?.text,
            count: pool.length,
            sharePct:
              ticketRecords.length > 0
                ? Math.round((pool.length / ticketRecords.length) * 100)
                : 0,
          }),
      measureSource: actionItems[0]?.source || '产品覆盖补全',
    },
    pool,
  )

  return passesActionabilityGate(rec) ? rec : null
}

/**
 * 按优先级截断行动建议（展示/快照兜底，最多 MAX_PLANNING_RECOMMENDATIONS 条）
 * @param {OverviewRecommendation[]} list
 * @param {number} [max]
 */
export function limitPlanningRecommendations(list, max = MAX_RECOMMENDATIONS) {
  const priorityScore = { high: 3, medium: 2, low: 1 }
  return [...(list || [])]
    .sort((a, b) => priorityScore[b.priority] - priorityScore[a.priority])
    .slice(0, max)
}

/**
 * @param {OverviewRecommendation} rec
 * @param {{ month?: string; source?: import('../domain/enums.js').DataSourceType; ticketId?: string; evidenceRecords?: FeedbackRecord[] }} [opts]
 */
export function buildFeedbacksLinkForRecommendation(rec, opts = {}) {
  const params = new URLSearchParams()
  if (opts.month) params.set('month', opts.month)

  const evidenceRecords = opts.evidenceRecords || []
  /** @type {string[]} */
  const ticketIds = []
  const seenTickets = new Set()
  for (const tid of rec.evidenceTicketIds || []) {
    if (tid && !seenTickets.has(tid)) {
      seenTickets.add(tid)
      ticketIds.push(tid)
    }
  }
  for (const fb of evidenceRecords) {
    if (fb.ticketId && !seenTickets.has(fb.ticketId)) {
      seenTickets.add(fb.ticketId)
      ticketIds.push(fb.ticketId)
    }
  }

  if (ticketIds.length) {
    params.set('ticketIds', ticketIds.slice(0, 20).join(','))
  } else {
    const derived = deriveFeedbacksFiltersFromEvidence(evidenceRecords, rec.scope)
    if (opts.source) params.set('source', opts.source)
    else if (derived.source) params.set('source', derived.source)
    if (derived.product) params.set('product', derived.product)
    else if (rec.scope?.product) params.set('product', rec.scope.product)
    if (derived.problemType) params.set('problemType', derived.problemType)
    else if (rec.scope?.problemType) params.set('problemType', rec.scope.problemType)
    if (derived.journeyL1) params.set('journeyL1', derived.journeyL1)
    else if (rec.scope?.journeyL1) params.set('journeyL1', rec.scope.journeyL1)
  }

  const ticketId = opts.ticketId
  if (ticketId) params.set('ticketId', ticketId)

  const q = params.toString()
  return `/feedbacks${q ? `?${q}` : ''}`
}

/**
 * @param {FeedbackRecord[]} records
 * @param {import('../domain/overviewConclusions.js').OverviewRecommendationScope} [scope]
 */
function deriveFeedbacksFiltersFromEvidence(records, scope) {
  if (!records.length) {
    return {
      product: scope?.product,
      problemType: scope?.problemType,
      journeyL1: scope?.journeyL1,
      source: undefined,
    }
  }

  /** @type {Record<string, string | undefined>} */
  const out = {}

  const sources = [...new Set(records.map((r) => r.dataSourceType).filter(Boolean))]
  if (sources.length === 1) out.source = sources[0]

  const product = majorityFieldValue(records, (r) => r.product?.trim())
  if (product) out.product = product
  const problemType = majorityFieldValue(records, (r) => r.problemType?.trim())
  if (problemType) out.problemType = problemType
  const journeyL1 = majorityFieldValue(records, (r) => r.journeyL1?.trim())
  if (journeyL1) out.journeyL1 = journeyL1

  return out
}

/**
 * @param {FeedbackRecord[]} records
 * @param {(r: FeedbackRecord) => string | undefined} pick
 * @param {number} [minShare]
 */
function majorityFieldValue(records, pick, minShare = 0.5) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const r of records) {
    const v = pick(r)
    if (!v) continue
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  if (!counts.size) return undefined
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [value, count] = sorted[0]
  if (count / records.length >= minShare) return value
  return undefined
}

/**
 * 解析建议关联的本地工单记录（用于反馈库 deep link）
 * @param {OverviewRecommendation} rec
 * @param {Map<string, FeedbackRecord>} feedbackByRecordId
 * @param {Map<string, FeedbackRecord>} feedbackByTicketId
 * @returns {FeedbackRecord[]}
 */
export function resolveEvidenceRecordsForRecommendation(
  rec,
  feedbackByRecordId,
  feedbackByTicketId,
) {
  /** @type {FeedbackRecord[]} */
  const list = []
  const seen = new Set()
  const add = (fb) => {
    if (fb?.id && !seen.has(fb.id)) {
      seen.add(fb.id)
      list.push(fb)
    }
  }
  for (const id of rec.evidenceRecordIds || []) {
    add(feedbackByRecordId.get(id))
  }
  for (const tid of rec.evidenceTicketIds || []) {
    add(feedbackByTicketId.get(tid))
  }
  return list
}

/**
 * 从行动建议及其依据工单收集可选产品名（去重排序）。
 * @param {OverviewRecommendation[]} recommendations
 * @param {Map<string, FeedbackRecord> | Record<string, FeedbackRecord>} [feedbackByRecordId]
 * @returns {string[]}
 */
export function collectRecommendationProductOptions(recommendations, feedbackByRecordId) {
  /** @type {Set<string>} */
  const products = new Set()

  const lookup = (id) => {
    if (!feedbackByRecordId || !id) return undefined
    if (feedbackByRecordId instanceof Map) return feedbackByRecordId.get(id)
    return feedbackByRecordId[id]
  }

  for (const rec of recommendations || []) {
    if (rec.scope?.product?.trim()) products.add(rec.scope.product.trim())
    for (const id of rec.evidenceRecordIds || []) {
      const product = lookup(id)?.product?.trim()
      if (product) products.add(product)
    }
  }

  return [...products].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

/**
 * @param {OverviewRecommendation} rec
 * @param {string | undefined | null} product 空值表示不过滤
 * @param {Map<string, FeedbackRecord> | Record<string, FeedbackRecord>} [feedbackByRecordId]
 */
export function recommendationMatchesProduct(rec, product, feedbackByRecordId) {
  const filter = product?.trim()
  if (!filter) return true
  if (rec.scope?.product === filter) return true

  const lookup = (id) => {
    if (!feedbackByRecordId || !id) return undefined
    if (feedbackByRecordId instanceof Map) return feedbackByRecordId.get(id)
    return feedbackByRecordId[id]
  }

  for (const id of rec.evidenceRecordIds || []) {
    if (lookup(id)?.product === filter) return true
  }
  return false
}

/**
 * @param {OverviewRecommendation[]} recommendations
 * @param {string | undefined | null} product
 * @param {Map<string, FeedbackRecord> | Record<string, FeedbackRecord>} [feedbackByRecordId]
 * @returns {OverviewRecommendation[]}
 */
export function filterRecommendationsByProduct(recommendations, product, feedbackByRecordId) {
  if (!product?.trim()) return recommendations || []
  return (recommendations || []).filter((rec) =>
    recommendationMatchesProduct(rec, product, feedbackByRecordId),
  )
}

/**
 * @param {FeedbackRecord[]} records
 * @param {number} [limit]
 */
export function pickEvidenceRecords(records, limit = 5) {
  if (!records.length) {
    return { recordIds: [], ticketIds: [] }
  }

  /** @type {Map<string, FeedbackRecord>} */
  const byRoot = new Map()
  const unclustered = []

  for (const r of records) {
    const root = (r.rootCause || r.problemSummary || '').trim().slice(0, 60)
    if (root.length >= 8) {
      if (!byRoot.has(root)) byRoot.set(root, r)
    } else {
      unclustered.push(r)
    }
  }

  /** @type {FeedbackRecord[]} */
  const picked = []
  const seen = new Set()

  const consider = (r) => {
    if (!r?.id || seen.has(r.id)) return
    seen.add(r.id)
    picked.push(r)
  }

  const sortedClusters = [...byRoot.entries()].sort((a, b) => {
    const countA = records.filter(
      (x) => (x.rootCause || x.problemSummary || '').trim().slice(0, 60) === a[0],
    ).length
    const countB = records.filter(
      (x) => (x.rootCause || x.problemSummary || '').trim().slice(0, 60) === b[0],
    ).length
    return countB - countA
  })

  for (const [, r] of sortedClusters) {
    if (picked.length >= limit) break
    consider(r)
  }

  const rest = [...records].sort((a, b) => {
    const sa = isNegativeSentiment(a.sentiment) ? 1 : 0
    const sb = isNegativeSentiment(b.sentiment) ? 1 : 0
    return sb - sa
  })

  for (const r of rest) {
    if (picked.length >= limit) break
    consider(r)
  }

  for (const r of unclustered) {
    if (picked.length >= limit) break
    consider(r)
  }

  return {
    recordIds: picked.map((r) => r.id),
    ticketIds: picked.map((r) => r.ticketId).filter(Boolean),
  }
}

/**
 * @param {Partial<OverviewRecommendation> & Pick<OverviewRecommendation, 'id' | 'summary' | 'signalType'>} rec
 * @param {FeedbackRecord[]} evidencePool
 * @param {number} [periodTicketCount]
 */
function finalizeRecommendation(rec, evidencePool, periodTicketCount = 0) {
  const pool =
    evidencePool.length > 0
      ? evidencePool
      : rec.evidenceRecordIds?.length
        ? []
        : []

  let { recordIds, ticketIds } = pickEvidenceRecords(pool, 5)
  if (rec.evidenceRecordIds?.length) {
    recordIds = rec.evidenceRecordIds
  }
  if (rec.evidenceTicketIds?.length) {
    ticketIds = rec.evidenceTicketIds
  }

  const insufficientEvidence = pool.length > 0 && pool.length < MIN_EVIDENCE
  const measureSource = rec.measureSource || ''

  const base = sanitizePlanningRecommendation(/** @type {OverviewRecommendation} */ ({
    id: rec.id,
    priority: rec.priority || 'medium',
    category: rec.category || 'product',
    text: (rec.summary || rec.text || '').trim(),
    summary: (rec.summary || rec.text || '').trim(),
    details: (rec.details || []).filter(Boolean).slice(0, PLANNING_RECOMMENDATION_LIMITS.maxDetails),
    metrics: rec.metrics || [],
    evidenceRecordIds: recordIds,
    evidenceTicketIds: ticketIds,
    evidenceNote:
      rec.evidenceNote ||
      (insufficientEvidence
        ? `样本 ${pool.length} 条（不足 ${MIN_EVIDENCE} 条，建议结合更多数据复核）`
        : ''),
    scope: rec.scope,
    signalType: rec.signalType,
    trackingMetrics: rec.trackingMetrics,
    linkedJourneyL2: rec.scope?.journeyL2 || rec.linkedJourneyL2,
    measureSource,
    insufficientEvidence,
    generationMeta: rec.generationMeta,
  }))

  const evidenceStrength = computeRecommendationEvidenceStrength(
    pool,
    insufficientEvidence,
    measureSource,
  )
  const evidenceBundle =
    pool.length > 0
      ? buildRecommendationEvidenceBundle(pool, periodTicketCount)
      : rec.evidenceBundle

  return {
    ...base,
    evidenceStrength,
    evidenceBundle,
    generationMeta: base.generationMeta || {
      selectedReason: buildGenerationSelectedReason(base, pool),
      mergedFrom: [],
    },
  }
}

const TEMPORARY_WORKAROUND_RE = /已协助|请客户观察|临时规避|临时方案|先观察|协助客户/

/**
 * @param {string} text
 */
function isTemporaryWorkaroundText(text) {
  if (!text?.trim()) return true
  return TEMPORARY_WORKAROUND_RE.test(text.trim())
}

/**
 * 仅采纳人工复核提炼的可执行举措（不含工单回单/打标模板）
 * @param {FeedbackRecord[]} records
 * @param {number} [limit]
 */
export function collectManualReviewActions(records, limit = 6) {
  /** @type {Map<string, { text: string; count: number; source: string; priority: number }>} */
  const map = new Map()

  const add = (text, source, priority) => {
    const t = text?.trim()
    if (
      !t ||
      t.length < 15 ||
      isGenericRecommendationText(t) ||
      isTemporaryWorkaroundText(t) ||
      isTicketDerivedPlanningText(t)
    ) {
      return
    }
    const key = t.slice(0, 100)
    const prev = map.get(key)
    if (prev) {
      prev.count += 1
      prev.priority = Math.max(prev.priority, priority)
    } else {
      map.set(key, { text: t, count: 1, source, priority })
    }
  }

  for (const fb of records) {
    add(fb.manualReviewAction, '人工复核举措', 5)
    add(fb.manualReviewSolution, '人工复核方案', 4)
  }

  return [...map.values()]
    .sort((a, b) => b.priority - a.priority || b.count - a.count)
    .slice(0, limit)
}

/**
 * 从工单字段提炼可执行要点（人工复核 > LLM 建议 > 处理方案）
 * @param {FeedbackRecord[]} records
 * @param {number} [limit]
 */
export function collectActionItemsFromRecords(records, limit = 6) {
  /** @type {Map<string, { text: string; count: number; source: string; priority: number }>} */
  const map = new Map()

  const add = (text, source, priority) => {
    const t = text?.trim()
    if (
      !t ||
      t.length < 15 ||
      isGenericRecommendationText(t) ||
      isTemporaryWorkaroundText(t) ||
      isTicketDerivedPlanningText(t)
    ) {
      return
    }
    const key = t.slice(0, 100)
    const prev = map.get(key)
    if (prev) {
      prev.count += 1
      prev.priority = Math.max(prev.priority, priority)
    } else {
      map.set(key, { text: t, count: 1, source, priority })
    }
  }

  for (const fb of records) {
    add(fb.manualReviewAction, '人工复核举措', 5)
    add(fb.manualReviewSolution, '人工复核方案', 4)
  }
  for (const fb of records) {
    const s = fb.optimizationSuggestion?.trim()
    if (!s) continue
    for (const p of s.split(/[。；;]/).map((x) => x.trim()).filter((x) => x.length >= 15)) {
      add(p, '工单优化建议', 3)
    }
  }
  for (const fb of records) {
    add(fb.solutionSummary, '处理方案', 2)
  }

  return [...map.values()]
    .sort((a, b) => b.priority - a.priority || b.count - a.count)
    .slice(0, limit)
}

/**
 * @param {FeedbackRecord[]} records
 */
function inferJourneyContext(records) {
  const topL2 = topValues(records, 'journeyL2', 1)[0]
  if (!topL2?.text) return null
  const l1 = records.find((r) => r.journeyL2 === topL2.text)?.journeyL1 || ''
  return { l1, l2: topL2.text }
}

/**
 * @param {string} text
 */
function stripPlanningDecorations(text) {
  return (text || '')
    .replace(/^【[^】]+】/, '')
    .replace(/^\d+\s*单(?:提及|提炼)[：:]\s*/, '')
    .replace(/^\d+\s*[、.【][^】]*】?\s*/, '')
    .trim()
}

/**
 * 是否为占比/单量复述或工单现象描述（应留在 evidenceNote，不出现在概述/详细意见）
 * @param {string} text
 */
export function isStatsOrDescriptiveText(text) {
  if (!text?.trim()) return true
  if (isTicketDerivedPlanningText(text)) return true
  const t = text.trim()
  if (/^(本期|投诉|咨询|主诉|次因|主因)/.test(t) && /\d+\s*单/.test(t)) return true
  if (/\d+\s*单（占\s*\d+%）/.test(t)) return true
  if (/占(该组|比)\s*\d+%/.test(t)) return true
  if (/类问题占\s*\d+%/.test(t)) return true
  if (/^\d+\s*单(?:提及|提炼)/.test(t)) return true
  if (/万投比|环比\s*[+\-]?\d+%|负面占比\s*\d+%/.test(t)) return true
  if (/作为降万投首要治理对象/.test(t)) return true
  if (/工单量环比/.test(t)) return true
  if (/优先治理根因「/.test(t) && /\d+\s*单/.test(t)) return true
  if (/次因「/.test(t) && /纳入下一迭代/.test(t)) return true
  if (/Top\s*根因「/.test(t) && !PLANNING_ACTION_RE.test(t)) return true
  if (/客户反馈|用户反映|工单显示|受理内容/.test(t) && !PLANNING_ACTION_RE.test(t)) return true
  const statHits = (t.match(/\d+\s*单|占\s*\d+%|万投比|环比/g) || []).length
  if (statHits >= 2) return true
  if (statHits >= 1 && t.length < 48 && !PLANNING_ACTION_RE.test(t)) return true
  return false
}

/**
 * @param {string} text
 */
function hasPlanningActionVerb(text) {
  return PLANNING_ACTION_RE.test(text || '')
}

/**
 * 将举措/工单要点规范为可执行规划表述（去掉单量、占比与工单复述前缀）
 * @param {string} text
 */
export function normalizePlanningDetail(text) {
  let t = stripPlanningDecorations(text)
  if (!t) return null
  t = t
    .replace(/（\d+\s*单）/g, '')
    .replace(/\d+\s*单[，,、]/g, '')
    .replace(/占\s*该组\s*\d+%[，,]?/g, '')
    .replace(/类问题占\s*\d+%[，,]?/g, '类问题，')
    .replace(/占\s*\d+%[，,]?/g, '')
    .replace(
      /^针对根因「[^」]+」[，,]?/,
      '针对该类根因，',
    )
    .replace(
      /^针对高频根因「[^」]+」[，,]?/,
      '针对该类高频根因，',
    )
    .replace(
      /^「[^」]+」类问题占\s*\d+%[，,]?/,
      '针对该类高频问题，',
    )
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (t.length < 12 || isGenericRecommendationText(t) || isStatsOrDescriptiveText(t)) {
    return null
  }
  if (!hasPlanningActionVerb(t)) return null
  return t.length > PLANNING_RECOMMENDATION_LIMITS.maxDetailLength
    ? `${t.slice(0, PLANNING_RECOMMENDATION_LIMITS.maxDetailLength - 1)}…`
    : t
}

/**
 * @param {string} [source]
 */
function isTrustedManualActionSource(source) {
  return /人工复核/.test(source || '')
}

/**
 * @param {string} text
 */
function sanitizePlanningSummary(text) {
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  const normalized = normalizePlanningDetail(trimmed)
  if (normalized) return normalized
  if (
    !isStatsOrDescriptiveText(trimmed) &&
    !isGenericRecommendationText(trimmed) &&
    hasPlanningActionVerb(trimmed)
  ) {
    return trimmed.length > PLANNING_RECOMMENDATION_LIMITS.maxSummaryLength
      ? `${trimmed.slice(0, PLANNING_RECOMMENDATION_LIMITS.maxSummaryLength - 1)}…`
      : trimmed
  }
  return null
}

/**
 * 最终清洗：概述/详细意见不得含占比复述或工单现象描述
 * @param {OverviewRecommendation} rec
 * @returns {OverviewRecommendation}
 */
export function sanitizePlanningRecommendation(rec) {
  const summary =
    sanitizePlanningSummary(rec.summary || rec.text || '') ||
    sanitizePlanningSummary(rec.text || '') ||
    ''

  /** @type {string[]} */
  const details = []
  const detailKeys = new Set()
  for (const raw of rec.details || []) {
    const line = normalizePlanningDetail(raw)
    if (!line || detailKeys.has(dedupeKey(line))) continue
    if (details.some((d) => textTokenSimilarity(d, line) >= 0.85)) continue
    detailKeys.add(dedupeKey(line))
    details.push(line)
    if (details.length >= PLANNING_RECOMMENDATION_LIMITS.maxDetails) break
  }

  return {
    ...rec,
    text: summary || rec.text || '',
    summary: summary || rec.summary || rec.text || '',
    details,
  }
}

/**
 * @param {Object} ctx
 * @param {string} [ctx.product]
 * @param {string} [ctx.journeyL1]
 * @param {string} [ctx.journeyL2]
 * @param {string} [ctx.problemType]
 * @param {string} [ctx.requestScene]
 * @param {{ text: string }} [ctx.rootCause]
 * @param {{ text: string; source?: string }} [ctx.topAction]
 * @param {string} [ctx.topMeasure]
 * @param {string} [ctx.primaryAction]
 */
function buildPlanningSummary(ctx) {
  const measureLine = ctx.topMeasure ? normalizePlanningDetail(ctx.topMeasure) : null
  const trustedAction =
    ctx.topAction && isTrustedManualActionSource(ctx.topAction.source)
      ? normalizePlanningDetail(ctx.topAction.text)
      : null

  /** @type {string | null} */
  let primary =
    ctx.primaryAction ||
    (ctx.product
      ? buildProductPrimaryAction(ctx.product, {
          journeyL2: ctx.journeyL2,
          problemType: ctx.problemType,
          requestScene: ctx.requestScene,
        })
      : null) ||
    measureLine ||
    trustedAction

  if (!primary) {
    primary = normalizePlanningDetail(buildFallbackPrimaryAction(ctx)) || buildFallbackPrimaryAction(ctx)
  }

  if (!primary || isStatsOrDescriptiveText(primary) || !hasPlanningActionVerb(primary)) {
    return null
  }

  return formatScopedSummary(buildScopeLabelFromContext(ctx), primary)
}

/**
 * @param {{ text: string; source: string; count?: number }} m
 */
function formatBusinessMeasureDetail(m) {
  return m.text
}

/**
 * @param {{ text: string; source: string; count?: number; priority?: number }} item
 */
function formatActionItemDetail(item) {
  return item.text
}

const MEASURE_SOURCE_SCORE = {
  人工复核举措: 50,
  人工复核方案: 45,
  根因归纳: 32,
  '环节 playbook': 30,
  '类型 playbook': 28,
  '阶段 playbook': 24,
  类型归纳: 18,
}

/**
 * 合并工单要点与业务优化举措（环节 playbook / 工单提炼等）
 * @param {FeedbackRecord[]} records
 * @param {{ l1?: string; l2?: string } | null} [journey]
 * @param {number} [limit]
 */
export function collectMergedOptimizationDetails(records, journey, limit = 4) {
  /** @type {{ text: string; score: number; source: string }[]} */
  const pool = []
  const seen = new Set()

  const push = (text, source, score) => {
    const t = text?.trim()
    if (!t || isGenericRecommendationText(t) || isTemporaryWorkaroundText(t)) return
    const key = dedupeKey(t)
    if (seen.has(key)) return
    seen.add(key)
    pool.push({ text: t, source, score })
  }

  for (const item of collectManualReviewActions(records, 4)) {
    const normalized = normalizePlanningDetail(formatActionItemDetail(item))
    if (!normalized) continue
    push(normalized, item.source, (MEASURE_SOURCE_SCORE[item.source] || 10) + item.count)
  }

  const journeyCtx = journey?.l1
    ? journey
    : inferJourneyContext(records)

  if (journeyCtx?.l1) {
    const measures = synthesizePlanningMeasures(records, journeyCtx.l1, journeyCtx.l2 || '')
    for (const m of measures) {
      const normalized = normalizePlanningDetail(formatBusinessMeasureDetail(m))
      if (!normalized) continue
      const score = (MEASURE_SOURCE_SCORE[m.source] || 10) + (m.count || 0)
      push(normalized, m.source, score)
    }
  }

  return pool
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.text)
}

/**
 * @param {FeedbackRecord[]} records
 * @param {{ l1?: string; l2?: string } | null} [journey]
 * @param {{ text: string; count: number }[]} [rootCauses]
 */
function buildPlanningFallbackDetails(records, journey, rootCauses = []) {
  /** @type {string[]} */
  const details = []
  const journeyCtx = journey?.l1 ? journey : inferJourneyContext(records)
  const ctx = {
    journeyL1: journeyCtx?.l1,
    journeyL2: journeyCtx?.l2,
    problemType: topValues(records, 'problemType', 1)[0]?.text,
  }

  for (const kind of ['journey', 'rootCause', 'problemType']) {
    if (details.length >= PLANNING_RECOMMENDATION_LIMITS.maxDetails) break
    if (kind === 'rootCause' && !rootCauses[0]?.text) continue
    const raw = buildDetailFallbackLine(kind, ctx)
    const line = raw ? normalizePlanningDetail(raw) : null
    if (line && !details.some((d) => textTokenSimilarity(d, line) >= 0.72)) {
      details.push(line)
    }
  }

  return details.slice(0, PLANNING_RECOMMENDATION_LIMITS.maxDetails)
}

/**
 * @param {FeedbackRecord[]} records
 * @param {{ l1?: string; l2?: string } | null} [journey]
 */
function pickTopOptimizationDirection(records, journey) {
  const merged = collectMergedOptimizationDetails(records, journey, 1)
  return merged[0] || null
}

/**
 * @param {FeedbackRecord[]} records
 * @param {{ text: string; count: number }[]} rootCauses
 * @param {{ l1?: string; l2?: string } | null} [journey]
 */
function buildPlanningDetails(records, rootCauses, journey) {
  /** @type {string[]} */
  const details = [...collectMergedOptimizationDetails(records, journey, 4)]

  if (details.length < 2) {
    for (const line of buildPlanningFallbackDetails(records, journey, rootCauses)) {
      if (details.length >= PLANNING_RECOMMENDATION_LIMITS.maxDetails) break
      if (!details.some((d) => textTokenSimilarity(d, line) >= 0.72)) {
        details.push(line)
      }
    }
  }

  return details
    .map((d) => normalizePlanningDetail(d))
    .filter(Boolean)
    .slice(0, PLANNING_RECOMMENDATION_LIMITS.maxDetails)
}

/**
 * @param {OverviewRecommendation} rec
 */
function passesActionabilityGate(rec) {
  const summary = rec.summary || rec.text || ''
  if (!summary || isGenericRecommendationText(summary) || isStatsOrDescriptiveText(summary)) {
    return false
  }
  if (!hasPlanningActionVerb(summary)) return false

  const substantive = (rec.details || [])
    .map((d) => normalizePlanningDetail(d))
    .filter(Boolean)
    .filter((d) => !isGenericRecommendationText(d) && !isStatsOrDescriptiveText(d))
  if (substantive.length < MIN_DETAILS) return false
  if (!substantive.some((d) => hasPlanningActionVerb(d))) return false

  const hasAnchor =
    Boolean(rec.evidenceNote?.trim()) ||
    (rec.metrics?.length ?? 0) >= 1 ||
    (rec.evidenceTicketIds?.length ?? 0) >= 1 ||
    Boolean(rec.scope?.journeyL2 || rec.scope?.problemType || rec.scope?.product)
  return hasAnchor
}

/**
 * @param {import('./productTaxonomy.js').JourneyL1[]} mergedJourney
 * @param {number} [limit]
 */
function topJourneyL2Segments(mergedJourney, limit = 3) {
  /** @type {{ l1: string; l2: string; count: number }[]} */
  const segments = []
  for (const node of mergedJourney || []) {
    for (const child of node.children || []) {
      if (child.count > 0) {
        segments.push({ l1: node.l1, l2: child.l2, count: child.count })
      }
    }
  }
  return segments.sort((a, b) => b.count - a.count).slice(0, limit)
}

/**
 * @param {Object} params
 * @param {FeedbackRecord[]} params.ticketRecords
 * @param {import('./productTaxonomy.js').JourneyL1[]} params.mergedJourney
 * @param {{ name: string; count: number }[]} params.topProblemTypes
 * @param {number} params.sampleSize
 * @param {import('../storage/orderVolumeStore.js').OrderVolumeRow} [params.topWanTou]
 * @param {import('../domain/enums.js').DataSourceType} [params.maxNegativeSource]
 * @param {number} [params.maxNegativePct]
 * @param {number | null} [params.trendDeltaPct]
 * @param {string} [params.trendDirection]
 */
export function buildPlanningRecommendations({
  ticketRecords,
  mergedJourney,
  topProblemTypes,
  sampleSize,
  topWanTou,
  maxNegativeSource,
  maxNegativePct,
  trendDeltaPct,
  trendDirection,
}) {
  /** @type {OverviewRecommendation[]} */
  const candidates = []
  const seen = new Set()
  /** @type {Map<string, string[]>} */
  const mergedByAxisKey = new Map()
  /** @type {Set<string>} */
  const coveredProductProblemAxes = new Set()

  const addCandidate = (rec, evidencePool) => {
    const finalized = finalizeRecommendation(rec, evidencePool, sampleSize)
    if (!passesActionabilityGate(finalized)) return
    const key = `${rec.signalType || ''}:${recommendationAxisKey(finalized)}`
    if (seen.has(key)) {
      const list = mergedByAxisKey.get(key) || []
      list.push(describeRecommendationAxis(finalized))
      mergedByAxisKey.set(key, list)
      return
    }
    seen.add(key)
    candidates.push(finalized)
  }

  const productNames = topValues(ticketRecords, 'product', 24)
    .map((p) => p.text)
    .filter((name) => name && ticketRecords.filter((r) => r.product === name).length >= MIN_PRODUCT_TICKETS_FOR_COVERAGE)

  for (const product of productNames) {
    buildProductScopedPlanningCandidates(
      product,
      ticketRecords.filter((r) => r.product === product),
      sampleSize,
      addCandidate,
      coveredProductProblemAxes,
    )
  }

  if (topWanTou?.productName && topWanTou.displayRatio != null && topWanTou.displayRatio >= 30) {
    const productRecords = ticketRecords.filter((r) => r.product === topWanTou.productName)
    const topPt = topValues(productRecords, 'problemType', 1)[0]
    const rootCauses = topValues(productRecords, 'rootCause', 2).filter((rc) =>
      isValidRootCause(rc.text),
    )
    const actionItems = collectManualReviewActions(productRecords, 5)
    const journeyCtx = inferJourneyContext(productRecords)

    const summary = buildPlanningSummary({
      product: topWanTou.productName,
      problemType: topPt?.text,
      journeyL1: journeyCtx?.l1,
      journeyL2: journeyCtx?.l2,
      rootCause: rootCauses[0],
      topAction: actionItems[0],
      topMeasure: pickTopOptimizationDirection(productRecords, journeyCtx),
      primaryAction:
        normalizePlanningDetail(
          buildPrimaryActionForSignal('wan_tou', {
            product: topWanTou.productName,
            problemType: topPt?.text,
          }),
        ) || undefined,
    })

    const details = buildPlanningDetails(productRecords, rootCauses, journeyCtx)
    if (summary && details.length >= 2) {
      addCandidate(
        {
          id: `rec-wan-tou-${topWanTou.productName}`,
          signalType: 'wan_tou',
          priority: topWanTou.displayRatio >= 50 ? 'high' : 'medium',
          category: 'monitoring',
          summary,
          details: details.slice(0, PLANNING_RECOMMENDATION_LIMITS.maxDetails),
          metrics: [
            { label: '产品', value: topWanTou.productName },
            { label: '万投比', value: formatWanTouRatio(topWanTou.displayRatio) },
            { label: '投诉数', value: String(topWanTou.totalComplaints) },
          ],
          scope: { product: topWanTou.productName, problemType: topPt?.text },
          trackingMetrics: trackingMetricsForSignal('wan_tou'),
          evidenceNote: buildEvidenceNoteForSignal({
            signalType: 'wan_tou',
            product: topWanTou.productName,
            wanTouRatio: formatWanTouRatio(topWanTou.displayRatio),
            complaintCount: topWanTou.totalComplaints,
          }),
          measureSource: actionItems[0]?.source || '万投比异常',
        },
        productRecords.length
          ? productRecords
          : ticketRecords.filter((r) => r.product?.includes(topWanTou.productName.slice(0, 4))),
      )
    }
  }

  const globalRootCauses = topValues(ticketRecords, 'rootCause', 3).filter((rc) =>
    isValidRootCause(rc.text),
  )
  const rootCauseLimit = candidates.length >= 5 ? 1 : candidates.length >= 3 ? 2 : 3
  for (const rc of globalRootCauses.slice(0, rootCauseLimit)) {
    if (rc.count < 3) continue
    const rcRecords = ticketRecords.filter(
      (r) => (r.rootCause || '').trim().slice(0, 100) === rc.text,
    )
    const actionItems = collectManualReviewActions(rcRecords, 5)
    const topJourney = topValues(rcRecords, 'journeyL2', 1)[0]
    const topProduct = topValues(rcRecords, 'product', 1)[0]
    const journeyCtx = topJourney?.count >= 2
      ? {
          l1: rcRecords.find((r) => r.journeyL2 === topJourney.text)?.journeyL1 || '',
          l2: topJourney.text,
        }
      : inferJourneyContext(rcRecords)

    const summary = buildPlanningSummary({
      product: topProduct?.count >= 2 ? topProduct.text : undefined,
      journeyL1: journeyCtx?.l1,
      journeyL2: journeyCtx?.l2,
      rootCause: rc,
      topAction: actionItems[0],
      topMeasure: pickTopOptimizationDirection(rcRecords, journeyCtx),
    })
    if (!summary) continue
    const details = buildPlanningDetails(rcRecords, [rc], journeyCtx)
    if (details.length < 2) continue

    addCandidate(
      {
        id: `rec-root-${rc.text.slice(0, 12)}`,
        signalType: 'root_cause',
        priority: priorityFromScore(rc.count >= 5 ? 7 : 5),
        category: 'product',
        summary,
        details,
        metrics: [{ label: '出现次数', value: `${rc.count} 次` }],
        scope: {
          product: topProduct?.count >= 2 ? topProduct.text : undefined,
          journeyL2: topJourney?.count >= 2 ? topJourney.text : undefined,
        },
        trackingMetrics: trackingMetricsForSignal('root_cause'),
        evidenceNote: buildEvidenceNoteForSignal({
          signalType: 'root_cause',
          topRootCause: rc,
          count: rc.count,
        }),
        measureSource: actionItems[0]?.source || '根因聚类',
      },
      rcRecords,
    )
  }

  if (
    maxNegativeSource &&
    maxNegativePct != null &&
    maxNegativePct >= 25 &&
    candidates.length < 6
  ) {
    const negRecords = ticketRecords.filter(
      (r) => r.dataSourceType === maxNegativeSource && isNegativeSentiment(r.sentiment),
    )
    const topPt = topValues(negRecords.length ? negRecords : ticketRecords, 'problemType', 1)[0]
    const topRc = topValues(negRecords.length ? negRecords : ticketRecords, 'rootCause', 1).filter(
      (r) => isValidRootCause(r.text),
    )[0]
    const actionItems = collectManualReviewActions(
      negRecords.length ? negRecords : ticketRecords,
      3,
    )
    if (!topPt && !topRc && !actionItems.length) {
      // 无具体驱动因素时不输出空泛风险建议
    } else {
      const pool = negRecords.length ? negRecords : ticketRecords
      const journeyCtx = inferJourneyContext(pool)
      const summary = buildPlanningSummary({
        problemType: topPt?.text,
        rootCause: topRc,
        topAction: actionItems[0],
        topMeasure: pickTopOptimizationDirection(pool, journeyCtx),
        primaryAction:
          normalizePlanningDetail(
            buildPrimaryActionForSignal('risk_negative', { dataSourceType: maxNegativeSource }),
          ) || undefined,
      })
      const details = buildPlanningDetails(pool, topRc ? [topRc] : [], journeyCtx)
      if (summary && details.length >= 2 && !isGenericRecommendationText(summary)) {
        addCandidate(
          {
            id: 'rec-negative-sentiment',
            signalType: 'risk_negative',
            priority: maxNegativePct >= 40 ? 'high' : 'medium',
            category: 'process',
            summary,
            details,
            metrics: [
              { label: '来源', value: DATA_SOURCE_LABELS[maxNegativeSource] },
              { label: '负面占比', value: `${maxNegativePct}%` },
            ],
            scope: { problemType: topPt?.text },
            trackingMetrics: trackingMetricsForSignal('risk_negative'),
            evidenceNote: buildEvidenceNoteForSignal({
              signalType: 'risk_negative',
              dataSourceType: maxNegativeSource,
              negativePct: maxNegativePct,
            }),
            measureSource: actionItems[0]?.source || '风险信号',
          },
          pool,
        )
      }
    }
  }

  if (
    trendDirection === 'up' &&
    trendDeltaPct != null &&
    trendDeltaPct >= 15 &&
    candidates.length < 7
  ) {
    const topProd = topValues(ticketRecords, 'product', 1)[0]
    const topPt = topValues(ticketRecords, 'problemType', 1)[0]
    if (topProd || topPt) {
      const driverRecords = topProd
        ? ticketRecords.filter((r) => r.product === topProd.text)
        : ticketRecords.filter((r) => r.problemType === topPt?.text)
      const pool = driverRecords.length ? driverRecords : ticketRecords
      const journeyCtx = inferJourneyContext(pool)
      const summary = buildPlanningSummary({
        product: topProd?.text,
        problemType: topPt?.text,
        journeyL1: journeyCtx?.l1,
        journeyL2: journeyCtx?.l2,
        topMeasure: pickTopOptimizationDirection(pool, journeyCtx),
        primaryAction:
          normalizePlanningDetail(buildPrimaryActionForSignal('risk_trend', {})) || undefined,
      })
      const details = buildPlanningDetails(
        pool,
        topValues(pool, 'rootCause', 2).filter((r) => isValidRootCause(r.text)),
        journeyCtx,
      )
      if (summary && details.length >= 2) {
        addCandidate(
          {
            id: 'rec-trend-up',
            signalType: 'risk_trend',
            priority: trendDeltaPct >= 30 ? 'high' : 'medium',
            category: 'monitoring',
            summary,
            details,
            metrics: [{ label: '环比变化', value: `+${trendDeltaPct}%` }],
            scope: {
              product: topProd?.text,
              problemType: topPt?.text,
            },
            trackingMetrics: trackingMetricsForSignal('risk_trend'),
            evidenceNote: buildEvidenceNoteForSignal({
              signalType: 'risk_trend',
              trendDeltaPct,
            }),
            measureSource: '趋势风险',
          },
          driverRecords.length ? driverRecords : ticketRecords,
        )
      }
    }
  }

  const priorityScore = { high: 3, medium: 2, low: 1 }
  const sorted = candidates.sort((a, b) => {
    const cr = planningCategoryRank(a.category) - planningCategoryRank(b.category)
    if (cr !== 0) return cr
    return priorityScore[b.priority] - priorityScore[a.priority]
  })
  const cap = computeMaxPlanningRecommendations(ticketRecords)
  const deduped = dedupeRecommendationsSemantically(sorted, cap * 2)
  return selectDiversePlanningRecommendations(deduped, ticketRecords, cap, mergedByAxisKey)
}

/**
 * @param {OverviewRecommendation} rec
 */
export function formatRecommendationForExport(rec) {
  /** @type {string[]} */
  const lines = [rec.summary || rec.text]
  if (rec.details?.length) {
    lines.push(PLANNING_EXPORT_LABELS.details)
    lines.push(...rec.details.map((d, i) => `${i + 1}. ${d}`))
  }
  if (rec.evidenceNote) {
    lines.push(`${PLANNING_EXPORT_LABELS.evidenceNote}${rec.evidenceNote}`)
  }
  if (rec.metrics?.length) {
    lines.push(rec.metrics.map((m) => `${m.label}：${m.value}`).join(' · '))
  }
  if (rec.evidenceTicketIds?.length) {
    lines.push(`${PLANNING_EXPORT_LABELS.evidenceTickets}${rec.evidenceTicketIds.join('、')}`)
  }
  if (rec.trackingMetrics?.length) {
    lines.push(`${PLANNING_EXPORT_LABELS.trackingMetrics}${rec.trackingMetrics.join('、')}`)
  }
  return lines.join('\n')
}
