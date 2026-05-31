import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'
import { normalizeInsightPeriod, recordMatchesPeriod, resolveInsightPeriod } from '../domain/insightPeriod.js'
import {
  overviewSnapshotId,
  sourceSnapshotId,
} from '../domain/snapshot.js'

/**
 * @typedef {import('../domain/enums.js').DataSourceType} DataSourceType
 * @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod
 * @typedef {import('../domain/records.js').InsightRecord} InsightRecord
 */

/**
 * @typedef {Object} ClearImportedDataOptions
 * @property {boolean} [all] 显式全部清空（须为 true；空对象不再视为全部清空）
 * @property {string} [insightPeriodId]
 * @property {DataSourceType} [dataSourceType]
 */

/**
 * @typedef {Object} ClearImportedDataResult
 * @property {number} recordsDeleted
 * @property {number} snapshotsDeleted
 * @property {number} runsDeleted
 * @property {number} artifactsDeleted
 * @property {number} pendingTagCandidatesDeleted
 */

/**
 * @param {unknown} value
 * @returns {value is DataSourceType}
 */
function isDataSourceType(value) {
  return typeof value === 'string' && DATA_SOURCE_TYPES.includes(/** @type {DataSourceType} */ (value))
}

/**
 * @param {Record<string, unknown> | ClearImportedDataOptions | null | undefined} input
 * @returns {ClearImportedDataOptions}
 */
export function parseClearImportedDataOptions(input) {
  if (!input || typeof input !== 'object') return {}
  if (input.scope === 'all' || input.all === true || input.all === 'true') {
    return { all: true }
  }
  const insightPeriodId =
    typeof input.insightPeriodId === 'string' ? input.insightPeriodId.trim() : ''
  const dataSourceType = isDataSourceType(input.dataSourceType) ? input.dataSourceType : undefined
  return {
    ...(insightPeriodId ? { insightPeriodId } : {}),
    ...(dataSourceType ? { dataSourceType } : {}),
  }
}

/**
 * @param {ClearImportedDataOptions} options
 */
export function isClearAllImportedData(options) {
  return options.all === true
}

/**
 * @param {ClearImportedDataOptions} options
 */
export function validateClearImportedDataOptions(options) {
  if (isClearAllImportedData(options)) return null
  if (!options.insightPeriodId && !options.dataSourceType) {
    return '请指定洞察周期与/或数据来源；全部清空须使用 scope=all'
  }
  return null
}

/**
 * 设置页「清空选中范围」：须同时选定周期与来源，避免误删
 * @param {ClearImportedDataOptions} options
 */
export function validateScopedClearOptions(options) {
  const base = validateClearImportedDataOptions(options)
  if (base) return base
  if (!options.insightPeriodId || !options.dataSourceType) {
    return '请同时勾选「指定洞察周期」并选择数据来源（如投诉工单）'
  }
  return null
}

/**
 * 清空范围的人类可读描述（用于确认框）
 * @param {ClearImportedDataOptions} options
 * @param {{ label?: string } | null} [period]
 */
export function describeClearImportedScope(options, period = null) {
  if (isClearAllImportedData(options)) {
    return '全部洞察周期 · 全部数据来源'
  }
  const parts = []
  if (options.insightPeriodId) {
    parts.push(`洞察周期：${period?.label || options.insightPeriodId}`)
  } else {
    parts.push('洞察周期：不限制')
  }
  if (options.dataSourceType) {
    parts.push(`数据来源：${DATA_SOURCE_LABELS[options.dataSourceType] || options.dataSourceType}`)
  } else {
    parts.push('数据来源：不限制')
  }
  return parts.join(' · ')
}

/**
 * 过宽清空范围的风险提示（仅指定周期或仅指定来源时范围大于用户直觉）
 * @param {ClearImportedDataOptions} options
 */
export function describeClearImportedScopeRisk(options) {
  if (isClearAllImportedData(options)) {
    return '将删除库内全部反馈、快照与分析记录（所有月份、所有来源，含咨询工单与历史投诉）。'
  }
  const risks = []
  if (options.dataSourceType && !options.insightPeriodId) {
    const label = DATA_SOURCE_LABELS[options.dataSourceType] || options.dataSourceType
    risks.push(`仅按来源清空：将删除所有月份、所有洞察周期内的「${label}」（例如含 2022 年投诉），不会删除其他来源。`)
  }
  if (options.insightPeriodId && !options.dataSourceType) {
    risks.push(
      '仅按周期清空：将删除该周期数据月份范围内的全部来源（投诉、咨询、用后即评等），不限于投诉工单。',
    )
  }
  if (options.insightPeriodId && options.dataSourceType) {
    return '将仅删除上述周期与来源的交集数据，其它月份或其它来源保留。'
  }
  return risks.join(' ')
}

/**
 * @param {InsightRecord} record
 * @param {ClearImportedDataOptions} options
 * @param {InsightPeriod | null} [period]
 */
export function recordMatchesClearFilter(record, options, period = null) {
  if (isClearAllImportedData(options)) return true
  if (options.dataSourceType && (record.dataSourceType || 'complaint_ticket') !== options.dataSourceType) {
    return false
  }
  if (options.insightPeriodId) {
    const normalized =
      period != null
        ? normalizeInsightPeriod(period)
        : resolveInsightPeriod(options.insightPeriodId, null)
    if (normalized) {
      if (!recordMatchesPeriod(record, normalized)) return false
    } else if (record.insightPeriodId) {
      if (record.insightPeriodId !== options.insightPeriodId) return false
    } else {
      return false
    }
  }
  return true
}

/**
 * @param {string} snapshotId
 * @param {ClearImportedDataOptions} options
 */
export function snapshotMatchesClearFilter(snapshotId, options) {
  if (isClearAllImportedData(options)) return true
  if (options.insightPeriodId && options.dataSourceType) {
    return snapshotId === sourceSnapshotId(options.dataSourceType, options.insightPeriodId)
  }
  if (options.insightPeriodId) {
    return (
      snapshotId === overviewSnapshotId(options.insightPeriodId) ||
      snapshotId.startsWith(`snapshot:${options.insightPeriodId}:`)
    )
  }
  if (options.dataSourceType) {
    return snapshotId.startsWith('snapshot:') && snapshotId.endsWith(`:${options.dataSourceType}`)
  }
  return false
}

/**
 * @param {import('../domain/analysisRun.js').AnalysisRun} run
 * @param {ClearImportedDataOptions} options
 */
export function analysisRunMatchesClearFilter(run, options) {
  if (isClearAllImportedData(options)) return true
  if (options.insightPeriodId && run.insightPeriodId !== options.insightPeriodId) return false
  if (options.dataSourceType && run.dataSourceType !== options.dataSourceType) return false
  return true
}

/**
 * @param {import('../domain/tagCandidate.js').TagCandidate} candidate
 * @param {ClearImportedDataOptions} options
 * @param {Set<string>} [deletedRecordIds]
 */
export function pendingTagCandidateMatchesClearFilter(candidate, options, deletedRecordIds) {
  if (candidate.status !== 'pending') return false
  if (isClearAllImportedData(options)) return true
  if (candidate.recordId && deletedRecordIds?.has(candidate.recordId)) return true
  if (options.dataSourceType && candidate.dataSourceType !== options.dataSourceType) return false
  if (options.insightPeriodId && candidate.insightPeriodId !== options.insightPeriodId) {
    return false
  }
  if (!options.insightPeriodId && !options.dataSourceType) return false
  return true
}
