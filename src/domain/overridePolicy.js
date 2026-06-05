/**
 * Override Policy — 批量打标 / 导入分析的人工内容覆盖策略。
 * @see docs/DESIGN-20260601-1.md §1.2
 */

import { themesFromJourney } from '../lib/applyThemes.js'
import { preserveManualTags } from '../lib/manualTagFields.js'
import { normalizeSentiment, normalizeUrgencyLevel, SENTIMENT_LABELS } from '../lib/sentiment.js'
import {
  applyFollowUpSatisfactionPatch,
  parseFollowUpSatisfactionDisplay,
} from './followUpSatisfaction.js'
import {
  getImportColumns,
  getImportManualDimensions,
} from './fieldRegistry.js'

/** @typedef {import('./fieldRegistry.js').OverridePolicy} OverridePolicy */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../lib/retagSession.js').BulkRetagScope} BulkRetagScope */

export const OVERRIDE_POLICY = /** @type {const} */ ({
  RESPECT_MANUAL: 'RESPECT_MANUAL',
  FORCE_ALL_HUMAN: 'FORCE_ALL_HUMAN',
  IMPORT_REPLACE: 'IMPORT_REPLACE',
})

/** @type {OverridePolicy[]} */
export const OVERRIDE_POLICY_VALUES = Object.values(OVERRIDE_POLICY)

const SENTIMENT_LABEL_TO_KEY = Object.fromEntries(
  Object.entries(SENTIMENT_LABELS).map(([key, label]) => [label, key]),
)

/** 导入时读取表头/单元格但不写入库内（自动优化建议由打标生成）。 */
const IMPORT_SKIP_WRITE_FIELD_KEYS = new Set(['optimizationProduct', 'optimizationService'])

const URGENT_IMPORT_TEXT = /^(?:是|加急|高|yes|true|1)$/i

/**
 * @param {FeedbackRecord} record
 * @returns {string}
 */
export function resolveRootCauseReviewFallback(record) {
  const fromColumn = record.sourceColumns?.['问题原因']?.trim()
  if (fromColumn) return fromColumn
  return record.rootCause?.trim() || ''
}

/**
 * @param {OverridePolicy} policy
 * @returns {boolean}
 */
export function isForceOverridePolicy(policy) {
  return policy === OVERRIDE_POLICY.FORCE_ALL_HUMAN
}

/**
 * 强制覆盖：清空人工标记与确立举措等；根因排查回退问题原因。
 *
 * @param {FeedbackRecord} record
 * @returns {FeedbackRecord}
 */
export function applyForceAllHumanOverrides(record) {
  const rootCauseReview = resolveRootCauseReviewFallback(record)
  return {
    ...record,
    manualTagFields: [],
    manualReviewRootCause: '',
    manualReviewSolution: '',
    manualReviewAction: '',
    manualReviewOptimization: '',
    establishedAction: '',
    actionId: '',
    actionSchedule: '',
    productGroupOptimization: '',
    designerOptimization: '',
    rootCauseReview,
  }
}

/**
 * @param {string | undefined} raw
 * @returns {import('../lib/sentiment.js').Sentiment}
 */
export function parseImportSentiment(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return normalizeSentiment(undefined)
  if (text in SENTIMENT_LABELS) return normalizeSentiment(text)
  const fromLabel = SENTIMENT_LABEL_TO_KEY[text]
  if (fromLabel) return normalizeSentiment(fromLabel)
  return normalizeSentiment(text)
}

/**
 * @param {string | undefined} raw
 * @returns {import('../lib/sentiment.js').UrgencyLevel}
 */
export function parseImportUrgency(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return 'none'
  if (URGENT_IMPORT_TEXT.test(text)) return 'high'
  return normalizeUrgencyLevel(text)
}

/**
 * @param {string} fieldKey
 * @param {string | undefined} raw
 */
function coerceImportValue(fieldKey, raw) {
  const text = raw == null ? '' : String(raw)
  switch (fieldKey) {
    case 'sentiment':
      return parseImportSentiment(text)
    case 'urgency':
      return parseImportUrgency(text)
    default:
      return text.trim()
  }
}

/**
 * 将导入单元格写入 record 主路径（含同步字段）。
 *
 * @param {FeedbackRecord} record
 * @param {string} fieldKey
 * @param {unknown} value
 * @returns {FeedbackRecord}
 */
export function writeImportField(record, fieldKey, value) {
  let next = { ...record }
  switch (fieldKey) {
    case 'ticketId':
      next.ticketId = String(value ?? '')
      break
    case 'product':
      next.product = String(value ?? '')
      break
    case 'customerRequest':
      next.customerRequest = String(value ?? '')
      break
    case 'painPoint': {
      const text = String(value ?? '')
      next.painPoint = text
      next.problemSummary = text
      break
    }
    case 'requestScene':
      next.requestScene = String(value ?? '')
      break
    case 'problemType':
      next.problemType = String(value ?? '')
      break
    case 'journeyL1':
      next.journeyL1 = String(value ?? '')
      break
    case 'journeyL2':
      next.journeyL2 = String(value ?? '')
      break
    case 'sentiment':
      next.sentiment = /** @type {import('../lib/sentiment.js').Sentiment} */ (value)
      break
    case 'urgency':
      next.urgencyLevel = /** @type {import('../lib/sentiment.js').UrgencyLevel} */ (value)
      break
    case 'optimizationProduct':
      next.optimizationProduct = String(value ?? '')
      break
    case 'optimizationService':
      next.optimizationService = String(value ?? '')
      break
    case 'establishedAction': {
      const text = String(value ?? '')
      next.establishedAction = text
      next.manualReviewOptimization = text
      break
    }
    case 'actionSchedule':
      next.actionSchedule = String(value ?? '')
      break
    case 'acceptanceContent':
      next.rawText = String(value ?? '')
      break
    case 'handlingOpinion':
      next.handlingText = String(value ?? '')
      break
    case 'rootCauseReview':
      next.rootCauseReview = String(value ?? '')
      break
    case 'productGroupOptimization':
      next.productGroupOptimization = String(value ?? '')
      break
    case 'designerOptimization':
      next.designerOptimization = String(value ?? '')
      break
    case 'followUpSatisfaction': {
      const text = String(value ?? '').trim()
      if (!text) {
        delete next.followUpSatisfaction
        break
      }
      const parsed = parseFollowUpSatisfactionDisplay(text)
      if (parsed?.score == null) break
      next = applyFollowUpSatisfactionPatch(next, {
        followUpTicketId:
          next.followUpSatisfaction?.followUpTicketId ||
          `import-${String(next.ticketId || next.id || 'unknown').trim()}`,
        followUpSuccessful: true,
        score: parsed.score,
        problemResolved: parsed.problemResolved ?? undefined,
      })
      break
    }
    case 'followUpDissatisfiedReasons': {
      const text = String(value ?? '').trim()
      if (!text && !next.followUpSatisfaction) break
      next = applyFollowUpSatisfactionPatch(next, {
        followUpTicketId:
          next.followUpSatisfaction?.followUpTicketId ||
          `import-${String(next.ticketId || next.id || 'unknown').trim()}`,
        followUpSuccessful: next.followUpSatisfaction?.followUpSuccessful ?? Boolean(text),
        dissatisfiedReasons: text,
      })
      break
    }
    default:
      break
  }
  if (fieldKey === 'journeyL1' || fieldKey === 'journeyL2') {
    next.themes = themesFromJourney(next)
  }
  return next
}

/**
 * 从导入行（中文表头 → 单元格）构建 IMPORT_REPLACE 后的记录。
 *
 * @param {FeedbackRecord} existing
 * @param {Record<string, string | undefined>} importRow
 * @returns {FeedbackRecord}
 */
export function applyImportReplace(existing, importRow) {
  let next = { ...existing }

  for (const field of getImportColumns()) {
    if (IMPORT_SKIP_WRITE_FIELD_KEYS.has(field.fieldKey)) continue
    const raw = importRow[field.displayName]
    const coerced = coerceImportValue(field.fieldKey, raw)
    next = writeImportField(next, field.fieldKey, coerced)
  }

  next.manualTagFields = [...getImportManualDimensions()]
  next.customerRequestSource = 'import'
  next.painPointSource = 'import'
  next.optimizationSource = 'import'

  return next
}

/**
 * @param {FeedbackRecord} record
 * @param {OverridePolicy} policy
 * @param {{ scope?: BulkRetagScope; importRow?: Record<string, string | undefined> }} [options]
 * @returns {FeedbackRecord}
 */
export function applyOverridePolicy(record, policy, options = {}) {
  switch (policy) {
    case OVERRIDE_POLICY.FORCE_ALL_HUMAN:
      return applyForceAllHumanOverrides(record)
    case OVERRIDE_POLICY.IMPORT_REPLACE:
      if (!options.importRow) {
        throw new Error('IMPORT_REPLACE requires options.importRow')
      }
      return applyImportReplace(record, options.importRow)
    case OVERRIDE_POLICY.RESPECT_MANUAL:
    default:
      return record
  }
}

/**
 * 打标流水线结束后：按策略决定是否保留人工字段。
 *
 * @param {FeedbackRecord} original
 * @param {FeedbackRecord} processed
 * @param {OverridePolicy} policy
 * @returns {FeedbackRecord}
 */
export function applyPostProcessOverridePolicy(original, processed, policy) {
  if (isForceOverridePolicy(policy)) return processed
  if (policy === OVERRIDE_POLICY.IMPORT_REPLACE) return processed
  return preserveManualTags(original, processed, { forceOverride: false })
}
