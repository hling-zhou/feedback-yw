/**
 * Field Registry — 分析结果导出/导入/Override 的单一字段来源。
 * @see docs/DESIGN-20260601-1.md §2
 */

import {
  formatFollowUpSatisfactionDisplay,
  resolveFollowUpDissatisfiedReasons,
} from './followUpSatisfaction.js'

/** @typedef {import('./enums.js').DataSourceType} DataSourceType */

/**
 * manualTagFields 维度（含 P2-5 将落地的扩展维度）。
 * @typedef {'requestScene' | 'problemType' | 'journey' | 'sentiment' | 'urgency' | 'optimization' | 'customerRequest' | 'painPoint' | 'rootCauseReview' | 'complaintCauseReview'} RegistryManualDimension
 */

/** @typedef {'none' | 'painPrimary' | 'optimizationCorpus'} ClusterRole */

/** @typedef {'A' | 'B1' | 'B2' | 'C' | 'D'} DetailZone */

/**
 * @typedef {Object} FieldDefinition
 * @property {string} fieldKey
 * @property {string} displayName
 * @property {string[]} recordPaths - FeedbackRecord 读写路径（前者优先）
 * @property {boolean} exportable
 * @property {number} [exportOrder] - exportable 时必填
 * @property {boolean} importable
 * @property {number} [importOrder] - importable 时必填
 * @property {boolean} [importRequired] - 导入分析时是否非空校验（R1：排期为 false）
 * @property {RegistryManualDimension | null} [manualDimension] - 导入/详情保存时写入 manualTagFields
 * @property {ClusterRole} clusterRole
 * @property {string | null} [provenanceField] - 库内来源字段（不导出）
 * @property {DataSourceType[] | '*'} applicableSources
 * @property {boolean} [legacy]
 * @property {DetailZone} [detailZone]
 */

/** @typedef {'RESPECT_MANUAL' | 'FORCE_ALL_HUMAN' | 'IMPORT_REPLACE'} OverridePolicy */

/** @type {FieldDefinition[]} */
const FIELD_DEFINITIONS = [
  // —— 导出/导入 v2（需求 §一.4 / §三.2）——
  {
    fieldKey: 'ticketId',
    displayName: '工单号',
    recordPaths: ['ticketId'],
    exportable: true,
    exportOrder: 1,
    importable: true,
    importOrder: 1,
    importRequired: true,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'A',
  },
  {
    fieldKey: 'product',
    displayName: '产品名称',
    recordPaths: ['product'],
    exportable: true,
    exportOrder: 2,
    importable: true,
    importOrder: 2,
    importRequired: true,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'A',
  },
  {
    fieldKey: 'customerRequest',
    displayName: '客户请求内容',
    recordPaths: ['customerRequest'],
    exportable: true,
    exportOrder: 3,
    importable: true,
    importOrder: 3,
    importRequired: true,
    manualDimension: 'customerRequest',
    clusterRole: 'none',
    provenanceField: 'customerRequestSource',
    applicableSources: '*',
    detailZone: 'C',
  },
  {
    fieldKey: 'painPoint',
    displayName: '需求痛点',
    recordPaths: ['painPoint', 'problemSummary'],
    exportable: true,
    exportOrder: 4,
    importable: true,
    importOrder: 4,
    importRequired: true,
    manualDimension: 'painPoint',
    clusterRole: 'painPrimary',
    provenanceField: 'painPointSource',
    applicableSources: '*',
    detailZone: 'C',
  },
  {
    fieldKey: 'requestScene',
    displayName: '请求场景',
    recordPaths: ['requestScene'],
    exportable: true,
    exportOrder: 5,
    importable: true,
    importOrder: 5,
    importRequired: true,
    manualDimension: 'requestScene',
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'B1',
  },
  {
    fieldKey: 'problemType',
    displayName: '问题类型',
    recordPaths: ['problemType'],
    exportable: true,
    exportOrder: 6,
    importable: true,
    importOrder: 6,
    importRequired: true,
    manualDimension: 'problemType',
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'B1',
  },
  {
    fieldKey: 'journeyL1',
    displayName: '用户旅程一级',
    recordPaths: ['journeyL1'],
    exportable: true,
    exportOrder: 7,
    importable: true,
    importOrder: 7,
    importRequired: true,
    manualDimension: 'journey',
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'B1',
  },
  {
    fieldKey: 'journeyL2',
    displayName: '用户旅程二级',
    recordPaths: ['journeyL2'],
    exportable: true,
    exportOrder: 8,
    importable: true,
    importOrder: 8,
    importRequired: true,
    manualDimension: 'journey',
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'B1',
  },
  {
    fieldKey: 'sentiment',
    displayName: '用户情绪',
    recordPaths: ['sentiment'],
    exportable: true,
    exportOrder: 9,
    importable: true,
    importOrder: 9,
    importRequired: true,
    manualDimension: 'sentiment',
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'B1',
  },
  {
    fieldKey: 'urgency',
    displayName: '是否加急',
    recordPaths: ['urgencyLevel'],
    exportable: true,
    exportOrder: 10,
    importable: true,
    importOrder: 10,
    importRequired: false,
    manualDimension: 'urgency',
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'B1',
  },
  {
    fieldKey: 'followUpSatisfaction',
    displayName: '回访满意度',
    recordPaths: ['followUpSatisfaction'],
    exportable: true,
    exportOrder: 11,
    importable: true,
    importOrder: 11,
    importRequired: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: ['complaint_ticket', 'consultation_ticket'],
    detailZone: 'B1',
  },
  {
    fieldKey: 'followUpDissatisfiedReasons',
    displayName: '不满意原因',
    recordPaths: ['followUpSatisfaction'],
    exportable: true,
    exportOrder: 12,
    importable: true,
    importOrder: 12,
    importRequired: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: ['complaint_ticket', 'consultation_ticket'],
    detailZone: 'A',
  },
  {
    fieldKey: 'optimizationProduct',
    displayName: '产品技术优化',
    recordPaths: ['optimizationProduct'],
    exportable: true,
    exportOrder: 13,
    importable: true,
    importOrder: 13,
    importRequired: false,
    manualDimension: 'optimization',
    clusterRole: 'optimizationCorpus',
    applicableSources: '*',
    detailZone: 'C',
  },
  {
    fieldKey: 'optimizationService',
    displayName: '服务流程改进',
    recordPaths: ['optimizationService'],
    exportable: true,
    exportOrder: 14,
    importable: true,
    importOrder: 14,
    importRequired: false,
    manualDimension: 'optimization',
    clusterRole: 'optimizationCorpus',
    applicableSources: '*',
    detailZone: 'C',
  },
  {
    fieldKey: 'productGroupOptimization',
    displayName: '产品组优化建议',
    recordPaths: ['productGroupOptimization'],
    exportable: true,
    exportOrder: 15,
    importable: true,
    importOrder: 15,
    importRequired: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'C',
  },
  {
    fieldKey: 'designerOptimization',
    displayName: '设计师优化建议',
    recordPaths: ['designerOptimization'],
    exportable: true,
    exportOrder: 16,
    importable: true,
    importOrder: 16,
    importRequired: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'C',
  },
  {
    fieldKey: 'establishedAction',
    displayName: '确立举措',
    recordPaths: ['establishedAction', 'manualReviewOptimization'],
    exportable: true,
    exportOrder: 17,
    importable: true,
    importOrder: 17,
    importRequired: false,
    manualDimension: 'optimization',
    clusterRole: 'optimizationCorpus',
    applicableSources: '*',
    detailZone: 'C',
  },
  {
    fieldKey: 'actionSchedule',
    displayName: '排期',
    recordPaths: ['actionSchedule'],
    exportable: true,
    exportOrder: 18,
    importable: true,
    importOrder: 18,
    importRequired: false,
    manualDimension: 'optimization',
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'C',
  },
  {
    fieldKey: 'acceptanceContent',
    displayName: '受理内容',
    recordPaths: ['rawText'],
    exportable: true,
    exportOrder: 19,
    importable: true,
    importOrder: 19,
    importRequired: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'D',
  },
  {
    fieldKey: 'handlingOpinion',
    displayName: '处理意见',
    recordPaths: ['handlingText'],
    exportable: true,
    exportOrder: 20,
    importable: true,
    importOrder: 20,
    importRequired: true,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'D',
  },
  {
    fieldKey: 'rootCauseReview',
    displayName: '根因排查',
    recordPaths: ['rootCauseReview'],
    exportable: true,
    exportOrder: 21,
    importable: true,
    importOrder: 21,
    importRequired: false,
    manualDimension: 'rootCauseReview',
    clusterRole: 'none',
    applicableSources: '*',
    detailZone: 'D',
  },

  // —— 详情扩展（暂不参与 v2 导出）——
  {
    fieldKey: 'actionId',
    displayName: '举措库 ID',
    recordPaths: ['actionId'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
  },

  // —— 终判（详情 B2；不参与 v2 导出）——
  {
    fieldKey: 'complaintCauseL1Final',
    displayName: '投诉原因 一级（终判）',
    recordPaths: ['complaintCauseL1Final'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: ['complaint_ticket'],
    detailZone: 'B2',
  },
  {
    fieldKey: 'complaintCauseL2Final',
    displayName: '投诉原因 二级（终判）',
    recordPaths: ['complaintCauseL2Final'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: ['complaint_ticket'],
    detailZone: 'B2',
  },
  {
    fieldKey: 'complaintCauseL3Final',
    displayName: '投诉原因 三级（终判）',
    recordPaths: ['complaintCauseL3Final'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: ['complaint_ticket'],
    detailZone: 'B2',
  },
  {
    fieldKey: 'complaintCauseL1Review',
    displayName: '投诉原因 一级（终判）人工复核',
    recordPaths: ['complaintCauseL1Review'],
    exportable: false,
    importable: false,
    manualDimension: 'complaintCauseReview',
    clusterRole: 'none',
    applicableSources: ['complaint_ticket'],
    detailZone: 'B3',
  },
  {
    fieldKey: 'complaintCauseL2Review',
    displayName: '投诉原因 二级（终判）人工复核',
    recordPaths: ['complaintCauseL2Review'],
    exportable: false,
    importable: false,
    manualDimension: 'complaintCauseReview',
    clusterRole: 'none',
    applicableSources: ['complaint_ticket'],
    detailZone: 'B3',
  },
  {
    fieldKey: 'complaintCauseL3Review',
    displayName: '投诉原因 三级（终判）人工复核',
    recordPaths: ['complaintCauseL3Review'],
    exportable: false,
    importable: false,
    manualDimension: 'complaintCauseReview',
    clusterRole: 'none',
    applicableSources: ['complaint_ticket'],
    detailZone: 'B3',
  },

  // —— 来源（库内；不导出 §一.3）——
  {
    fieldKey: 'customerRequestSource',
    displayName: '客户请求来源',
    recordPaths: ['customerRequestSource'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
  },
  {
    fieldKey: 'painPointSource',
    displayName: '痛点来源',
    recordPaths: ['painPointSource'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
  },
  {
    fieldKey: 'optimizationSource',
    displayName: '优化建议来源',
    recordPaths: ['optimizationSource'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
  },

  // —— Legacy（退役；旧导出列）——
  {
    fieldKey: 'complaintCauseFinalSummary',
    displayName: '投诉原因（终判）',
    recordPaths: ['complaintCauseL1Final'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: ['complaint_ticket'],
    legacy: true,
  },
  {
    fieldKey: 'problemSummaryLegacy',
    displayName: '问题摘要',
    recordPaths: ['problemSummary'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    legacy: true,
  },
  {
    fieldKey: 'rootCauseLegacy',
    displayName: '根因',
    recordPaths: ['rootCause'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    legacy: true,
  },
  {
    fieldKey: 'optimizationSuggestionLegacy',
    displayName: '优化建议',
    recordPaths: ['optimizationSuggestion'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'optimizationCorpus',
    applicableSources: '*',
    legacy: true,
  },
  {
    fieldKey: 'manualReviewRootCause',
    displayName: '根因（人工复核）',
    recordPaths: ['manualReviewRootCause'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    legacy: true,
  },
  {
    fieldKey: 'manualReviewSolution',
    displayName: '优化方案（人工复核）',
    recordPaths: ['manualReviewSolution'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    legacy: true,
  },
  {
    fieldKey: 'manualReviewAction',
    displayName: '人工复核举措',
    recordPaths: ['manualReviewAction'],
    exportable: false,
    importable: false,
    manualDimension: null,
    clusterRole: 'none',
    applicableSources: '*',
    legacy: true,
  },
]

/** @type {Record<string, FieldDefinition>} */
export const FIELD_REGISTRY = Object.fromEntries(
  FIELD_DEFINITIONS.map((def) => [def.fieldKey, def]),
)

/** @type {FieldDefinition[]} */
export const FIELD_REGISTRY_LIST = [...FIELD_DEFINITIONS]

/**
 * @param {DataSourceType | undefined} [dataSourceType]
 * @returns {boolean}
 */
function matchesApplicableSources(field, dataSourceType) {
  if (field.applicableSources === '*') return true
  if (!dataSourceType) return true
  return field.applicableSources.includes(dataSourceType)
}

/**
 * @param {FieldDefinition} field
 * @param {DataSourceType | undefined} [dataSourceType]
 */
export function isFieldApplicable(field, dataSourceType) {
  return matchesApplicableSources(field, dataSourceType)
}

/**
 * @param {string} fieldKey
 * @returns {FieldDefinition | undefined}
 */
export function getFieldByKey(fieldKey) {
  return FIELD_REGISTRY[fieldKey]
}

/**
 * @param {{ dataSourceType?: DataSourceType; includeLegacy?: boolean }} [options]
 * @returns {FieldDefinition[]}
 */
export function getExportColumns(options = {}) {
  const { dataSourceType, includeLegacy = false } = options
  return FIELD_REGISTRY_LIST.filter(
    (f) =>
      f.exportable &&
      (includeLegacy || !f.legacy) &&
      matchesApplicableSources(f, dataSourceType),
  ).sort((a, b) => (a.exportOrder ?? 0) - (b.exportOrder ?? 0))
}

/**
 * @param {{ includeLegacy?: boolean }} [options]
 * @returns {FieldDefinition[]}
 */
export function getImportColumns(options = {}) {
  const { includeLegacy = false } = options
  return FIELD_REGISTRY_LIST.filter(
    (f) => f.importable && (includeLegacy || !f.legacy),
  ).sort((a, b) => (a.importOrder ?? 0) - (b.importOrder ?? 0))
}

/**
 * 导入分析必填列（displayName），不含排期（R1）。
 * @returns {string[]}
 */
export function getImportRequiredDisplayNames() {
  return getImportColumns()
    .filter((f) => f.importRequired !== false)
    .map((f) => f.displayName)
}

/**
 * @returns {FieldDefinition[]}
 */
export function getLegacyFields() {
  return FIELD_REGISTRY_LIST.filter((f) => f.legacy === true)
}

/**
 * @param {ClusterRole} role
 * @returns {FieldDefinition[]}
 */
export function getFieldsByClusterRole(role) {
  return FIELD_REGISTRY_LIST.filter((f) => f.clusterRole === role)
}

/**
 * 导入/详情保存时应写入 manualTagFields 的维度（去重）。
 * @returns {RegistryManualDimension[]}
 */
export function getImportManualDimensions() {
  /** @type {Set<RegistryManualDimension>} */
  const set = new Set()
  for (const field of getImportColumns()) {
    if (field.manualDimension) set.add(field.manualDimension)
  }
  return [...set]
}

/**
 * displayName → fieldKey（导入表头映射）
 * @returns {Record<string, string>}
 */
export function getImportDisplayNameToFieldKey() {
  return Object.fromEntries(getImportColumns().map((f) => [f.displayName, f.fieldKey]))
}

/**
 * @param {import('../lib/types.js').FeedbackRecord} record
 * @param {FieldDefinition} field
 * @returns {string}
 */
export function readFieldValue(record, field) {
  if (field.fieldKey === 'followUpSatisfaction') {
    return formatFollowUpSatisfactionDisplay(record?.followUpSatisfaction)
  }
  if (field.fieldKey === 'followUpDissatisfiedReasons') {
    return resolveFollowUpDissatisfiedReasons(record?.followUpSatisfaction)
  }
  for (const path of field.recordPaths) {
    const value = record?.[/** @type {keyof typeof record} */ (path)]
    if (value != null && String(value).trim() !== '') {
      return String(value)
    }
  }
  return ''
}
