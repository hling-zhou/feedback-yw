import { analyzeSentiment, isNegativeSentiment } from '../sentiment.js'
import { normalizeEvidenceText } from './evidence.js'
import {
  classifyCustomerTextKind,
  isValidCustomerText,
  splitFeedbackReasonPieces,
} from './reasonTaxonomy.js'

const CHANNEL_LABELS = {
  console: '官网评分类',
  option: '选项类',
  sms: '短信渠道',
  callback: '投诉回访',
}

function normalizeChannel(record) {
  const raw = String(record?.channel || record?.sourceSubType || '').trim()
  if (raw === 'console' || raw === 'web_survey') return 'console'
  if (raw === 'option' || raw === 'web_option') return 'option'
  if (raw === 'callback' || raw === 'satisfaction_callback') return 'callback'
  if (raw === 'sms' || raw === 'sms_survey') return 'sms'
  return raw
}

/**
 * 评分类 / 选项类：反馈原因列表；缺省回退 commentText。
 * @param {object} record
 * @returns {string[]}
 */
export function collectFeedbackReasonValues(record) {
  const explicit = Array.isArray(record?.feedbackReasonTexts) ? record.feedbackReasonTexts : []
  const fallback = explicit.length
    ? explicit
    : [
      record?.feedbackReasonPrimary,
      record?.feedbackReasonSecondary,
      record?.feedbackReasonTertiary,
    ]
  const seen = new Set()
  const values = []
  for (const candidate of fallback) {
    const text = normalizeEvidenceText(candidate)
    if (!text || seen.has(text)) continue
    seen.add(text)
    values.push(text)
  }
  if (!values.length) {
    const comment = normalizeEvidenceText(record?.commentText)
    if (comment) values.push(comment)
  }
  return values
}

/**
 * 短信 / 回访只用补充评价或电话回访意见（commentText），不用不满原因。
 * @param {object} record
 * @returns {string[]}
 */
export function collectCustomerQuoteSourceValues(record) {
  const channel = normalizeChannel(record)
  if (channel === 'sms' || channel === 'callback') {
    const comment = normalizeEvidenceText(record?.commentText || record?.rawComment)
    return comment ? [comment] : []
  }
  return collectFeedbackReasonValues(record)
}

/**
 * 用后即评正负口径：先对齐「10 分满意 / 非10分」，10 分自由文本再看语义。
 * 问卷固定原因选项一律为负反馈；非 10 分（含无分）自由文本为负。
 * 10 分自由文本若命中负面语义（轻度不满 / 不满 / 强烈不满），仍记负反馈。
 * @param {{ kind?: string, score?: number | null, text?: string }} item
 * @returns {'positive' | 'negative'}
 */
export function classifyFeedbackPolarity(item) {
  if (item?.kind === 'option') return 'negative'
  if (Number(item?.score) !== 10) return 'negative'
  const text = String(item?.text || '').trim()
  if (text && isNegativeSentiment(analyzeSentiment(text))) return 'negative'
  return 'positive'
}

/**
 * @param {object} record
 * @returns {Array<{
 *   text: string
 *   kind: 'quote' | 'option'
 *   polarity: 'positive' | 'negative'
 *   channel: string
 *   channelLabel: string
 *   productName: string
 *   customerName: string
 *   customerCode: string
 *   score: number | null
 *   answeredAt: string
 *   recordId: string
 * }>}
 */
export function extractValidCustomerTexts(record) {
  const channel = normalizeChannel(record)
  const channelLabel = CHANNEL_LABELS[channel] || channel || '未知渠道'
  const productName = String(record?.productName || record?.product || '').trim()
  const scoreRaw = Number(record?.ratingScore ?? record?.score)
  const score = Number.isFinite(scoreRaw) ? scoreRaw : null
  const out = []
  const seen = new Set()
  for (const raw of collectCustomerQuoteSourceValues(record)) {
    for (const piece of splitFeedbackReasonPieces(raw)) {
      const kind = classifyCustomerTextKind(piece)
      if (!kind || seen.has(`${kind}:${piece}`)) continue
      seen.add(`${kind}:${piece}`)
      out.push({
        text: piece,
        kind,
        polarity: classifyFeedbackPolarity({ kind, score, text: piece }),
        channel,
        channelLabel,
        productName,
        customerName: String(record?.customerName || '').trim(),
        customerCode: String(record?.customerCode || '').trim(),
        score,
        answeredAt: String(record?.createdAt || record?.answeredAt || ''),
        recordId: String(record?.id || ''),
      })
    }
  }
  return out
}

/**
 * @param {object[]} records
 */
export function buildCustomerQuoteRegistry(records) {
  return (records || []).flatMap((record) => extractValidCustomerTexts(record))
}

/**
 * 问题条优先挂负向原话；正向原话单独返回，避免把表扬当成问题证据。
 * @param {ReturnType<typeof extractValidCustomerTexts>} items
 * @param {{ maxQuotes?: number, maxOptions?: number, maxPositive?: number }} [opts]
 */
export function pickIssueEvidenceTexts(items, opts = {}) {
  const maxQuotes = opts.maxQuotes ?? 3
  const maxOptions = opts.maxOptions ?? 2
  const maxPositive = opts.maxPositive ?? 2
  const quotes = []
  const options = []
  const positiveQuotes = []
  const seen = new Set()
  for (const item of items || []) {
    if (!item?.text || seen.has(item.text)) continue
    seen.add(item.text)
    const polarity = item.polarity || classifyFeedbackPolarity(item)
    if (item.kind === 'quote' && polarity === 'positive') {
      if (positiveQuotes.length < maxPositive) positiveQuotes.push({ ...item, polarity: 'positive' })
      continue
    }
    if (item.kind === 'quote' && quotes.length < maxQuotes) quotes.push({ ...item, polarity: 'negative' })
    if (item.kind === 'option' && options.length < maxOptions) options.push({ ...item, polarity: 'negative' })
  }
  if (quotes.length) return { quotes: quotes.slice(0, maxQuotes), options: [], positiveQuotes }
  return { quotes: [], options: options.slice(0, maxOptions), positiveQuotes }
}

/**
 * @param {ReturnType<typeof extractValidCustomerTexts>} registry
 */
export function summarizeQuotePolarity(registry) {
  let positiveQuotes = 0
  let negativeQuotes = 0
  let negativeOptions = 0
  for (const item of registry || []) {
    if (item.kind === 'option' || item.polarity === 'negative') {
      if (item.kind === 'option') negativeOptions += 1
      else negativeQuotes += 1
    } else {
      positiveQuotes += 1
    }
  }
  return {
    positiveQuotes,
    negativeQuotes,
    negativeOptions,
    positiveCount: positiveQuotes,
    negativeCount: negativeQuotes + negativeOptions,
  }
}

/**
 * @param {ReturnType<typeof extractValidCustomerTexts>} registry
 */
export function pickFeaturedVoiceQuotes(registry, limit = 3) {
  const positive = (registry || [])
    .filter((item) => item.kind === 'quote' && item.polarity === 'positive')
    .sort((a, b) => String(b.answeredAt || '').localeCompare(String(a.answeredAt || '')))
    .slice(0, limit)
  const negative = (registry || [])
    .filter((item) => item.kind === 'quote' && item.polarity === 'negative')
    .sort((a, b) => (a.score ?? 99) - (b.score ?? 99) || String(b.answeredAt || '').localeCompare(String(a.answeredAt || '')))
    .slice(0, limit)
  return { positive, negative }
}

export { isValidCustomerText, CHANNEL_LABELS }
