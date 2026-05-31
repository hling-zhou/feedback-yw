import { recommendationCompareKey } from './planningRecommendationCompare.js'
import { PLANNING_SECTION_LABELS } from './planningRecommendationSections.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/overviewConclusions.js').RecommendationUserOverride} RecommendationUserOverride */
/** @typedef {import('../domain/overviewConclusions.js').PlanningClusterRootCause} PlanningClusterRootCause */
/** @typedef {import('../domain/overviewConclusions.js').PlanningVerification} PlanningVerification */
/** @typedef {import('../domain/overviewConclusions.js').PlanningRecommendationSections} PlanningRecommendationSections */

/** 洞察概览 · 行动建议：是否展示「机会点挖掘」（暂时关闭） */
export const SHOW_PLANNING_OPPORTUNITIES = false

export const WORKFLOW_STATUS_LABELS = {
  accepted: '已采纳',
  in_progress: '进行中',
  done: '已完成',
  dismissed: '不适用',
}

/**
 * 行动建议概述解析（导出 / 人工编辑等沿用）
 * @param {OverviewRecommendation} rec
 */
export function resolveRecommendationSummary(rec) {
  const overrideSummary = rec.userOverride?.summary?.trim()
  if (overrideSummary) return overrideSummary
  return (
    rec.sections?.executiveSummary?.trim() ||
    rec.summary?.trim() ||
    rec.text?.trim() ||
    ''
  )
}

/**
 * @param {OverviewRecommendation} rec
 */
export function resolveEffectiveRecommendation(rec) {
  const override = rec.userOverride
  if (!override) return rec
  const summary = resolveRecommendationSummary(rec)
  const sections =
    rec.sections && override.summary?.trim()
      ? { ...rec.sections, executiveSummary: summary }
      : rec.sections
  return {
    ...rec,
    summary,
    text: summary,
    sections,
    details: override.details?.length ? override.details : rec.details,
    priority: rec.priority,
    category: rec.category,
  }
}

/**
 * @param {OverviewRecommendation[]} recommendations
 */
export function resolveEffectiveRecommendations(recommendations) {
  return (recommendations || []).map(resolveEffectiveRecommendation)
}

/**
 * @param {OverviewRecommendation[]} newRecs
 * @param {OverviewRecommendation[]} [oldRecs]
 */
export function preserveRecommendationUserOverrides(newRecs, oldRecs = []) {
  /** @type {Map<string, RecommendationUserOverride>} */
  const overrideByKey = new Map()
  for (const rec of oldRecs) {
    if (rec.userOverride) {
      overrideByKey.set(recommendationCompareKey(rec), rec.userOverride)
    }
  }
  return newRecs.map((rec) => {
    const override = overrideByKey.get(recommendationCompareKey(rec))
    if (!override) return rec
    return { ...rec, userOverride: override }
  })
}

/**
 * @param {OverviewRecommendation[]} recs
 * @param {'high' | 'medium' | 'low'} priority
 * @param {import('../domain/overviewConclusions.js').RecommendationCategory} category
 * @param {number} [max]
 */
export function recommendationsForMatrixCell(recs, priority, category, max = 2) {
  return recs
    .filter((r) => r.priority === priority && r.category === category)
    .slice(0, max)
}

/**
 * @param {OverviewRecommendation[]} recs
 */
export function groupRecommendationsByProduct(recs) {
  /** @type {Map<string, OverviewRecommendation[]>} */
  const map = new Map()
  for (const rec of recs) {
    const product = rec.scope?.product?.trim() || '跨产品'
    if (!map.has(product)) map.set(product, [])
    map.get(product).push(rec)
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
}

/**
 * @param {string | PlanningClusterRootCause | undefined} input
 * @returns {PlanningClusterRootCause | undefined}
 */
export function normalizeClusterRootCause(input) {
  if (!input) return undefined
  if (typeof input === 'object') return input

  /** @type {PlanningClusterRootCause} */
  const out = { painClusters: [], rootCauses: [], dataMetrics: [] }
  const segments = String(input)
    .split(/(?=高频痛点：|需求痛点聚集：|根因「|高频根因：|数据表现：|业务影响：)/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const seg of segments.length ? segments : [String(input)]) {
    if (seg.startsWith('需求痛点聚集：') || seg.startsWith('高频痛点：')) {
      const body = seg.replace(/^(?:需求痛点聚集|高频痛点)：/, '')
      for (const part of body.split(/[；;]/)) {
        const m = part.match(/「([^」]+)」\s*(\d+)\s*单/)
        if (m) out.painClusters.push({ text: m[1], count: Number(m[2]) })
      }
    } else if (seg.startsWith('根因「')) {
      const m = seg.match(/根因「([^」]+)」\s*(\d+)\s*单/)
      if (m) out.rootCauses.push({ text: m[1], count: Number(m[2]) })
    } else if (seg.startsWith('高频根因：')) {
      const body = seg.replace(/^高频根因：/, '')
      for (const part of body.split(/[；;]/)) {
        const m = part.match(/「([^」]+)」\s*(\d+)\s*单/)
        if (m) out.rootCauses.push({ text: m[1], count: Number(m[2]) })
      }
    } else if (seg.startsWith('数据表现：')) {
      out.dataMetrics.push(seg.replace(/^数据表现：/, '').trim())
    } else if (seg.startsWith('业务影响：')) {
      out.businessImpact = seg.replace(/^业务影响：/, '').trim()
    } else if (!out.contextNote) {
      out.contextNote = seg
    }
  }

  if (
    !out.contextNote &&
    !out.painClusters.length &&
    !out.rootCauses.length &&
    !out.dataMetrics.length &&
    !out.businessImpact
  ) {
    out.contextNote = String(input).trim()
  }
  return out
}

/**
 * @param {string | PlanningVerification | undefined} input
 * @returns {PlanningVerification | undefined}
 */
export function normalizeVerification(input) {
  if (!input) return undefined
  if (typeof input === 'object') return input

  const text = String(input).trim()
  const metric = text.match(/指标监控：([^；]+)/)
  const user = text.match(/用户验证：(.+)/)
  if (metric || user) {
    return {
      metrics: metric
        ? metric[1]
            .split(/[、,]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      userValidation: user ? user[1].trim().replace(/[。；]$/, '') : '',
    }
  }
  return {
    metrics: [],
    userValidation: text.replace(/[。；]$/, ''),
  }
}

/**
 * @param {PlanningRecommendationSections | undefined} sections
 */
export function normalizeSectionsForDisplay(sections) {
  if (!sections) return sections
  return {
    ...sections,
    clusterRootCause: normalizeClusterRootCause(sections.clusterRootCause),
    verification: normalizeVerification(sections.verification),
  }
}

/**
 * @param {PlanningClusterRootCause | undefined} cluster
 */
export function formatClusterRootCauseForExport(cluster) {
  if (!cluster) return ''
  const parts = []
  if (cluster.contextNote) parts.push(cluster.contextNote)
  if (cluster.dataMetrics?.length) parts.push(`数据表现：${cluster.dataMetrics.join('，')}`)
  if (cluster.painClusters?.length) {
    parts.push(
      `高频痛点：${cluster.painClusters
        .map((p) => `「${p.text}」${p.count} 单`)
        .join('；')}`,
    )
  }
  if (cluster.rootCauses?.length) {
    parts.push(
      `高频根因：${cluster.rootCauses.map((r) => `「${r.text}」${r.count} 单`).join('；')}`,
    )
  }
  if (cluster.businessImpact) parts.push(`业务影响：${cluster.businessImpact}`)
  return parts.join('。')
}

/**
 * @param {PlanningVerification | undefined} verification
 */
export function formatVerificationForExport(verification) {
  if (!verification) return ''
  const metricPart = verification.metrics?.length
    ? `指标监控：${verification.metrics.join('、')}`
    : ''
  const userPart = verification.userValidation
    ? `用户验证：${verification.userValidation}`
    : ''
  return [metricPart, userPart].filter(Boolean).join('；')
}
