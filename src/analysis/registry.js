import { PIPELINE_VERSION_TICKET } from '../domain/constants.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { getMetricsForSource } from '../metrics/registry.js'
import { TicketAnalysisPipeline } from './pipelines/TicketAnalysisPipeline.js'
import { StubAnalysisPipeline } from './pipelines/StubAnalysisPipeline.js'

/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/**
 * @typedef {Object} PipelineDescriptor
 * @property {string} id
 * @property {DataSourceType} dataSourceType
 * @property {string} label
 * @property {string} pipelineVersion
 * @property {string[]} importPresetIds
 * @property {string[]} snapshotMetrics
 * @property {typeof import('./core/AnalysisPipeline.js').AnalysisPipeline} PipelineClass
 * @property {'production' | 'stub'} implementationStatus
 */

/** @type {PipelineDescriptor[]} */
const DESCRIPTORS = [
  {
    id: 'pipeline-complaint-ticket',
    dataSourceType: 'complaint_ticket',
    label: DATA_SOURCE_LABELS.complaint_ticket,
    pipelineVersion: PIPELINE_VERSION_TICKET,
    importPresetIds: ['mobile-cloud-ticket'],
    snapshotMetrics: getMetricsForSource('complaint_ticket').map((m) => m.id),
    PipelineClass: TicketAnalysisPipeline,
    implementationStatus: 'production',
  },
  {
    id: 'pipeline-consultation-ticket',
    dataSourceType: 'consultation_ticket',
    label: DATA_SOURCE_LABELS.consultation_ticket,
    pipelineVersion: PIPELINE_VERSION_TICKET,
    importPresetIds: ['mobile-cloud-ticket', 'consultation-ticket'],
    snapshotMetrics: getMetricsForSource('consultation_ticket').map((m) => m.id),
    PipelineClass: TicketAnalysisPipeline,
    implementationStatus: 'production',
  },
  {
    id: 'pipeline-post-use-rating',
    dataSourceType: 'post_use_rating',
    label: DATA_SOURCE_LABELS.post_use_rating,
    pipelineVersion: 'post-use-channel-1.0.0',
    importPresetIds: ['post-use-rating'],
    snapshotMetrics: getMetricsForSource('post_use_rating').map((m) => m.id),
    // 双文件渠道导入 + 工作台指标已落地；独立行仍走 Stub 记录工厂
    PipelineClass: StubAnalysisPipeline,
    implementationStatus: 'production',
  },
  {
    id: 'pipeline-user-survey',
    dataSourceType: 'user_survey',
    label: DATA_SOURCE_LABELS.user_survey,
    pipelineVersion: 'survey-stub-0.1.0',
    importPresetIds: ['user-survey'],
    snapshotMetrics: getMetricsForSource('user_survey').map((m) => m.id),
    PipelineClass: StubAnalysisPipeline,
    implementationStatus: 'stub',
  },
  {
    id: 'pipeline-other',
    dataSourceType: 'other',
    label: DATA_SOURCE_LABELS.other,
    pipelineVersion: 'generic-stub-0.1.0',
    importPresetIds: ['generic'],
    snapshotMetrics: getMetricsForSource('other').map((m) => m.id),
    PipelineClass: StubAnalysisPipeline,
    implementationStatus: 'stub',
  },
]

/**
 * @param {DataSourceType} dataSourceType
 */
export function isStubPipeline(dataSourceType) {
  return getPipelineDescriptor(dataSourceType)?.implementationStatus === 'stub'
}

/** @returns {DataSourceType[]} */
export function listStubDataSourceTypes() {
  return DESCRIPTORS.filter((d) => d.implementationStatus === 'stub').map((d) => d.dataSourceType)
}

/**
 * @param {DataSourceType} dataSourceType
 * @returns {PipelineDescriptor | undefined}
 */
export function getPipelineDescriptor(dataSourceType) {
  return DESCRIPTORS.find((d) => d.dataSourceType === dataSourceType)
}

/** @returns {PipelineDescriptor[]} */
export function listPipelineDescriptors() {
  return DESCRIPTORS
}

/**
 * @param {DataSourceType} dataSourceType
 * @returns {import('./core/AnalysisPipeline.js').AnalysisPipeline}
 */
export function createPipeline(dataSourceType) {
  const desc = getPipelineDescriptor(dataSourceType)
  if (!desc) {
    throw new Error(`未注册的数据来源: ${dataSourceType}`)
  }
  return new desc.PipelineClass(desc)
}

/**
 * @param {string} type
 * @returns {type is DataSourceType}
 */
export function isRegisteredSource(type) {
  return DATA_SOURCE_TYPES.includes(/** @type {DataSourceType} */ (type))
}
