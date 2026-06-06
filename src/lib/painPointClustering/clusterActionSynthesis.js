import { topValues } from '../journeyInsights.js'
import { inferPlanningJourneyContext, collectPlanningPlaybookActionLines } from '../planningPlaybook.js'
import {
  buildProblemTypePrimaryAction,
  PLANNING_RECOMMENDATION_LIMITS,
  stripProductActionAroundPrefix,
} from '../planningRecommendationTemplate.js'
import { collectEffectiveOptimizationsFromRecords } from '../ticketAnalysis/effectiveOptimizationCollect.js'
import {
  extractDemandClause,
  getClusteringPainText,
  getInsightPainText,
  normalizeClusteringPainText,
  pickInsightRepresentativePain,
} from './clusteringCorpus.js'
import { pickRepresentativePainPoint } from './clusterLabel.js'
import {
  pickClusterEstablishedActionForSynthesis,
} from './clusterEstablishedActionCorpus.js'

/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */

export const CLUSTER_SYNTHESIZED_ACTION_COUNT = 2

/** 群组合成规则版本；快照 sections 低于此版本时展示层会重算 productActions */
export const CLUSTER_ACTION_SYNTHESIS_VERSION = 8

const MAX_ACTION_LEN = PLANNING_RECOMMENDATION_LIMITS.maxDetailLength

/** 已废弃的固定通用句，合成时跳过 */
const DEPRECATED_GENERIC_ACTION_RE =
  /完善产品能力说明、控制台引导与自助查询|补充规则 FAQ、计费\/配额说明与典型操作样例/

/** 不应写入 productActions 的服务/流程类表述 */
const SERVICE_ACTION_RE =
  /SLA|回访|工单流转|升级路径|催办|空转|服务流程|响应时效|人工服务|升级\/回访/

/** productActions 应避开的问题类型（归入 serviceActions） */
const SERVICE_ORIENTED_PROBLEM_TYPES = new Set(['人工服务与流程'])

/**
 * @param {string} text
 * @param {number} maxLen
 */
function truncateAction(text, maxLen = MAX_ACTION_LEN) {
  const t = text?.trim()
  if (!t) return ''
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen - 1)}…`
}

/**
 * @param {string} line
 */
function isProductClusterAction(line) {
  return Boolean(line?.trim()) && line.length >= 12 && !SERVICE_ACTION_RE.test(line)
}

/**
 * @param {FeedbackRecord[]} pool
 * @param {string} journeyL2
 * @param {string} declaredType
 */
function inferProblemTypeForCluster(pool, journeyL2, declaredType) {
  const corpus = pool.map((r) => getClusteringPainText(r)).filter(Boolean).join('\n')
  const journeyHint = `${journeyL1Safe(journeyL2)} ${declaredType || ''}`

  if (/配额|共享带宽|数量提升|提升至|上限不足|quota/i.test(corpus)) {
    return '配额与权限申请'
  }
  if (/计费|账单|扣费|资费|计费模式|用量展示/i.test(`${corpus}\n${journeyHint}`)) {
    return '计费与账单'
  }
  if (/配置|操作|控制台|报错|参数/i.test(corpus)) {
    return '配置与操作'
  }
  if (/不通|连通|访问失败|端口/i.test(corpus)) {
    return '可用性/连通性故障'
  }
  if (declaredType && !SERVICE_ORIENTED_PROBLEM_TYPES.has(declaredType)) {
    return declaredType
  }
  if (/咨询|FAQ|能力说明|规则/i.test(`${corpus}\n${journeyHint}`)) {
    return '产品功能咨询'
  }
  return declaredType || '产品功能咨询'
}

/**
 * @param {string} journeyL2
 */
function journeyL1Safe(journeyL2) {
  return journeyL2 || ''
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} pool
 * @param {string} [representativePain]
 */
function resolveClusterPain(rec, pool, representativePain = '') {
  const fromPool = pickInsightRepresentativePain(pool) || pickRepresentativePainPoint(pool)
  for (const candidate of [
    getInsightPainText({ painPoint: representativePain }),
    getInsightPainText({ painPoint: rec.generationMeta?.representativePain }),
    extractDemandClause(representativePain),
    extractDemandClause(rec.generationMeta?.representativePain),
    fromPool,
    normalizeClusteringPainText(rec.summary),
  ]) {
    if (candidate) return candidate
  }
  return ''
}

/**
 * @param {string} line
 */
function isDeprecatedGenericAction(line) {
  return DEPRECATED_GENERIC_ACTION_RE.test(line || '')
}

/**
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} pool
 * @param {string} problemType
 * @param {string} journeyL1
 * @param {string} journeyL2
 * @returns {{ line: string; source: string }[]}
 */
function collectClusterProductActionCandidates(rec, pool, problemType, journeyL1, journeyL2) {
  /** @type {{ line: string; source: string; priority: number }[]} */
  const raw = []

  const push = (line, source, priority) => {
    const normalized = stripProductActionAroundPrefix(line)
    if (!isProductClusterAction(normalized) || isDeprecatedGenericAction(normalized)) return
    raw.push({ line: normalized, source, priority })
  }

  const established = pickClusterEstablishedActionForSynthesis(pool)
  if (established?.text) {
    push(established.text, 'established', 100)
  }

  for (const item of collectEffectiveOptimizationsFromRecords(pool, 8)) {
    if (item.source !== '人工复核优化建议') continue
    if (SERVICE_ACTION_RE.test(item.text)) continue
    push(item.text, item.source, 80)
  }

  const journeyCtx = inferPlanningJourneyContext(pool)
  for (const line of collectPlanningPlaybookActionLines({
    records: pool,
    product: rec.scope?.product || pool[0]?.product?.trim() || '',
    journeyL1: rec.scope?.journeyL1 || journeyL1 || journeyCtx?.l1,
    journeyL2: rec.scope?.journeyL2 || journeyL2 || journeyCtx?.l2,
    problemType,
  })) {
    push(line, 'playbook', 50)
  }

  const typed = buildProductTypeAction(problemType, journeyL2)
  if (typed) push(typed, 'problemType', 40)

  const altType =
    problemType === '产品功能咨询'
      ? '配额与权限申请'
      : problemType === '配额与权限申请'
        ? '配置与操作'
        : '产品功能咨询'
  const altTyped = buildProductTypeAction(altType, journeyL2)
  if (altTyped) push(altTyped, 'problemType-alt', 30)

  /** @type {string[]} */
  const seen = []
  /** @type {{ line: string; source: string }[]} */
  const out = []
  for (const item of raw.sort((a, b) => b.priority - a.priority)) {
    const key = item.line.slice(0, 40)
    if (seen.some((prev) => prev === key || item.line.slice(0, 80) === prev.slice(0, 80))) continue
    seen.push(item.line)
    out.push({ line: item.line, source: item.source })
  }
  return out
}

/**
 * @param {string} problemType
 * @param {string} journeyL2
 */
function buildProductTypeAction(problemType, _journeyL2) {
  const typed = buildProblemTypePrimaryAction(problemType)
  if (!typed || !isProductClusterAction(typed)) return ''
  return truncateAction(typed)
}

/**
 * 群组级轻量合成：确立举措 / 工单优化 / playbook / 问题类型模板，取 2 条不重复举措
 *
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} pool
 * @param {string} [representativePain]
 * @returns {{ actions: string[]; usedEstablishedAction: boolean }}
 */
export function synthesizeClusterProductActions(rec, pool, representativePain = '') {
  if (!pool.length) return { actions: [], usedEstablishedAction: false }

  const pain = resolveClusterPain(rec, pool, representativePain)
  if (!pain) return { actions: [], usedEstablishedAction: false }

  const topL2 = topValues(pool, 'journeyL2', 1)[0]
  const topL1 = topValues(pool, 'journeyL1', 1)[0]
  const journeyL2 = rec.scope?.journeyL2 || topL2?.text || ''
  const journeyL1 =
    rec.scope?.journeyL1 ||
    pool.find((r) => r.journeyL2 === topL2?.text)?.journeyL1 ||
    topL1?.text ||
    ''
  const declaredProblemType = rec.scope?.problemType || topValues(pool, 'problemType', 1)[0]?.text || ''
  const problemType = inferProblemTypeForCluster(pool, journeyL2, declaredProblemType)

  const candidates = collectClusterProductActionCandidates(
    rec,
    pool,
    problemType,
    journeyL1,
    journeyL2,
  )
  const actions = candidates.slice(0, CLUSTER_SYNTHESIZED_ACTION_COUNT).map((item) => item.line)
  const usedEstablishedAction = candidates.some((item) => item.source === 'established') && actions.length >= 1

  return { actions, usedEstablishedAction }
}
