/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

const PRIMARY_SECTION = '处理意见'
const ACCEPTANCE_SECTIONS = ['受理内容', '咨询内容']
const APPEND_SECTIONS = ['追加信息', '追加内容']

/** 工单字段中的占位/无实质内容（处理意见、追加信息等） */
const MEANINGLESS_TICKET_PLACEHOLDER_RE =
  /^(?:无|不涉及|无\/不涉及|无追加|暂无|无。?|N\/A|NA|—|-|\/|\.{1,3}|null|none|不涉及。?)$/i

/**
 * @param {string | undefined | null} text
 */
function normalizePlaceholderCompareText(text) {
  return String(text ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u00A0\u200B]/g, ' ')
    .replace(/／/g, '/')
    .trim()
}

/**
 * 是否为「无/不涉及」等占位文本（应视为空，打标与详情展示回退受理内容）。
 *
 * @param {string | undefined | null} text
 */
export function isMeaninglessTicketPlaceholderText(text) {
  const t = normalizePlaceholderCompareText(text)
  if (!t) return true
  if (MEANINGLESS_TICKET_PLACEHOLDER_RE.test(t)) return true
  if (t.length <= 24 && /^(?:无|不涉及)(?:[、,，/／\s]+(?:无|不涉及))*[。.]?$/.test(t)) {
    return true
  }
  return false
}

/** @deprecated 使用 {@link isMeaninglessTicketPlaceholderText} */
export function isMeaninglessCustomerText(text) {
  return isMeaninglessTicketPlaceholderText(text)
}

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
 * @param {string | undefined | null} text
 */
function refineAcceptanceSectionContent(text) {
  const t = text?.trim()
  if (!t) return ''

  const paragraphs = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (paragraphs.length > 1) {
    const meaningfulParagraphs = paragraphs.filter(isMeaningfulTicketText)
    if (meaningfulParagraphs.length) return meaningfulParagraphs.join('\n\n')
  }

  if (isMeaningfulTicketText(t)) return t

  const lines = t.split(/\n/).map((line) => line.trim()).filter(isMeaningfulTicketText)
  return lines.join('\n')
}

function isMeaningfulTicketText(text) {
  return !isMeaninglessTicketPlaceholderText(text)
}

/**
 * @param {Record<string, string> | undefined} sourceColumns
 * @param {string} label
 */
function acceptanceFromSourceColumns(sourceColumns, label) {
  const value = sourceColumns?.[label]?.trim()
  if (!value) return ''
  return refineAcceptanceSectionContent(value)
}

/**
 * @param {string} raw
 */
function acceptanceTextBeforeHandlingMarker(raw) {
  if (!raw?.trim()) return ''
  const bracketIdx = raw.search(/【处理意见】/)
  if (bracketIdx > 0) {
    const prefix = refineAcceptanceSectionContent(raw.slice(0, bracketIdx))
    if (prefix) return prefix
  }
  const inline = raw.match(/^([\s\S]*?)(?:^|\n)\s*处理意见\s*[：:]/m)
  if (inline?.[1]?.trim() && isMeaningfulTicketText(inline[1])) {
    return inline[1].trim()
  }
  return ''
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
  return refineAcceptanceSectionContent(rest)
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
  const candidate =
    fields.handlingText?.trim() ||
    sections[PRIMARY_SECTION]?.trim() ||
    fields.sourceColumns?.[PRIMARY_SECTION]?.trim() ||
    ''
  return isMeaninglessTicketPlaceholderText(candidate) ? '' : candidate
}

/**
 * @param {{ handlingText?: string; rawText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
export function extractAcceptanceTextFromFields(fields) {
  const handlingBody = extractHandlingTextFromFields(fields)
  const raw = fields.rawText?.trim() || ''
  const sections = parseBracketSections(raw)
  const sourceColumns = fields.sourceColumns

  for (const label of ACCEPTANCE_SECTIONS) {
    const fromSnapshot = acceptanceFromSourceColumns(sourceColumns, label)
    if (fromSnapshot) return fromSnapshot
  }

  for (const label of ACCEPTANCE_SECTIONS) {
    const fromSection = sections[label]?.trim()
    if (!fromSection) continue
    const refined = refineAcceptanceSectionContent(fromSection)
    if (refined) return refined
  }

  const beforeHandling = acceptanceTextBeforeHandlingMarker(raw)
  if (beforeHandling && !isDuplicateContent(beforeHandling, handlingBody)) {
    return beforeHandling
  }

  const acceptance = acceptanceFromUnstructuredRaw(raw, handlingBody)
  if (acceptance && !isDuplicateContent(acceptance, handlingBody)) return acceptance
  return ''
}

/**
 * 工单详情「处理意见（工单原文）」展示文本。
 *
 * @param {FeedbackRecord | Partial<FeedbackRecord>} record
 */
export function extractHandlingOriginalTextForRecord(record) {
  return extractHandlingOriginalTextFromFields({
    handlingText: record?.handlingText,
    rawText: record?.rawText,
    customerQuote: record?.customerQuote,
    sourceColumns: record?.sourceColumns,
  })
}

/**
 * 工单详情「处理意见（工单原文）」：优先「处理意见」列；若为占位（如「无/不涉及」）或无内容则展示「受理内容」
 *
 * @param {{ handlingText?: string; rawText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
export function extractHandlingOriginalTextFromFields(fields) {
  const handling = extractHandlingTextFromFields(fields)
  if (handling) return handling
  return extractAcceptanceTextFromFields(fields)
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
    if (fromSection && !isMeaninglessTicketPlaceholderText(fromSection)) return fromSection
  }
  for (const label of APPEND_SECTIONS) {
    const fromRaw = firstSectionContent(raw, label)
    if (fromRaw && !isMeaninglessTicketPlaceholderText(fromRaw)) return fromRaw
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
  if (isMeaninglessTicketPlaceholderText(append)) append = ''
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

  const rawFallback = fields.rawText?.trim()
  if (rawFallback && isMeaningfulTicketText(rawFallback)) return rawFallback

  return (
    handlingBody ||
    acceptance ||
    append ||
    fields.customerQuote?.trim() ||
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
