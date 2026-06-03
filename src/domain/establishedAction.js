/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

import { getFieldByKey, readFieldValue } from './fieldRegistry.js'

/** @type {number} */
export const ESTABLISHED_ACTION_MAX_LENGTH = 500

/** @type {number} */
export const ESTABLISHED_ACTION_DETAIL_MAX_LENGTH = 1000

/**
 * 详情/导出展示的确立举措（优先 establishedAction，过渡读 manualReviewOptimization）。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function getEstablishedActionDisplay(record) {
  const field = getFieldByKey('establishedAction')
  if (!field) {
    return String(record?.establishedAction || record?.manualReviewOptimization || '').trim()
  }
  return readFieldValue(record, field)
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function getEstablishedActionDetailDisplay(record) {
  const field = getFieldByKey('establishedActionDetail')
  if (!field) {
    return String(record?.establishedActionDetail || '').trim()
  }
  return readFieldValue(record, field)
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeEstablishedActionInput(value) {
  return String(value ?? '').trim().slice(0, ESTABLISHED_ACTION_MAX_LENGTH)
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeEstablishedActionDetailInput(value) {
  return String(value ?? '').trim().slice(0, ESTABLISHED_ACTION_DETAIL_MAX_LENGTH)
}

/**
 * 保存时双写确立举措与过渡字段 manualReviewOptimization（R4 前无 actionId 选库）。
 *
 * @param {string} value
 * @returns {{ establishedAction: string, manualReviewOptimization: string }}
 */
export function buildEstablishedActionSavePatch(value) {
  const normalized = normalizeEstablishedActionInput(value)
  return {
    establishedAction: normalized,
    manualReviewOptimization: normalized,
  }
}

/**
 * @param {string} value
 * @returns {{ establishedActionDetail: string }}
 */
export function buildEstablishedActionDetailSavePatch(value) {
  return {
    establishedActionDetail: normalizeEstablishedActionDetailInput(value),
  }
}

/**
 * @param {string} content
 * @param {string} [detail]
 * @returns {{ establishedAction: string; manualReviewOptimization: string; establishedActionDetail: string }}
 */
export function buildEstablishedActionFullSavePatch(content, detail = '') {
  return {
    ...buildEstablishedActionSavePatch(content),
    ...buildEstablishedActionDetailSavePatch(detail),
  }
}
