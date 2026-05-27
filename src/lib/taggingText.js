/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

const PRIMARY_SECTION = '处理意见'
const ACCEPTANCE_SECTIONS = ['受理内容', '咨询内容']
const APPEND_SECTIONS = ['追加信息', '追加内容']

/** @type {RegExp} */
const BRACKET_SECTION_RE = /【([^】]+)】\s*\n?([\s\S]*?)(?=【[^】]+】|$)/g

/**
 * @param {string} [text]
 * @returns {Record<string, string>}
 */
export function parseBracketSections(text) {
  if (!text?.trim()) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const match of text.matchAll(BRACKET_SECTION_RE)) {
    const label = match[1].trim()
    const content = match[2].trim()
    if (label && content) out[label] = content
  }
  return out
}

/**
 * @param {string} [text]
 */
function normalizeCompare(text) {
  return (text || '').replace(/\s+/g, '').trim()
}

/**
 * @param {string} [a]
 * @param {string} [b]
 */
function isDuplicateContent(a, b) {
  if (!a?.trim() || !b?.trim()) return false
  const na = normalizeCompare(a)
  const nb = normalizeCompare(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/**
 * @param {string} raw
 * @param {string} [handling]
 */
function acceptanceFromUnstructuredRaw(raw, handling) {
  if (!raw?.trim()) return ''
  let rest = raw
    .replace(/【处理意见】[\s\S]*?(?=【[^】]+】|$)/, '')
    .trim()
  const h = handling?.trim()
  if (h) {
    if (rest === h) return ''
    if (rest.endsWith(h)) rest = rest.slice(0, -h.length).trim()
  }
  return rest
}

/**
 * @param {string} [rawText]
 * @param {string} label
 */
function firstSectionContent(rawText, label) {
  const sections = parseBracketSections(rawText)
  return sections[label]?.trim() || ''
}

/**
 * @param {{ handlingText?: string; rawText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
export function extractHandlingTextFromFields(fields) {
  const raw = fields.rawText?.trim() || ''
  const sections = parseBracketSections(raw)
  return (
    fields.handlingText?.trim() ||
    sections[PRIMARY_SECTION]?.trim() ||
    fields.sourceColumns?.[PRIMARY_SECTION]?.trim() ||
    ''
  )
}

/**
 * @param {{ handlingText?: string; rawText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
export function extractAcceptanceTextFromFields(fields) {
  const handlingBody = extractHandlingTextFromFields(fields)
  const raw = fields.rawText?.trim() || ''
  const sections = parseBracketSections(raw)

  for (const label of ACCEPTANCE_SECTIONS) {
    const fromSection = sections[label]?.trim()
    if (fromSection) return fromSection
  }
  const acceptance = acceptanceFromUnstructuredRaw(raw, handlingBody)
  if (acceptance && !isDuplicateContent(acceptance, handlingBody)) return acceptance
  return ''
}

/**
 * 工单详情展示：读取追加信息（不做与受理内容的去重，避免展示为空）
 *
 * @param {{ handlingText?: string; rawText?: string; sourceColumns?: Record<string, string> }} fields
 */
export function extractAppendTextForDisplay(fields) {
  const raw = fields.rawText?.trim() || ''
  const sections = parseBracketSections(raw)
  for (const label of APPEND_SECTIONS) {
    const fromSection = sections[label]?.trim() || fields.sourceColumns?.[label]?.trim()
    if (fromSection) return fromSection
  }
  for (const label of APPEND_SECTIONS) {
    const fromRaw = firstSectionContent(raw, label)
    if (fromRaw) return fromRaw
  }
  return ''
}

/**
 * @param {{ handlingText?: string; rawText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
export function extractAppendTextFromFields(fields) {
  const handlingBody = extractHandlingTextFromFields(fields)
  const raw = fields.rawText?.trim() || ''
  const sections = parseBracketSections(raw)
  const acceptance = extractAcceptanceTextFromFields(fields)

  let append = ''
  for (const label of APPEND_SECTIONS) {
    const fromSection = sections[label]?.trim() || fields.sourceColumns?.[label]?.trim()
    if (fromSection) {
      append = fromSection
      break
    }
  }
  if (!append) {
    for (const label of APPEND_SECTIONS) {
      const fromRaw = firstSectionContent(raw, label)
      if (fromRaw) {
        append = fromRaw
        break
      }
    }
  }
  if (append && !isDuplicateContent(append, handlingBody) && !isDuplicateContent(append, acceptance)) {
    return append
  }
  return ''
}

/**
 * 以处理意见为主，结合受理内容、追加信息，构建四维打标用正文。
 *
 * @param {{ handlingText?: string; rawText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
export function buildTaggingTextFromFields(fields) {
  const handlingBody = extractHandlingTextFromFields(fields)
  const acceptance = extractAcceptanceTextFromFields(fields)
  const append = extractAppendTextFromFields(fields)

  /** @type {string[]} */
  const parts = []

  if (handlingBody) {
    parts.push(`【${PRIMARY_SECTION}】\n${handlingBody}`)
  }

  if (acceptance && !isDuplicateContent(acceptance, handlingBody)) {
    parts.push(`【受理内容】\n${acceptance}`)
  }

  if (append && !isDuplicateContent(append, handlingBody) && !isDuplicateContent(append, acceptance)) {
    parts.push(`【追加信息】\n${append}`)
  }

  if (parts.length) return parts.join('\n\n')

  return (
    handlingBody ||
    acceptance ||
    append ||
    fields.customerQuote?.trim() ||
    fields.rawText?.trim() ||
    ''
  )
}

/**
 * @param {FeedbackRecord | Partial<FeedbackRecord>} record
 */
export function buildTaggingTextForRecord(record) {
  return buildTaggingTextFromFields({
    handlingText: record.handlingText,
    rawText: record.rawText,
    customerQuote: record.customerQuote,
    sourceColumns: record.sourceColumns,
  })
}

/** @deprecated 使用 buildTaggingTextForRecord */
export function taggingTextForRecord(record) {
  return buildTaggingTextForRecord(record)
}
