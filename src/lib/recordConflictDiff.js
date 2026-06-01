import { getEstablishedActionDisplay } from '../domain/establishedAction.js'
import { getFieldByKey } from '../domain/fieldRegistry.js'
import {
  getCustomerRequestDraftDisplay,
  getPainPointDraftDisplay,
} from '../domain/ticketAnalysisManualFields.js'
import { getRootCauseReviewDraftDisplay } from '../domain/rootCauseReview.js'
import { getSentimentDisplayLabel } from './sentiment.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/** @typedef {{ key: string; label: string; read: (r: FeedbackRecord) => string }} ConflictFieldSpec */

/** @type {ConflictFieldSpec[]} */
const DETAIL_CONFLICT_FIELDS = [
  { key: 'customerRequest', label: '客户请求', read: (r) => getCustomerRequestDraftDisplay(r) || '—' },
  { key: 'painPoint', label: '需求痛点', read: (r) => getPainPointDraftDisplay(r) || '—' },
  { key: 'requestScene', label: '请求场景', read: (r) => r.requestScene?.trim() || '—' },
  { key: 'problemType', label: '问题类型', read: (r) => r.problemType?.trim() || '—' },
  {
    key: 'journey',
    label: '用户旅程',
    read: (r) => [r.journeyL1, r.journeyL2].filter(Boolean).join(' / ') || '—',
  },
  { key: 'sentiment', label: '用户情绪', read: (r) => getSentimentDisplayLabel(r) || '—' },
  {
    key: 'establishedAction',
    label: getFieldByKey('establishedAction')?.displayName || '确立举措',
    read: (r) => getEstablishedActionDisplay(r) || '—',
  },
  {
    key: 'actionSchedule',
    label: getFieldByKey('actionSchedule')?.displayName || '排期',
    read: (r) => r.actionSchedule?.trim() || '—',
  },
  {
    key: 'productGroupOptimization',
    label: getFieldByKey('productGroupOptimization')?.displayName || '产品组优化建议',
    read: (r) => r.productGroupOptimization?.trim() || '—',
  },
  {
    key: 'designerOptimization',
    label: getFieldByKey('designerOptimization')?.displayName || '设计师优化建议',
    read: (r) => r.designerOptimization?.trim() || '—',
  },
  {
    key: 'rootCauseReview',
    label: getFieldByKey('rootCauseReview')?.displayName || '根因排查',
    read: (r) => getRootCauseReviewDraftDisplay(r) || '—',
  },
  { key: 'note', label: '备注', read: (r) => r.note?.trim() || '—' },
]

/**
 * @typedef {{ key: string; label: string; server: string; yours: string }} RecordConflictDiffRow
 */

/**
 * @param {FeedbackRecord | null | undefined} serverRecord
 * @param {FeedbackRecord | null | undefined} yourRecord
 * @returns {RecordConflictDiffRow[]}
 */
export function buildRecordConflictDiff(serverRecord, yourRecord) {
  if (!serverRecord || !yourRecord) return []
  /** @type {RecordConflictDiffRow[]} */
  const rows = []
  for (const field of DETAIL_CONFLICT_FIELDS) {
    const server = field.read(serverRecord)
    const yours = field.read(yourRecord)
    if (server === yours) continue
    rows.push({ key: field.key, label: field.label, server, yours })
  }
  return rows
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function formatRecordUpdatedByLine(record) {
  if (!record?.updatedAt) return ''
  const who = record.updatedBy?.username?.trim()
  const at = record.updatedAt.replace('T', ' ').slice(0, 19)
  return who ? `${who} · ${at}` : at
}
