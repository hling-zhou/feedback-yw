import {
  MAX_PLANNING_RECOMMENDATIONS,
  PLANNING_RECOMMENDATION_LIMITS,
} from '../lib/planningRecommendationTemplate.js'

/** @typedef {import('./enums.js').DataSourceType} DataSourceType */

/** 行动建议独立模块（产品规划主价值区） */
export const PLANNING_RECOMMENDATIONS_PANEL_TITLE = '行动建议'

export { MAX_PLANNING_RECOMMENDATIONS, PLANNING_RECOMMENDATION_LIMITS }

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

/** @typedef {'new' | 'persist' | 'priority_up' | 'priority_down'} RecommendationPeriodChange */

/**
 * @typedef {Object} RecommendationPeriodCompare
 * @property {RecommendationPeriodChange} change
 * @property {string} [previousId]
 * @property {'high' | 'medium' | 'low'} [previousPriority]
 */

/**
 * @typedef {Object} PlanningPainCluster
 * @property {string} text
 * @property {number} count
 * @property {number} [sharePct] - 占簇内工单占比（%）
 * @property {boolean} [isRepresentative] - 是否与代表痛点一致
 */

/**
 * @typedef {Object} PlanningRootCauseItem
 * @property {string} text
 * @property {number} count
 */

/**
 * @typedef {Object} PlanningClusterRootCause
 * @property {string} [contextNote] - 分析范围/环节说明
 * @property {string[]} [dataMetrics] - 数据表现
 * @property {PlanningPainCluster[]} [painClusters] - 痛点聚类
 * @property {PlanningRootCauseItem[]} [rootCauses] - 根因聚类
 * @property {string} [businessImpact] - 业务影响
 */

/**
 * @typedef {Object} PlanningVerification
 * @property {string[]} metrics - 指标监控
 * @property {string} userValidation - 用户验证
 */

/**
 * @typedef {Object} PainClusterScoreMeta
 * @property {number} priorityScore
 * @property {number} rank
 * @property {number} totalFinal
 * @property {number} breadthScore
 * @property {number} sharePct
 * @property {number} ticketCount
 * @property {number} harmScore
 * @property {number} maxSeverity
 * @property {number} p90Emotion
 * @property {string[]} sourceDistributionLines
 * @property {string} customerTierSummary
 * @property {Record<string, number>} [customerTierCounts]
 */

/**
 * @typedef {Object} PlanningRecommendationSections
 * @property {string} [executiveSummary] - 执行摘要（核心发现，1 句）
 * @property {PlanningClusterRootCause | string} [clusterRootCause] - 问题聚类与根因（结构化；旧快照可能为 string）
 * @property {PainClusterScoreMeta} [painClusterScores] - V2 痛点聚类 §8 评分与分布
 * @property {string} [opportunities] - 已废弃（旧快照兼容，UI/导出均忽略）
 * @property {string[]} [productActions] - 产品/技术优化（≥2）
 * @property {string[]} [serviceActions] - 服务/流程改进（按需）
 * @property {PlanningVerification | string} [verification] - 闭环验证（结构化；旧快照可能为 string）
 */

/**
 * @typedef {Object} OverviewRecommendation
 * @property {string} id
 * @property {'high' | 'medium' | 'low'} priority
 * @property {RecommendationCategory} category
 * @property {string} text 兼容旧版：等同 summary
 * @property {string} summary 概述（1～2 句）
 * @property {string[]} [details] 详细意见（2～4 条）
 * @property {PlanningRecommendationSections} [sections] 五段式结构（与 details 同步）
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
 * @property {RecommendationPeriodCompare} [periodCompare]
 * @property {string} [linkedJourneyL2]
 * @property {string} [measureSource]
 */

/**
 * @typedef {Object} OverviewRecommendationsMeta
 * @property {string} [ruleVersion]
 * @property {string} [playbookVersion]
 * @property {string} [signalWeightsVersion]
 * @property {'pain_cluster_v2' | 'legacy_planning'} [recommendationEngine]
 * @property {boolean} [legacyFallback]
 * @property {string} [previousPeriodId]
 * @property {number} [generatedRecommendationCount]
 * @property {number} [cappedCount]
 * @property {number} [removedFromPreviousCount]
 * @property {boolean} [displaySuppressed]
 * @property {number} [smallProductFallbackCount]
 * @property {import('./enums.js').DataSourceType} [dataSourceType] 本源典型问题结论标记
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
