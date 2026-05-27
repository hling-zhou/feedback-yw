import {
  MAX_PLANNING_RECOMMENDATIONS,
  PLANNING_RECOMMENDATION_LIMITS,
} from '../lib/planningRecommendationTemplate.js'

/** @typedef {import('./enums.js').DataSourceType} DataSourceType */

/** 综合概述背景解读模块：摘要 + 分维度洞察 */
export const OVERVIEW_INSIGHTS_PANEL_TITLE = '周期洞察概览'

/** PDF / 报告章节前缀 */
export const OVERVIEW_INSIGHTS_REPORT_PREFIX = '周期洞察'

/** 周期洞察概览 · 摘要区块标题（UI / 报告） */
export const OVERVIEW_EXECUTIVE_SUMMARY_TITLE = '摘要'

/** 行动建议独立模块（产品规划主价值区） */
export const PLANNING_RECOMMENDATIONS_PANEL_TITLE = '行动建议'

export { MAX_PLANNING_RECOMMENDATIONS, PLANNING_RECOMMENDATION_LIMITS }

export const PLANNING_RECOMMENDATIONS_PANEL_SUBTITLE =
  '基于工单洞察按产品归纳可落地举措（优先产品功能设计，其次体验与流程）；大单量产品结合旅程/场景/问题类型输出 3～8 条'

/** 行动建议区块锚点 id */
export const PLANNING_RECOMMENDATIONS_ANCHOR_ID = 'planning-recommendations'

/** @typedef {'executive' | 'product' | 'problem_type' | 'journey' | 'cross_source' | 'risk'} OverviewConclusionHighlightType */

/** @typedef {'product' | 'process' | 'docs' | 'monitoring'} RecommendationCategory */

/**
 * @typedef {Object} OverviewConclusionEvidence
 * @property {string} label
 * @property {string} value
 */

/**
 * @typedef {Object} OverviewConclusionHighlight
 * @property {string} id
 * @property {OverviewConclusionHighlightType} type
 * @property {string} title
 * @property {string} body
 * @property {OverviewConclusionEvidence[]} metrics
 * @property {DataSourceType[]} [sources]
 * @property {DataSourceType} [drillTab]
 */

/**
 * @typedef {Object} OverviewRecommendationScope
 * @property {string} [product]
 * @property {string} [journeyL1]
 * @property {string} [journeyL2]
 * @property {string} [problemType]
 * @property {string} [requestScene]
 */

/** @typedef {'strong' | 'moderate' | 'weak'} EvidenceStrength */

/**
 * @typedef {Object} RecommendationEvidenceBundle
 * @property {number} ticketCount
 * @property {number} [negativeCount]
 * @property {number} [sharePct]
 * @property {{ ticketId: string; problemSummary?: string; rootCause?: string }[]} [sampleSummaries]
 * @property {string[]} [topRootCauses] - 已弃用展示，旧快照可能仍含此字段
 * @property {string[]} [manualActions]
 */

/**
 * @typedef {Object} RecommendationGenerationMeta
 * @property {string} selectedReason
 * @property {string[]} [mergedFrom]
 * @property {number} [score]
 * @property {number} [signalWeight]
 */

/** @typedef {'accepted' | 'in_progress' | 'done' | 'dismissed'} RecommendationWorkflowStatus */

/**
 * @typedef {Object} RecommendationUserOverride
 * @property {RecommendationWorkflowStatus} [status]
 * @property {string} [summary]
 * @property {string[]} [details]
 * @property {string} [owner]
 * @property {string} [dueDate]
 * @property {string} [note]
 * @property {string} updatedAt
 */

/** @typedef {'new' | 'persist' | 'priority_up' | 'priority_down'} RecommendationPeriodChange */

/**
 * @typedef {Object} RecommendationPeriodCompare
 * @property {RecommendationPeriodChange} change
 * @property {string} [previousId]
 * @property {'high' | 'medium' | 'low'} [previousPriority]
 */

/**
 * @typedef {Object} OverviewRecommendation
 * @property {string} id
 * @property {'high' | 'medium' | 'low'} priority
 * @property {RecommendationCategory} category
 * @property {string} text 兼容旧版：等同 summary
 * @property {string} summary 概述（1～2 句）
 * @property {string[]} [details] 详细意见（2～4 条）
 * @property {OverviewConclusionEvidence[]} [metrics]
 * @property {string[]} [evidenceRecordIds]
 * @property {string[]} [evidenceTicketIds]
 * @property {string} [evidenceNote]
 * @property {OverviewRecommendationScope} [scope]
 * @property {string} [signalType]
 * @property {string[]} [trackingMetrics]
 * @property {boolean} [insufficientEvidence]
 * @property {EvidenceStrength} [evidenceStrength]
 * @property {RecommendationEvidenceBundle} [evidenceBundle]
 * @property {RecommendationGenerationMeta} [generationMeta]
 * @property {RecommendationUserOverride} [userOverride]
 * @property {RecommendationPeriodCompare} [periodCompare]
 * @property {string} [linkedJourneyL2]
 * @property {string} [measureSource]
 */

/**
 * @typedef {Object} OverviewRecommendationsMeta
 * @property {string} [ruleVersion]
 * @property {string} [playbookVersion]
 * @property {string} [signalWeightsVersion]
 * @property {string} [previousPeriodId]
 * @property {number} [generatedRecommendationCount]
 * @property {number} [cappedCount]
 * @property {number} [removedFromPreviousCount]
 */

/**
 * @typedef {Object} OverviewRecommendationsLlmMeta
 * @property {string} polishedAt
 * @property {string} [model]
 * @property {string[]} [itemIds]
 */

/**
 * @typedef {Object} OverviewConclusions
 * @property {string} generatedAt
 * @property {'rule' | 'hybrid'} source
 * @property {number} sampleSize
 * @property {string} periodLabel
 * @property {string} [periodMonth] YYYY-MM，用于反馈库联动
 * @property {string} [insightPeriodId]
 * @property {string} executiveSummary
 * @property {string} [ruleExecutiveSummary] 规则版摘要（LLM 润色后保留）
 * @property {string} [llmPolishedAt]
 * @property {string[]} dataCoverageNotes
 * @property {OverviewConclusionHighlight[]} highlights
 * @property {OverviewRecommendation[]} recommendations
 * @property {OverviewRecommendationsMeta} [recommendationsMeta]
 * @property {OverviewRecommendationsLlmMeta} [recommendationsLlm]
 * @property {boolean} [insufficientData]
 */

export {}
