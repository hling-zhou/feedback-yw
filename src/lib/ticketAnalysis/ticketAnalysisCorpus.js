import {
  extractAcceptanceTextFromFields,
  extractAppendTextFromFields,
  extractHandlingTextFromFields,
} from '../taggingText.js'

/**
 * @typedef {Object} TicketAnalysisCorpus
 * @property {string} taggingText 打标用语料（受理 + 处理 + 追加）
 * @property {string} customerTextForSentiment 情绪分析语料（客户原话优先）
 * @property {string} [requestPathRaw] 请求节点/系统路径原文
 * @property {string[]} pathSegments 路径分段（-- 分隔，已 trim）
 * @property {boolean} fuzzy 内容极度模糊，可启用路径兜底
 */

const PATH_LINE_RE = /(?:请求节点|系统路径)[：:]\s*([^\n]+)/i

const FUZZY_CONTENT_RE =
  /请排查|暂未回复|工单保留|待客户|信息不全|稍后提供|客户未回复|待补充|无实质|不涉及/

/**
 * @param {string} text
 */
export function parseRequestPathSegments(text) {
  const m = (text || '').match(PATH_LINE_RE)
  if (!m) return { raw: '', segments: [] }
  const raw = m[1].trim()
  const segments = raw
    .split('--')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'undefined')
  return { raw, segments }
}

/**
 * @param {string} taggingText
 * @param {{ requestScene?: string; problemType?: string; journeyL1?: string }} [contentTags]
 */
export function isCorpusFuzzy(taggingText, contentTags = {}) {
  if (FUZZY_CONTENT_RE.test(taggingText || '')) return true
  const scene = contentTags.requestScene
  const problem = contentTags.problemType
  const j1 = contentTags.journeyL1
  const unrecognized =
    (!scene || scene === '未分类' || scene === '无法识别') &&
    (!problem || problem === '未分类' || problem === '无法识别') &&
    (!j1 || j1 === '未识别环节' || j1 === '无法识别')
  if (unrecognized && (taggingText || '').length < 80) return true
  return false
}

/**
 * @param {Object} input
 * @param {string} [input.rawText]
 * @param {string} [input.handlingText]
 * @param {string} [input.customerQuote]
 * @param {Record<string, string>} [input.sourceColumns]
 */
export function buildTicketAnalysisCorpus(input) {
  const fields = {
    rawText: input.rawText,
    handlingText: input.handlingText,
    customerQuote: input.customerQuote,
    sourceColumns: input.sourceColumns,
  }

  const acceptance = extractAcceptanceTextFromFields(fields)
  const handling = extractHandlingTextFromFields(fields)
  const append = extractAppendTextFromFields(fields)

  /** @type {string[]} */
  const parts = []
  if (acceptance?.trim()) parts.push(acceptance.trim())
  if (handling?.trim() && handling.trim() !== acceptance?.trim()) {
    parts.push(`【处理意见】\n${handling.trim()}`)
  }
  if (append?.trim()) parts.push(`【追加信息】\n${append.trim()}`)

  const taggingText = parts.join('\n\n') || input.rawText?.trim() || input.handlingText?.trim() || ''
  const customerTextForSentiment = acceptance?.trim() || taggingText

  const { raw, segments } = parseRequestPathSegments(taggingText)

  return {
    taggingText,
    customerTextForSentiment,
    requestPathRaw: raw,
    pathSegments: segments,
    fuzzy: false,
  }
}

/**
 * @param {TicketAnalysisCorpus} corpus
 * @param {Object} contentTags
 */
export function finalizeCorpusFuzzy(corpus, contentTags) {
  return {
    ...corpus,
    fuzzy: isCorpusFuzzy(corpus.taggingText, contentTags),
  }
}
