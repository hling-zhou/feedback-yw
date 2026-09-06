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

/** 导入时读取表头/单元格但不写入库内（自动优化建议由打标生成；未完成待办为派生列）。 */
const IMPORT_SKIP_WRITE_FIELD_KEYS = new Set([
  'optimizationProduct',
  'optimizationService',
  'ticketTodoOpenSummary',
])

/**
 * @param {FeedbackRecord} record
 * @param {string} label
 * @param {string} text
 * @returns {FeedbackRecord}
 */
function writeSourceColumnLabel(record, label, text) {
  const nextCols = { ...(record.sourceColumns || {}) }
  if (text) nextCols[label] = text
  else delete nextCols[label]
  const keys = Object.keys(nextCols)
  return {
    ...record,
    sourceColumns: keys.length > 0 ? nextCols : undefined,
  }
}

const URGENT_IMPORT_TEXT = /^(?:是|加急|高|yes|true|1)$/i

/**
 * @param {FeedbackRecord} record
 * @returns {string}
 */
export function resolveRootCauseReviewFallback(record) {
  return record.sourceColumns?.['问题原因']?.trim() || ''
}

/**
 * @param {OverridePolicy} policy
 * @returns {boolean}
 */
export function isForceOverridePolicy(policy) {
  return policy === OVERRIDE_POLICY.FORCE_ALL_HUMAN
}

/**
 * 强制覆盖：清空人工标记与确立举措等；根因排查（问题原因）一并清空，由打标流水线重新生成自动根因。
 *
 * @param {FeedbackRecord} record
 * @returns {FeedbackRecord}
 */
export function applyForceAllHumanOverrides(record) {
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
    // 不再回退导入列「问题原因」：强制重打标即清空人工复核，自动根因由流水线重新生成
    rootCauseReview: '',
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
    case 'customerTypeName':
      next = writeSourceColumnLabel(next, '客户类型名称', String(value ?? '').trim())
      break
    case 'groupName':
      next = writeSourceColumnLabel(next, '集团名称', String(value ?? '').trim())
      break
    case 'groupCustomerCode':
      next = writeSourceColumnLabel(next, '集团客户编码', String(value ?? '').trim())
      break
    case 'groupProvince':
      next = writeSourceColumnLabel(next, '集团所属省份', String(value ?? '').trim())
      break
    case 'groupCity':
      next = writeSourceColumnLabel(next, '集团所属地市', String(value ?? '').trim())
      break
    case 'loginAccountName':
      next = writeSourceColumnLabel(next, '登录账号名称', String(value ?? '').trim())
      break
    case 'customerTierExport': {
      const text = String(value ?? '').trim()
      next = writeSourceColumnLabel(next, '移动云客户服务等级', text)
      next.customerTier = text
      break
    }
    case 'acceptChannel':
      // 仅回写 sourceColumns，不改动 record.source（数据来源类型）
      next = writeSourceColumnLabel(next, '受理渠道', String(value ?? '').trim())
      break
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
