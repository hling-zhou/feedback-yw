/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

import { normalizeActionSchedule } from './actionSchedule.js'
import { getComplaintCauseReviewDraftDisplay, normalizeComplaintCauseReviewInput } from './complaintCauseReview.js'
import {
  getEstablishedActionDetailDisplay,
  getEstablishedActionDisplay,
  normalizeEstablishedActionDetailInput,
  normalizeEstablishedActionInput,
} from './establishedAction.js'
import { normalizeRootCauseReviewInput, getRootCauseReviewDraftDisplay } from './rootCauseReview.js'
import {
  getCustomerRequestDraftDisplay,
  getPainPointDraftDisplay,
  normalizeManualCustomerRequest,
  normalizeManualPainPoint,
} from './ticketAnalysisManualFields.js'
import { normalizeSentiment, normalizeUrgencyLevel } from '../lib/sentiment.js'

/**
 * @param {unknown} value
 */
function norm(value) {
  return String(value ?? '').trim()
}

/**
 * @typedef {Object} FeedbackDrawerFormSnapshot
 * @property {string} [note]
 * @property {import('../lib/sentiment.js').Sentiment} [sentiment]
 * @property {import('../lib/sentiment.js').UrgencyLevel} [urgencyLevel]
 * @property {string} [requestScene]
 * @property {string} [problemType]
 * @property {string} [journeyL1]
 * @property {string} [journeyL2]
 * @property {string} [customerRequest]
 * @property {string} [painPoint]
 * @property {string} [productGroupOptimization]
 * @property {string} [designerOptimization]
 * @property {string} [establishedAction]
 * @property {string} [establishedActionDetail]
 * @property {string} [actionSchedule]
 * @property {string} [actionId]
 * @property {string} [rootCauseReview]
 * @property {string} [complaintCauseL2Review]
 * @property {string} [complaintCauseL3Review]
 */

/**
 * 工单详情抽屉：当前表单相对已存工单是否有未保存修改。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @param {FeedbackDrawerFormSnapshot} form
 */
export function isFeedbackDrawerFormDirty(record, form) {
  if (!record) return false

  if (norm(form.note) !== norm(record.note)) return true
  if (normalizeSentiment(form.sentiment) !== normalizeSentiment(record.sentiment)) return true
  if (
    normalizeUrgencyLevel(form.urgencyLevel, form.sentiment)
    !== normalizeUrgencyLevel(record.urgencyLevel, record.sentiment)
  ) {
    return true
  }
  if (norm(form.requestScene) !== norm(record.requestScene)) return true
  if (norm(form.problemType) !== norm(record.problemType)) return true
  if (norm(form.journeyL1) !== norm(record.journeyL1)) return true
  if (norm(form.journeyL2) !== norm(record.journeyL2)) return true

  if (
    normalizeManualCustomerRequest(form.customerRequest)
    !== normalizeManualCustomerRequest(getCustomerRequestDraftDisplay(record))
  ) {
    return true
  }
  if (
    normalizeManualPainPoint(form.painPoint)
    !== normalizeManualPainPoint(getPainPointDraftDisplay(record))
  ) {
    return true
  }

  if (norm(form.productGroupOptimization) !== norm(record.productGroupOptimization)) return true
  if (norm(form.designerOptimization) !== norm(record.designerOptimization)) return true

  if (
    normalizeEstablishedActionInput(form.establishedAction)
    !== normalizeEstablishedActionInput(getEstablishedActionDisplay(record))
  ) {
    return true
  }
  if (
    normalizeEstablishedActionDetailInput(form.establishedActionDetail)
    !== normalizeEstablishedActionDetailInput(getEstablishedActionDetailDisplay(record))
  ) {
    return true
  }
  if (
    normalizeActionSchedule(form.actionSchedule)
    !== normalizeActionSchedule(record.actionSchedule)
  ) {
    return true
  }
  if (norm(form.actionId) !== norm(record.actionId)) return true

  if (
    normalizeRootCauseReviewInput(form.rootCauseReview)
    !== normalizeRootCauseReviewInput(getRootCauseReviewDraftDisplay(record))
  ) {
    return true
  }

  const causeBaseline = getComplaintCauseReviewDraftDisplay(record)
  const causeNorm = normalizeComplaintCauseReviewInput({
    l2: form.complaintCauseL2Review,
    l3: form.complaintCauseL3Review,
  })
  if (causeNorm.complaintCauseL2Review !== causeBaseline.l2) return true
  if (causeNorm.complaintCauseL3Review !== causeBaseline.l3) return true

  return false
}
