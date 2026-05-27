import { DATA_SOURCE_TYPES } from '../domain/enums.js'
import { extractFromRaw } from './extract.js'
import { normalizeQuoteNoiseConfig, stripQuoteNoise } from './quoteNoise.js'
import {
  extractAcceptanceTextFromFields,
  extractAppendTextFromFields,
  parseBracketSections,
} from './taggingText.js'

/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */
/** @typedef {import('./storage.js').AppSettings} AppSettings */

/** @typedef {'structured_first' | 'plain' | 'auto'} QuoteExtractionMode */

/** @typedef {Partial<Record<DataSourceType, QuoteExtractionMode>>} QuoteExtractionConfig */

export const QUOTE_MAX_LEN = 500

/** 抽取规则代码版本；逻辑变更时递增，用于 quoteExtractionVersion */
export const QUOTE_EXTRACTION_RULES_VERSION = '3'

const TICKET_LIKE_SOURCES = /** @type {const} */ (['complaint_ticket', 'consultation_ticket'])
const PLAIN_SOURCES = /** @type {const} */ (['post_use_rating', 'user_survey'])

const TICKET_STRUCTURE_RE = /【(?:受理内容|咨询内容|处理意见)】/

const VALID_MODES = /** @type {const} */ (['structured_first', 'plain', 'auto'])

/** @type {Record<QuoteExtractionMode, string>} */
export const QUOTE_EXTRACTION_MODE_LABELS = {
  structured_first: '结构化优先（受理/咨询 + 追加）',
  plain: '整段原文',
  auto: '自动识别（有工单体例则结构化）',
}

/**
 * @returns {Record<DataSourceType, QuoteExtractionMode>}
 */
export function defaultQuoteExtractionConfig() {
  return {
    complaint_ticket: 'structured_first',
    consultation_ticket: 'structured_first',
    post_use_rating: 'plain',
    user_survey: 'plain',
    other: 'auto',
  }
}

/**
 * @param {QuoteExtractionConfig | null | undefined} partial
 * @returns {Record<DataSourceType, QuoteExtractionMode>}
 */
export function normalizeQuoteExtractionConfig(partial) {
  const base = defaultQuoteExtractionConfig()
  if (!partial || typeof partial !== 'object') return base
  for (const key of DATA_SOURCE_TYPES) {
    const mode = partial[key]
    if (VALID_MODES.includes(/** @type {QuoteExtractionMode} */ (mode))) {
      base[key] = mode
    }
  }
  return base
}

/**
 * @param {DataSourceType | string | undefined} dataSourceType
 * @param {AppSettings | null | undefined} [settings]
 * @returns {QuoteExtractionMode}
 */
export function resolveQuoteExtractionMode(dataSourceType, settings) {
  const type = /** @type {DataSourceType} */ (dataSourceType || 'complaint_ticket')
  if (PLAIN_SOURCES.includes(/** @type {typeof PLAIN_SOURCES[number]} */ (type))) {
    return 'plain'
  }
  const configured = settings?.quoteExtraction?.[type]
  if (configured && VALID_MODES.includes(configured)) return configured
  return defaultQuoteExtractionMode(type)
}

/**
 * @param {QuoteExtractionConfig | null | undefined} current
 * @param {DataSourceType} dataSourceType
 * @param {QuoteExtractionMode} mode
 */
export function patchQuoteExtractionConfig(current, dataSourceType, mode) {
  return normalizeQuoteExtractionConfig({ ...current, [dataSourceType]: mode })
}

/**
 * @param {DataSourceType} dataSourceType
 * @returns {{ value: QuoteExtractionMode; label: string }[]}
 */
export function quoteExtractionOptionsForSource(dataSourceType) {
  if (PLAIN_SOURCES.includes(/** @type {typeof PLAIN_SOURCES[number]} */ (dataSourceType))) {
    return [{ value: 'plain', label: QUOTE_EXTRACTION_MODE_LABELS.plain }]
  }
  if (TICKET_LIKE_SOURCES.includes(/** @type {typeof TICKET_LIKE_SOURCES[number]} */ (dataSourceType))) {
    return [
      { value: 'structured_first', label: QUOTE_EXTRACTION_MODE_LABELS.structured_first },
      { value: 'plain', label: QUOTE_EXTRACTION_MODE_LABELS.plain },
    ]
  }
  return VALID_MODES.map((value) => ({
    value,
    label: QUOTE_EXTRACTION_MODE_LABELS[value],
  }))
}

/**
 * @param {DataSourceType | string | undefined} dataSourceType
 * @returns {QuoteExtractionMode}
 */
export function defaultQuoteExtractionMode(dataSourceType) {
  if (TICKET_LIKE_SOURCES.includes(/** @type {typeof TICKET_LIKE_SOURCES[number]} */ (dataSourceType))) {
    return 'structured_first'
  }
  if (PLAIN_SOURCES.includes(/** @type {typeof PLAIN_SOURCES[number]} */ (dataSourceType))) {
    return 'plain'
  }
  return 'auto'
}

/**
 * @param {string} text
 * @param {number} [maxLen]
 */
export function truncateQuote(text, maxLen = QUOTE_MAX_LEN) {
  const t = (text || '').trim()
  if (!t) return ''
  return t.length <= maxLen ? t : t.slice(0, maxLen)
}

/**
 * @param {string} s
 */
function hashQuoteConfig(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * 当前团队规则下的原话抽取版本指纹（写入记录便于追溯 / 检测过期）
 * @param {AppSettings | null | undefined} settings
 */
export function computeQuoteExtractionVersion(settings) {
  const cfg = normalizeQuoteExtractionConfig(settings?.quoteExtraction)
  const payload = JSON.stringify({
    rules: QUOTE_EXTRACTION_RULES_VERSION,
    useRegex: settings?.useRegex !== false,
    quoteExtraction: cfg,
    quoteNoise: normalizeQuoteNoiseConfig(settings?.quoteNoise),
  })
  return `qe-${QUOTE_EXTRACTION_RULES_VERSION}-${hashQuoteConfig(payload)}`
}

/**
 * @param {string} text
 * @param {AppSettings | null | undefined} [settings]
 */
function finalizeQuote(text, settings = null) {
  return truncateQuote(stripQuoteNoise(text, settings))
}

/**
 * @param {import('./types.js').FeedbackRecord} fb
 * @param {string} currentVersion
 */
export function isQuoteExtractionStale(fb, currentVersion) {
  if (!fb?.customerQuote) return false
  if (!fb.quoteExtractionVersion) return true
  return fb.quoteExtractionVersion !== currentVersion
}

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 * @param {AppSettings | null | undefined} settings
 */
export function countStaleQuoteExtractions(feedbacks, settings) {
  const current = computeQuoteExtractionVersion(settings)
  return feedbacks.filter((fb) => isQuoteExtractionStale(fb, current)).length
}

/**
 * @param {{ rawText?: string; handlingText?: string; commentText?: string; openText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
export function hasTicketLikeStructure(fields) {
  const raw = fields.rawText?.trim() || ''
  if (!raw) return false
  if (TICKET_STRUCTURE_RE.test(raw)) return true
  const sections = parseBracketSections(raw)
  return Boolean(sections['受理内容'] || sections['咨询内容'])
}

/**
 * @param {{ rawText?: string; handlingText?: string; commentText?: string; openText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
function buildStructuredAcceptanceQuote(fields) {
  const acceptance = extractAcceptanceTextFromFields(fields)
  const append = extractAppendTextFromFields(fields)
  /** @type {string[]} */
  const parts = []
  if (acceptance) parts.push(acceptance)
  if (append) parts.push(append)
  return parts.join('\n\n').trim()
}

/**
 * @param {{ rawText?: string; handlingText?: string; commentText?: string; openText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 * @param {boolean} useRegex
 */
function extractTicketLikeQuote(fields, useRegex, settings) {
  const structured = buildStructuredAcceptanceQuote(fields)
  if (structured) return finalizeQuote(structured, settings)

  const rawText = fields.rawText?.trim() || ''
  const handlingText = fields.handlingText?.trim() || ''
  const quoteSource = rawText || handlingText

  if (!useRegex) {
    const acceptanceOnly = extractAcceptanceTextFromFields(fields)
    if (acceptanceOnly) return finalizeQuote(acceptanceOnly, settings)
    if (rawText) return finalizeQuote(rawText, settings)
    return finalizeQuote(handlingText, settings)
  }

  if (quoteSource) {
    const { customerQuote } = extractFromRaw(quoteSource, true)
    if (customerQuote) return finalizeQuote(customerQuote, settings)
  }

  return finalizeQuote(quoteSource, settings)
}

/**
 * @param {{ rawText?: string; handlingText?: string; commentText?: string; openText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
function extractPlainQuote(fields, settings) {
  const body =
    fields.commentText?.trim() ||
    fields.openText?.trim() ||
    fields.customerQuote?.trim() ||
    fields.rawText?.trim() ||
    fields.handlingText?.trim() ||
    ''
  return finalizeQuote(body, settings)
}

/**
 * @param {{ rawText?: string; handlingText?: string; commentText?: string; openText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 * @param {{ dataSourceType?: DataSourceType | string; mode?: QuoteExtractionMode; useRegex?: boolean; settings?: AppSettings | null; quoteExtractionVersion?: string }} [options]
 * @returns {{ customerQuote: string; mode: QuoteExtractionMode; quoteExtractionVersion: string }}
 */
export function extractQuoteFromFields(fields, options = {}) {
  const dataSourceType = options.dataSourceType || 'complaint_ticket'
  const mode =
    options.mode ?? resolveQuoteExtractionMode(dataSourceType, options.settings ?? null)
  const useRegex = options.useRegex ?? options.settings?.useRegex ?? true
  const settings = options.settings ?? null
  const quoteExtractionVersion =
    options.quoteExtractionVersion ?? computeQuoteExtractionVersion(settings)

  /** @type {{ customerQuote: string; mode: QuoteExtractionMode }} */
  let result

  if (mode === 'plain') {
    result = { customerQuote: extractPlainQuote(fields, settings), mode: 'plain' }
  } else if (mode === 'auto') {
    if (hasTicketLikeStructure(fields)) {
      result = {
        customerQuote: extractTicketLikeQuote(fields, useRegex, settings),
        mode: 'structured_first',
      }
    } else {
      result = { customerQuote: extractPlainQuote(fields, settings), mode: 'plain' }
    }
  } else {
    result = {
      customerQuote: extractTicketLikeQuote(fields, useRegex, settings),
      mode: 'structured_first',
    }
  }

  return { ...result, quoteExtractionVersion }
}

/**
 * @param {{ rawText?: string; handlingText?: string; commentText?: string; openText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 * @param {{ dataSourceType?: DataSourceType | string; settings?: AppSettings | null; useRegex?: boolean; quoteExtractionVersion?: string }} [options]
 */
export function extractQuoteWithMeta(fields, options = {}) {
  return extractQuoteFromFields(fields, {
    dataSourceType: options.dataSourceType,
    settings: options.settings,
    useRegex: options.useRegex,
    quoteExtractionVersion: options.quoteExtractionVersion,
  })
}

/**
 * @param {import('./types.js').FeedbackRecord | Partial<import('./types.js').FeedbackRecord>} record
 * @param {AppSettings | null} [settings]
 */
export function extractQuoteForRecord(record, settings = null) {
  return extractQuoteWithMeta(
    {
      rawText: record.rawText,
      handlingText: record.handlingText,
      customerQuote: record.customerQuote,
      commentText: record.commentText,
      openText: record.openText,
      sourceColumns: record.sourceColumns,
    },
    {
      dataSourceType: record.dataSourceType || 'complaint_ticket',
      settings,
      useRegex: settings?.useRegex ?? true,
    },
  ).customerQuote
}

/**
 * @param {import('./types.js').FeedbackRecord | Partial<import('./types.js').FeedbackRecord>} record
 * @param {AppSettings | null} [settings]
 */
export function extractQuoteMetaForRecord(record, settings = null) {
  return extractQuoteWithMeta(
    {
      rawText: record.rawText,
      handlingText: record.handlingText,
      customerQuote: record.customerQuote,
      commentText: record.commentText,
      openText: record.openText,
      sourceColumns: record.sourceColumns,
    },
    {
      dataSourceType: record.dataSourceType || 'complaint_ticket',
      settings,
      useRegex: settings?.useRegex ?? true,
    },
  )
}
