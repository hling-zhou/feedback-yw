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
import {
  normalizeTicketTodoIncoming,
  normalizeTicketTodoInput,
  ticketTodoIncomingEqual,
  ticketTodoItemsEqual,
} from './ticketTodo.js'

/**
 * @param {unknown} value
 */
function norm(value) {
  return String(value ?? '').trim()
}

/**
 * @typedef {Object} FeedbackDrawerFormSnapshot
 * @property {string} [note]
 * @property {boolean} [listeningReviewed]
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
 * @property {string} [complaintCauseL1Review]
 * @property {string} [complaintCauseL2Review]
 * @property {string} [complaintCauseL3Review]
 * @property {string} [complaintCauseReviewReason]
 * @property {import('./ticketTodo.js').TicketTodoItem[]} [ticketTodoItems]
 * @property {import('./ticketTodo.js').TicketTodoIncomingRef[]} [ticketTodoIncoming]
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
  if (Boolean(form.listeningReviewed) !== Boolean(record.listeningReviewed)) return true
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
    l1: form.complaintCauseL1Review,
    l2: form.complaintCauseL2Review,
    l3: form.complaintCauseL3Review,
    reason: form.complaintCauseReviewReason,
  })
  if (causeNorm.complaintCauseL1Review !== causeBaseline.l1) return true
  if (causeNorm.complaintCauseL2Review !== causeBaseline.l2) return true
  if (causeNorm.complaintCauseL3Review !== causeBaseline.l3) return true
  if (causeNorm.complaintCauseReviewReason !== causeBaseline.reason) return true

  if (
    !ticketTodoItemsEqual(
      normalizeTicketTodoInput(form.ticketTodoItems),
      normalizeTicketTodoInput(record.ticketTodo?.items),
    )
  ) {
    return true
  }
  if (
    !ticketTodoIncomingEqual(
      normalizeTicketTodoIncoming(form.ticketTodoIncoming),
      normalizeTicketTodoIncoming(record.ticketTodoIncoming),
    )
  ) {
    return true
  }

  return false
}

/**
 * 抽屉表单快照是否一致（用于打开/保存后的 baseline，避免异步灌表误判 dirty）。
 *
 * @param {FeedbackDrawerFormSnapshot} a
 * @param {FeedbackDrawerFormSnapshot} b
 */
export function areFeedbackDrawerFormSnapshotsEqual(a, b) {
  if (norm(a.note) !== norm(b.note)) return false
  if (Boolean(a.listeningReviewed) !== Boolean(b.listeningReviewed)) return false
  if (normalizeSentiment(a.sentiment) !== normalizeSentiment(b.sentiment)) return false
  if (
    normalizeUrgencyLevel(a.urgencyLevel, a.sentiment)
    !== normalizeUrgencyLevel(b.urgencyLevel, b.sentiment)
  ) {
    return false
  }
  if (norm(a.requestScene) !== norm(b.requestScene)) return false
  if (norm(a.problemType) !== norm(b.problemType)) return false
  if (norm(a.journeyL1) !== norm(b.journeyL1)) return false
  if (norm(a.journeyL2) !== norm(b.journeyL2)) return false
  if (
    normalizeManualCustomerRequest(a.customerRequest)
    !== normalizeManualCustomerRequest(b.customerRequest)
  ) {
    return false
  }
  if (normalizeManualPainPoint(a.painPoint) !== normalizeManualPainPoint(b.painPoint)) {
    return false
  }
  if (norm(a.productGroupOptimization) !== norm(b.productGroupOptimization)) return false
  if (norm(a.designerOptimization) !== norm(b.designerOptimization)) return false
  if (
    normalizeEstablishedActionInput(a.establishedAction)
    !== normalizeEstablishedActionInput(b.establishedAction)
  ) {
    return false
  }
  if (
    normalizeEstablishedActionDetailInput(a.establishedActionDetail)
    !== normalizeEstablishedActionDetailInput(b.establishedActionDetail)
  ) {
    return false
  }
  if (normalizeActionSchedule(a.actionSchedule) !== normalizeActionSchedule(b.actionSchedule)) {
    return false
  }
  if (norm(a.actionId) !== norm(b.actionId)) return false
  if (
    normalizeRootCauseReviewInput(a.rootCauseReview)
    !== normalizeRootCauseReviewInput(b.rootCauseReview)
  ) {
    return false
  }
  const causeA = normalizeComplaintCauseReviewInput({
    l1: a.complaintCauseL1Review,
    l2: a.complaintCauseL2Review,
    l3: a.complaintCauseL3Review,
    reason: a.complaintCauseReviewReason,
  })
  const causeB = normalizeComplaintCauseReviewInput({
    l1: b.complaintCauseL1Review,
    l2: b.complaintCauseL2Review,
    l3: b.complaintCauseL3Review,
    reason: b.complaintCauseReviewReason,
  })
  if (causeA.complaintCauseL1Review !== causeB.complaintCauseL1Review) return false
  if (causeA.complaintCauseL2Review !== causeB.complaintCauseL2Review) return false
  if (causeA.complaintCauseL3Review !== causeB.complaintCauseL3Review) return false
  if (causeA.complaintCauseReviewReason !== causeB.complaintCauseReviewReason) return false
  if (
    !ticketTodoItemsEqual(
      normalizeTicketTodoInput(a.ticketTodoItems),
      normalizeTicketTodoInput(b.ticketTodoItems),
    )
  ) {
    return false
  }
  if (
    !ticketTodoIncomingEqual(
      normalizeTicketTodoIncoming(a.ticketTodoIncoming),
      normalizeTicketTodoIncoming(b.ticketTodoIncoming),
    )
  ) {
    return false
  }
  return true
}
