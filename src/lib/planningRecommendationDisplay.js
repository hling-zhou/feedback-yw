import { PLANNING_SECTION_LABELS, CLUSTER_SUB_LABELS } from './planningRecommendationSections.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/overviewConclusions.js').PlanningClusterRootCause} PlanningClusterRootCause */
/** @typedef {import('../domain/overviewConclusions.js').PlanningVerification} PlanningVerification */
/** @typedef {import('../domain/overviewConclusions.js').PlanningRecommendationSections} PlanningRecommendationSections */

/**
 * 行动建议概述解析（导出等沿用）
 * @param {OverviewRecommendation} rec
 */
export function resolveRecommendationSummary(rec) {
  return (
    rec.sections?.executiveSummary?.trim() ||
    rec.summary?.trim() ||
    rec.text?.trim() ||
    ''
  )
}

/** 概览行动建议 Excel 导出 · V2 痛点聚类列名 */
export const PAIN_CLUSTER_EXPORT_LABELS = {
  priorityScore: '优先级得分',
  rank: '排名',
  breadthScore: '影响广度得分',
  sharePct: '影响广度占比(%)',
  ticketCount: '工单数',
  harmScore: '业务危害度得分',
  maxSeverity: '最高严重度',
  p90Emotion: 'P90情绪',
  sourceDistribution: '来源与一级环节分布',
  customerTierSummary: '高价值客户影响',
  currentPain: '洞察摘要',
}

/** 与概览页「优先级评定」区块标题一致 */
export const PAIN_CLUSTER_SECTION_TITLE = '优先级评定'

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
  if (typeof input === 'object') {
    const {
      rootCauses: _rootCauses,
      contextNote: _contextNote,
      dataMetrics: _dataMetrics,
      ...rest
    } = input
    return rest
  }

  /** @type {PlanningClusterRootCause} */
  const out = { painClusters: [] }
  const segments = String(input)
    .split(/(?=高频痛点：|其他相关痛点：|痛点：|需求痛点聚集：|业务影响：)/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const seg of segments.length ? segments : [String(input)]) {
    if (
      seg.startsWith('需求痛点聚集：') ||
      seg.startsWith('高频痛点：') ||
      seg.startsWith('其他相关痛点：') ||
      seg.startsWith('痛点：')
    ) {
      const body = seg.replace(/^(?:需求痛点聚集|高频痛点|其他相关痛点|痛点)：/, '')
      for (const part of body.split(/[；;]/)) {
        const m = part.match(/「([^」]+)」\s*(\d+)\s*单/)
        if (m) out.painClusters.push({ text: m[1], count: Number(m[2]) })
      }
    } else if (seg.startsWith('业务影响：')) {
      out.businessImpact = seg.replace(/^业务影响：/, '').trim()
    }
  }

  if (!out.painClusters.length && !out.businessImpact) {
    return undefined
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
  const { verification: _removed, ...rest } = sections
  return {
    ...rest,
    clusterRootCause: normalizeClusterRootCause(sections.clusterRootCause),
  }
}

/**
 * @param {PlanningClusterRootCause | undefined} cluster
 */
export function formatClusterRootCauseForExport(cluster) {
  if (!cluster) return ''
  const parts = []
  if (cluster.painClusters?.length) {
    parts.push(
      `${CLUSTER_SUB_LABELS.painClusters}：${cluster.painClusters
        .map((p) => `「${p.text}」${p.count} 单`)
        .join('；')}`,
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

/**
 * @param {import('../domain/overviewConclusions.js').PainClusterScoreMeta | undefined} scores
 * @param {string} [executiveSummary]
 */
export function formatPainClusterScoresForExport(scores, executiveSummary = '') {
  if (!scores) return ''
  /** @type {string[]} */
  const lines = [
    `优先级得分：${scores.priorityScore} 分（排名：${scores.rank}/${scores.totalFinal}）`,
    `影响广度：${scores.breadthScore} 分（占比${scores.sharePct}%，工单${scores.ticketCount}件）`,
    `业务危害度：${scores.harmScore} 分（最高严重度 ${scores.maxSeverity}，P90 情绪 ${scores.p90Emotion}）`,
  ]
  if (scores.sourceDistributionLines?.length) {
    lines.push('来源与一级环节分布：')
    for (const line of scores.sourceDistributionLines) {
      lines.push(`· ${line}`)
    }
  }
  lines.push(`高价值客户影响：${scores.customerTierSummary}`)
  return lines.join('\n')
}

/**
 * @param {import('../domain/overviewConclusions.js').PainClusterScoreMeta | undefined} scores
 * @param {string} [executiveSummary]
 */
export function painClusterScoresToExportFields(scores, executiveSummary = '') {
  const empty = {
    [PAIN_CLUSTER_EXPORT_LABELS.priorityScore]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.rank]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.breadthScore]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.sharePct]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.ticketCount]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.harmScore]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.maxSeverity]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.p90Emotion]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.sourceDistribution]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.customerTierSummary]: '',
    [PAIN_CLUSTER_EXPORT_LABELS.currentPain]: executiveSummary.trim(),
  }
  if (!scores) return empty
  return {
    [PAIN_CLUSTER_EXPORT_LABELS.priorityScore]: scores.priorityScore,
    [PAIN_CLUSTER_EXPORT_LABELS.rank]: `${scores.rank}/${scores.totalFinal}`,
    [PAIN_CLUSTER_EXPORT_LABELS.breadthScore]: scores.breadthScore,
    [PAIN_CLUSTER_EXPORT_LABELS.sharePct]: scores.sharePct,
    [PAIN_CLUSTER_EXPORT_LABELS.ticketCount]: scores.ticketCount,
    [PAIN_CLUSTER_EXPORT_LABELS.harmScore]: scores.harmScore,
    [PAIN_CLUSTER_EXPORT_LABELS.maxSeverity]: scores.maxSeverity,
    [PAIN_CLUSTER_EXPORT_LABELS.p90Emotion]: scores.p90Emotion,
    [PAIN_CLUSTER_EXPORT_LABELS.sourceDistribution]: (scores.sourceDistributionLines || []).join('\n'),
    [PAIN_CLUSTER_EXPORT_LABELS.customerTierSummary]: scores.customerTierSummary,
    [PAIN_CLUSTER_EXPORT_LABELS.currentPain]: executiveSummary.trim(),
  }
}

/**
 * 与 PlanningRecommendationSectionsView 一致的结构化正文（PDF / 全文导出）
 * @param {PlanningRecommendationSections | undefined} sections
 * @param {string} [summary]
 */
export function formatRecommendationSectionsForExport(sections, summary = '') {
  if (!sections) return ''
  const normalized = normalizeSectionsForDisplay(sections) || sections
  const executiveSummary = summary.trim() || normalized.executiveSummary?.trim() || ''
  /** @type {string[]} */
  const lines = []

  if (executiveSummary) {
    lines.push('【洞察摘要】')
    lines.push(executiveSummary)
  }

  if (normalized.painClusterScores) {
    lines.push(`【${PAIN_CLUSTER_SECTION_TITLE}】`)
    lines.push(formatPainClusterScoresForExport(normalized.painClusterScores))
  }

  const cluster = normalizeClusterRootCause(normalized.clusterRootCause)
  const hasCluster =
    cluster && (cluster.painClusters?.length || cluster.businessImpact)
  if (hasCluster) {
    lines.push(`【${PLANNING_SECTION_LABELS.clusterRootCause}】`)
    lines.push(formatClusterRootCauseForExport(cluster))
  }

  const productActions = normalized.productActions || []
  const serviceActions = normalized.serviceActions || []
  if (productActions.length || serviceActions.length) {
    lines.push('【可执行改进建议】')
    if (productActions.length) {
      lines.push(`${PLANNING_SECTION_LABELS.productActions}：`)
      productActions.forEach((action, index) => lines.push(`${index + 1}. ${action}`))
    }
    if (serviceActions.length) {
      lines.push(`${PLANNING_SECTION_LABELS.serviceActions}：`)
      serviceActions.forEach((action, index) => lines.push(`${index + 1}. ${action}`))
    }
  }

  return lines.filter(Boolean).join('\n')
}

/**
 * 行动建议 PDF 正文（与概览页卡片 sections 一致）
 * @param {OverviewRecommendation} rec
 */
export function buildRecommendationExportFullText(rec) {
  const summary = resolveRecommendationSummary(rec)
  const body = formatRecommendationSectionsForExport(rec.sections, summary)
  if (body) return body
  return summary
}
