import { randomId } from '../lib/randomId.js'
/** @typedef {import('./enums.js').TagCandidateStatus} TagCandidateStatus */
/** @typedef {import('./enums.js').TagType} TagType */
/** @typedef {import('./enums.js').DataSourceType} DataSourceType */

/**
 * @typedef {Object} TagCandidate
 * @property {string} id
 * @property {string} tenantId
 * @property {string} [insightPeriodId]
 * @property {DataSourceType} [dataSourceType]
 * @property {string} [recordId]
 * @property {TagType} tagType
 * @property {string} proposedLabel
 * @property {string} [canonicalLabel]
 * @property {string} [taxonomyKey]
 * @property {string} [journeyL1]
 * @property {string} [journeyL2]
 * @property {string} [evidenceExcerpt]
 * @property {string} [targetGroup] 写入配置分组键（problem_type | journey:{key}）
 * @property {string} [tagMeaning] 标签释义（复核展示，非工单原文）
 * @property {string} [explanation] 同 tagMeaning（兼容旧数据）
 * @property {string} [reviewHint] 出现次数/采集方式等复核提示
 * @property {'llm' | 'local_overflow'} origin
 * @property {TagCandidateStatus} status
 * @property {number} [occurrenceCount]
 * @property {string} createdAt
 * @property {string} [reviewedAt]
 * @property {string} [reviewNote]
 */

/**
 * @param {Partial<TagCandidate> & Pick<TagCandidate, 'tagType' | 'proposedLabel'>} input
 * @returns {TagCandidate}
 */
export function createTagCandidate(input) {
  const now = new Date().toISOString()
  return {
    id: input.id || randomId(),
    tenantId: input.tenantId || 'local',
    insightPeriodId: input.insightPeriodId,
    dataSourceType: input.dataSourceType,
    recordId: input.recordId,
    tagType: input.tagType,
    proposedLabel: input.proposedLabel.slice(0, 64),
    canonicalLabel: input.canonicalLabel,
    taxonomyKey: input.taxonomyKey,
    journeyL1: input.journeyL1,
    journeyL2: input.journeyL2,
    evidenceExcerpt: input.evidenceExcerpt?.slice(0, 200),
    targetGroup: input.targetGroup,
    tagMeaning: input.tagMeaning?.slice(0, 500),
    explanation: (input.explanation || input.tagMeaning)?.slice(0, 500),
    reviewHint: input.reviewHint?.slice(0, 200),
    origin: input.origin || 'llm',
    status: input.status || 'pending',
    occurrenceCount: input.occurrenceCount ?? 1,
    createdAt: input.createdAt || now,
    reviewedAt: input.reviewedAt,
    reviewNote: input.reviewNote,
  }
}

/**
 * 归一化提议标签，避免「A > B」与「A>B」、首尾空格等被当成不同标签
 * @param {TagCandidate} candidate
 */
export function normalizeProposedLabel(candidate) {
  if (candidate.tagType === 'journey_l2' || candidate.tagType === 'journey_l1') {
    const l1 = (candidate.journeyL1 || candidate.proposedLabel.split('>')[0] || '').trim()
    const l2 = (
      candidate.journeyL2 ||
      candidate.proposedLabel.split('>')[1] ||
      candidate.proposedLabel ||
      ''
    )
      .trim()
    return `${l1} > ${l2}`.replace(/\s+/g, ' ').trim()
  }
  return (candidate.proposedLabel || '').trim().replace(/\s+/g, ' ')
}

/**
 * 去重范围：请求场景、问题类型为全产品共用，不应按工单 productKey 拆分
 * @param {TagCandidate} candidate
 */
function dedupeScopeKey(candidate) {
  if (candidate.tagType === 'problem_type' || candidate.tagType === 'request_scene') {
    return 'generic'
  }
  return candidate.taxonomyKey || 'generic'
}

/**
 * @param {TagCandidate} candidate
 */
export function candidateDedupeKey(candidate) {
  return `${candidate.tagType}::${dedupeScopeKey(candidate)}::${normalizeProposedLabel(candidate)}`
}
