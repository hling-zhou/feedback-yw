/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

import { CUSTOMER_REQUEST_HARD_MAX } from '../lib/ticketAnalysis/customerRequestExtract.js'
import { PAIN_POINT_HARD_MAX } from '../lib/ticketAnalysis/painPointExtract.js'
import {
  getDisplayCustomerRequest,
  getDisplayPainPoint,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'

export { CUSTOMER_REQUEST_HARD_MAX as CUSTOMER_REQUEST_MANUAL_MAX_LENGTH }
export { PAIN_POINT_HARD_MAX as PAIN_POINT_MANUAL_MAX_LENGTH }

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function getCustomerRequestDraftDisplay(record) {
  return getDisplayCustomerRequest(record)
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function getPainPointDraftDisplay(record) {
  return getDisplayPainPoint(record)
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeManualCustomerRequest(value) {
  return String(value ?? '').trim().slice(0, CUSTOMER_REQUEST_HARD_MAX)
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeManualPainPoint(value) {
  return String(value ?? '').trim().slice(0, PAIN_POINT_HARD_MAX)
}

/**
 * @param {string} value
 * @returns {Pick<FeedbackRecord, 'customerRequest' | 'customerRequestSource'>}
 */
export function buildCustomerRequestManualSavePatch(value) {
  return {
    customerRequest: normalizeManualCustomerRequest(value),
    customerRequestSource: 'manual',
  }
}

/**
 * @param {string} value
 * @returns {Pick<FeedbackRecord, 'painPoint' | 'problemSummary' | 'painPointSource'>}
 */
export function buildPainPointManualSavePatch(value) {
  const painPoint = normalizeManualPainPoint(value)
  return {
    painPoint,
    problemSummary: painPoint,
    painPointSource: 'manual',
  }
}

/**
 * 详情保存：仅当内容相对现有记录有变化时，才标记 customerRequestSource 为 manual。
 *
 * @param {FeedbackRecord | null | undefined} existing
 * @param {string} value
 * @returns {Pick<FeedbackRecord, 'customerRequest'> | Pick<FeedbackRecord, 'customerRequest' | 'customerRequestSource'>}
 */
export function buildCustomerRequestSavePatch(existing, value) {
  const customerRequest = normalizeManualCustomerRequest(value)
  if (customerRequest === getDisplayCustomerRequest(existing)) {
    return { customerRequest }
  }
  return {
    customerRequest,
    customerRequestSource: 'manual',
  }
}

/**
 * 详情保存：仅当内容相对现有记录有变化时，才标记 painPointSource 为 manual。
 *
 * @param {FeedbackRecord | null | undefined} existing
 * @param {string} value
 */
export function buildPainPointSavePatch(existing, value) {
  const painPoint = normalizeManualPainPoint(value)
  const unchanged = painPoint === getDisplayPainPoint(existing)
  if (unchanged) {
    return { painPoint, problemSummary: painPoint }
  }
  return {
    painPoint,
    problemSummary: painPoint,
    painPointSource: 'manual',
  }
}
