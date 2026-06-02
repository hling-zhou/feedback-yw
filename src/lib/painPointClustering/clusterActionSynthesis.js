import { topValues } from '../journeyInsights.js'
import { inferPlanningJourneyContext, collectPlanningPlaybookActionLines } from '../planningPlaybook.js'
import {
  buildProblemTypePrimaryAction,
  PLANNING_RECOMMENDATION_LIMITS,
} from '../planningRecommendationTemplate.js'
import {
  extractClusterPainTheme,
  extractDemandClause,
  getClusteringPainText,
  getInsightPainText,
  normalizeClusteringPainText,
  pickInsightRepresentativePain,
} from './clusteringCorpus.js'
import { pickRepresentativePainPoint } from './clusterLabel.js'

/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */

export const CLUSTER_SYNTHESIZED_ACTION_COUNT = 2

/** 群组合成规则版本；快照 sections 低于此版本时展示层会重算 productActions */
export const CLUSTER_ACTION_SYNTHESIS_VERSION = 5

const MAX_ACTION_LEN = PLANNING_RECOMMENDATION_LIMITS.maxDetailLength

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
 * @param {string} journeyL1
 * @param {string} journeyL2
 */
function formatJourneyPath(journeyL1, journeyL2) {
  if (journeyL2 && !/未知|未识别/.test(journeyL2)) {
    if (journeyL1 && !/未知|未识别/.test(journeyL1)) {
      return `${journeyL1}→${journeyL2}`
    }
    return journeyL2
  }
  return ''
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
 * @param {string} product
 * @param {string} journeyL2
 * @param {string} theme
 */
function buildThemeJourneyAction(_product, _journeyL2, theme) {
  if (theme && theme !== '该类体验问题') {
    return truncateAction(
      `围绕${theme}，完善产品能力说明、控制台引导与自助查询，降低重复咨询成本。`,
    )
  }
  return truncateAction(
    '完善产品能力说明、控制台引导与自助查询，降低重复咨询成本。',
  )
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
 * @param {FeedbackRecord[]} pool
 * @param {OverviewRecommendation} rec
 * @param {string} problemType
 */
function buildPlaybookProductAction(pool, rec, problemType) {
  const journeyCtx = inferPlanningJourneyContext(pool)
  const lines = collectPlanningPlaybookActionLines({
    records: pool,
    product: rec.scope?.product || pool[0]?.product?.trim() || '',
    journeyL1: rec.scope?.journeyL1 || journeyCtx?.l1,
    journeyL2: rec.scope?.journeyL2 || journeyCtx?.l2,
    problemType,
  })
  return lines.find((line) => isProductClusterAction(line)) || ''
}

/**
 * 群组级轻量合成：代表痛点 + 高频 journey/问题类型 → 2 条 productActions
 * @param {OverviewRecommendation} rec
 * @param {FeedbackRecord[]} pool
 * @param {string} [representativePain]
 * @returns {string[]}
 */
export function synthesizeClusterProductActions(rec, pool, representativePain = '') {
  if (!pool.length) return []

  const pain = resolveClusterPain(rec, pool, representativePain)
  if (!pain) return []

  const theme = extractClusterPainTheme(pain)
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
  const product = rec.scope?.product || pool[0]?.product?.trim() || ''
  const journeyPath = formatJourneyPath(journeyL1, journeyL2)

  const action1 = buildThemeJourneyAction(product, journeyL2 || journeyPath.split('→').pop() || '', theme)

  let action2 =
    buildProductTypeAction(problemType, journeyL2 || journeyPath.split('→').pop() || '') ||
    truncateAction(buildPlaybookProductAction(pool, rec, problemType))

  if (!action2 || action2.slice(0, 40) === action1.slice(0, 40)) {
    action2 = buildProductTypeAction(
      problemType === '产品功能咨询' ? '配额与权限申请' : '产品功能咨询',
      journeyL2,
    )
  }
  if (!action2 || action2.slice(0, 40) === action1.slice(0, 40)) {
    action2 = truncateAction(
      '补充规则 FAQ、计费/配额说明与典型操作样例，减少重复咨询。',
    )
  }

  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const line of [action1, action2]) {
    if (!isProductClusterAction(line)) continue
    const key = line.slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= CLUSTER_SYNTHESIZED_ACTION_COUNT) break
  }
  return out
}
