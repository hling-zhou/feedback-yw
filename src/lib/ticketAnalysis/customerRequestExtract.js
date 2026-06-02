import {
  extractCustomerRequestSegments,
  isPlatformActionContent,
  parseLabelValueBlocks,
  resolveDisplayCustomerQuote,
  trimInlinePlatformFieldSuffix,
} from '../ticketDetailDisplay.js'
import {
  extractAcceptanceTextFromFields,
  extractHandlingTextFromFields,
  isMeaninglessTicketPlaceholderText,
} from '../taggingText.js'
import {
  cleanCustomerRequestPhrase,
  isCustomerDemandLike,
  isFormattedTemplateContent,
  isInternalCsBackendText,
  isPlatformOutcomeContent,
  isProductOnlyProblemLabel,
} from './customerRequestFilters.js'
import { stripInternalWorkflowPrefix } from './workflowTextCleanup.js'

export const CUSTOMER_REQUEST_DEFAULT_MAX = 80
export const CUSTOMER_REQUEST_HARD_MAX = 120

const CORRECTION_RE =
  /之前说的不对|刚才说.*其实是|更正[：:,，]|补充说明[：:,，]|其实是(?!.*已解决)|不是.*而是/

const RESOLVED_RE =
  /(?:已解决|已恢复|恢复正常|无异常|问题消除|可以访问|复测通过|业务恢复|无异议)/

const SEVERITY_FAULT_RE =
  /(?:故障|中断|不可用|不通|失败|报错|异常|掉线|无法访问|无法传输|无法订购|无法退订|无法ping|证书错误|提示.*错误)/

const SEVERITY_PERF_RE = /(?:慢|卡顿|延迟|丢包|时通时断|不稳定)/

const SEVERITY_CONSULT_RE = /(?:咨询|如何|怎么|请问|申请|查询|开通|解售罄|配额|进度)/

/**
 * 截取 1～3 句，默认 80 字、最长 120 字
 * @param {string} text
 * @param {number} [hardMax]
 */
export function truncateCustomerRequest(text, hardMax = CUSTOMER_REQUEST_HARD_MAX) {
  let t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''

  t = t.replace(/^["「『]|["」』]$/g, '').trim()

  const sentences = t.split(/(?<=[。！？!?；;])\s*/).filter(Boolean)
  /** @type {string[]} */
  let picked = []
  let len = 0
  for (const s of sentences.length ? sentences : [t]) {
    const part = s.trim()
    if (!part) continue
    if (picked.length >= 3) break
    if (len + part.length > hardMax && picked.length) break
    picked.push(part)
    len += part.length
  }
  if (!picked.length) picked = [t.slice(0, hardMax)]

  let out = picked.join('')
  if (out.length > hardMax) out = out.slice(0, hardMax)
  return out
}

/**
 * 合并「产品名 + 后续诉求句」
 *
 * @param {string} product
 * @param {string} intent
 */
export function mergeProductWithIntent(product, intent) {
  const productClean = product.trim()
  let intentClean = intent.trim().replace(/^客户/, '').trim()
  if (!intentClean) return productClean
  if (intentClean.includes(productClean)) return intentClean
  if (productClean.includes(intentClean)) return productClean
  return `${productClean}${intentClean}`
}

/**
 * 多条候选合并为一条客户请求（产品名 + 诉求 / 取最优）
 *
 * @param {string[]} texts
 */
export function consolidateCustomerRequestTexts(texts) {
  const parts = texts
    .map((t) => cleanCustomerRequestPhrase(trimInlinePlatformFieldSuffix(t)))
    .filter(Boolean)
    .filter(
      (t) =>
        !isMeaninglessTicketPlaceholderText(t) &&
        !isPlatformOutcomeContent(t) &&
        !isFormattedTemplateContent(t) &&
        isCustomerDemandLike(t),
    )
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0]
  if (isProductOnlyProblemLabel(parts[0])) {
    return mergeProductWithIntent(parts[0], parts.slice(1).join(''))
  }
  const scored = parts.map((text, order) => ({
    text,
    score: scoreCustomerRequestCandidate({ text, phase: 1, order }),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.text || parts[0]
}

/**
 * @param {string} text
 */
export function normalizeCustomerRequestText(text) {
  const t = cleanCustomerRequestPhrase(trimInlinePlatformFieldSuffix(text || ''))
  if (!t || isMeaninglessTicketPlaceholderText(t) || isPlatformOutcomeContent(t)) return ''
  return t
}

/**
 * @typedef {{ text: string; order: number; phase: number }} CustomerRequestCandidate
 */

/**
 * @param {string} text
 */
export function isCustomerCorrectionText(text) {
  return CORRECTION_RE.test(text || '')
}

/**
 * @param {string} text
 */
export function isResolvedCustomerText(text) {
  const t = (text || '').trim()
  if (!t) return false
  return RESOLVED_RE.test(t) && !SEVERITY_FAULT_RE.test(t)
}

/**
 * 严重性分级：1=故障 2=性能 3=咨询 4=其他（数字越小优先级越高）
 * @param {string} text
 */
export function getCustomerRequestSeverityTier(text) {
  const t = text || ''
  if (SEVERITY_FAULT_RE.test(t)) return 1
  if (SEVERITY_PERF_RE.test(t)) return 2
  if (SEVERITY_CONSULT_RE.test(t)) return 3
  return 4
}

/**
 * V2 多轮优先级档：1=修正 2=严重性 3=最新 4=最完整（数字越小越优先）
 * @param {CustomerRequestCandidate} candidate
 */
export function getCustomerRequestPriorityTier(candidate) {
  const t = candidate.text
  if (isCustomerCorrectionText(t)) return 1
  if (isResolvedCustomerText(t)) return 5
  return 2
}

/** 移动云工单：`开始&客服组.xxx&处理意见：` 多段流转 */
const WORKFLOW_HANDLING_BLOCK_RE =
  /(?:^|\n)(?:(?:开始|首处理|协办|反馈)&[^\n]*?&处理意见[：:])([\s\S]*?)(?=(?:(?:^|\n)(?:开始|首处理|协办|反馈)&)|$)/g

/** 旧式：`协办&网络组：` 单段组名 */
const LEGACY_WORKFLOW_BLOCK_SPLIT_RE =
  /(?:^|[。；;\n]\s*)(?:协办|反馈|开始|首处理|详细内容)&[^&\n]{1,40}[：:]/

const WORKFLOW_INLINE_DETAIL_RE =
  /详细内容\s*[：:]\s*([\s\S]*?)(?=联系时间\s*[：:]|##|产品名称\s*[：:]|受理渠道\s*[：:]|$)/i

const WORKFLOW_NUMBERED_DEMAND_RE =
  /(?:^|\d+[、.．]\s*)【?客户(?:问题|需求)】?\s*[：:]\s*([\s\S]*?)(?=\d+[、.．]\s*(?:【?(?:问题原因|产品|目前进展|预处理|协助|解决方案|处理人|是否验证|回单)|产品UUID|预处理|协助请求)|$)/i

const WORKFLOW_CUSTOMER_PROBLEM_INLINE_RE =
  /(?:^|\n|\d+[、.．]\s*)【?客户(?:问题|需求)】?\s*[：:]\s*([\s\S]*?)(?=(?:^|\n|\d+[、.．]\s*)【?(?:问题原因|解决方案|处理意见|目前进展|协助|预处理|产品UUID)|$)/i

/**
 * 从受理/咨询正文直接抽取客户问题（segments 为空时的 fallback）
 *
 * @param {{ handlingText?: string; rawText?: string; customerQuote?: string; sourceColumns?: Record<string, string> }} fields
 */
function extractCustomerRequestFromAcceptance(fields) {
  const acceptance = extractAcceptanceTextFromFields(fields)
  if (!acceptance?.trim()) return ''

  for (const block of parseLabelValueBlocks(acceptance)) {
    if (!block.label) continue
    const label = block.label.replace(/[（(].*[）)]/g, '').trim()
    if (!/^(?:客户问题|客户需求|详细内容|问题描述|咨询内容|客户反馈|受理内容|问题现象|故障现象|客户原话|用户问题|工单标题)$/.test(label)) {
      continue
    }
    const body = cleanCustomerRequestPhrase(trimInlinePlatformFieldSuffix(block.text))
    if (
      body &&
      !isMeaninglessTicketPlaceholderText(body) &&
      !isFormattedTemplateContent(body) &&
      isCustomerDemandLike(body)
    ) {
      return body
    }
  }

  const inline = acceptance.match(WORKFLOW_CUSTOMER_PROBLEM_INLINE_RE)
  if (inline?.[1]) {
    const body = cleanCustomerRequestPhrase(trimInlinePlatformFieldSuffix(inline[1]))
    if (
      body &&
      !isMeaninglessTicketPlaceholderText(body) &&
      !isFormattedTemplateContent(body) &&
      isCustomerDemandLike(body)
    ) {
      return body
    }
  }

  const detail = acceptance.match(WORKFLOW_INLINE_DETAIL_RE)
  if (detail?.[1]) {
    const body = cleanCustomerRequestPhrase(trimInlinePlatformFieldSuffix(detail[1]))
    if (
      body &&
      !isFormattedTemplateContent(body) &&
      isCustomerDemandLike(body)
    ) {
      return body
    }
  }

  return ''
}

const WORKFLOW_CUSTOMER_REACTION_RE =
  /客户反应[，,]\s*([\s\S]{8,400}?)(?=(?:，|,)?(?:36\.\*|uuid\s*[：:]|联系时间|##资源ID|产品名称|受理渠道)|$)/i

/** 平台回单/客服口径模板，非客户诉求 */
const CUSTOMER_SERVICE_REPLY_RE =
  /您好[!！].*(?:关于您反映的问题|关于您反馈的问题|经.{0,12}(?:核实|排查)|深感抱歉)/

/**
 * 客户请求候选是否应视为平台侧内容而丢弃
 * @param {string} text
 */
export function isCustomerRequestPlatformNoise(text) {
  const t = (text || '').trim()
  if (!t) return true
  if (CUSTOMER_SERVICE_REPLY_RE.test(t)) return true
  if (!isPlatformActionContent(t)) return false
  // 「需要建群处理 + 请排查 + 带宽/故障」等混合句保留客户诉求
  if (
    t.length >= 16 &&
    /(?:请排查|客户反应|带宽|超时|无法|不通|故障|下载|镜像)/.test(t) &&
    !/^(?:已协助|已为您|已处理|经排查|定位为)/.test(t)
  ) {
    return false
  }
  return true
}

/**
 * 去掉资源 ID、联系时间等尾部元数据
 * @param {string} text
 */
export function stripCustomerDemandMetadataTail(text) {
  return (text || '')
    .replace(/(?:，|,)\s*36\.\*[\s\S]*$/i, '')
    .replace(/(?:，|,)\s*uuid\s*[：:][\s\S]*$/i, '')
    .replace(/(?:联系时间|##资源ID|产品名称|受理渠道)[：:\s][\s\S]*$/i, '')
    .trim()
}

/**
 * @param {string} corpus
 * @returns {string[]}
 */
export function splitWorkflowHandlingBlocks(corpus) {
  if (!corpus?.trim()) return []
  /** @type {string[]} */
  const blocks = []
  for (const match of corpus.matchAll(WORKFLOW_HANDLING_BLOCK_RE)) {
    const body = match[1]?.trim()
    if (body) blocks.push(body)
  }
  return blocks
}

/**
 * 从单段 `&处理意见：` 正文中抽取客户诉求
 * @param {string} body
 */
export function extractCustomerDemandFromWorkflowBody(body) {
  let t = stripInternalWorkflowPrefix(body)
  if (!t) return ''

  const fromQuote = resolveDisplayCustomerQuote(t, {})
  if (
    fromQuote &&
    !isFormattedTemplateContent(fromQuote) &&
    !isCustomerRequestPlatformNoise(fromQuote)
  ) {
    return stripCustomerDemandMetadataTail(cleanCustomerRequestPhrase(fromQuote))
  }

  const numbered = t.match(WORKFLOW_NUMBERED_DEMAND_RE)
  if (numbered?.[1]) {
    return stripCustomerDemandMetadataTail(cleanCustomerRequestPhrase(numbered[1]))
  }

  const inlineDetail = t.match(WORKFLOW_INLINE_DETAIL_RE)
  if (inlineDetail?.[1]) {
    const detail = stripCustomerDemandMetadataTail(cleanCustomerRequestPhrase(inlineDetail[1]))
    if (detail && !isFormattedTemplateContent(detail) && isCustomerDemandLike(detail)) {
      return detail
    }
  }

  const reaction = t.match(WORKFLOW_CUSTOMER_REACTION_RE)
  if (reaction?.[1]) {
    const phrase = stripCustomerDemandMetadataTail(
      cleanCustomerRequestPhrase(`客户反应，${reaction[1]}`),
    )
    if (phrase && isCustomerDemandLike(phrase)) return phrase
  }

  return ''
}

/**
 * 从协办/反馈/详细内容等环节提取客户侧表述片段
 * @param {string} corpus
 * @returns {string[]}
 */
export function extractLifecycleCustomerPhrases(corpus) {
  if (!corpus?.trim()) return []

  /** @type {string[]} */
  const phrases = []
  const seen = new Set()

  const add = (raw) => {
    const cleaned = cleanCustomerRequestPhrase(stripCustomerDemandMetadataTail(raw))
    if (!cleaned || cleaned.length < 2) return
    const key = cleaned.replace(/\s+/g, '')
    if (seen.has(key)) return
    if (isMeaninglessTicketPlaceholderText(cleaned)) return
    if (isCustomerRequestPlatformNoise(cleaned)) return
    if (isInternalCsBackendText(cleaned)) return
    if (isPlatformOutcomeContent(cleaned)) return
    if (isFormattedTemplateContent(cleaned)) return
    if (!isCustomerDemandLike(cleaned)) return
    seen.add(key)
    phrases.push(cleaned)
  }

  for (const blockBody of splitWorkflowHandlingBlocks(corpus)) {
    const demand = extractCustomerDemandFromWorkflowBody(blockBody)
    if (demand) add(demand)
  }

  for (const m of corpus.matchAll(/客户原话[：:]\s*[「"']?([^」"'\n]{2,200})/g)) {
    add(m[1])
  }

  const blocks = corpus.split(LEGACY_WORKFLOW_BLOCK_SPLIT_RE)
  for (const block of blocks) {
    const body = stripInternalWorkflowPrefix(block)
    const voice = body.match(
      /客户(?:反馈|表示|补充|咨询|原话|反应)[：:，,]?\s*([^。；;\n]{2,200})/,
    )
    if (voice?.[1]) {
      add(voice[1])
      continue
    }
    const beforeHandoff = body.split(/(?:协办|反馈)&[^&\n]+[：:]/)[0]?.trim()
    if (
      beforeHandoff &&
      beforeHandoff.length >= 4 &&
      !/(?:^|\n)\s*处理意见\s*[：:]/.test(beforeHandoff) &&
      !isCustomerRequestPlatformNoise(beforeHandoff)
    ) {
      add(beforeHandoff)
    }
  }

  const detail = corpus.match(/详细内容[：:]([^\n|]{2,400})/)
  if (detail?.[1]) {
    for (const part of detail[1].split(LEGACY_WORKFLOW_BLOCK_SPLIT_RE)) {
      const voice = part.match(/客户(?:反馈|表示|补充|反应)[：:，,]?\s*([^。；;\n]{2,200})/)
      if (voice?.[1]) add(voice[1])
    }
  }

  return phrases
}

/**
 * @param {CustomerRequestCandidate} candidate
 */
export function scoreCustomerRequestCandidate(candidate) {
  const t = candidate.text
  if (!t) return -1

  let score = Math.min(t.length, 80)

  if (SEVERITY_FAULT_RE.test(t)) score += 40
  else if (SEVERITY_PERF_RE.test(t)) score += 25
  else if (SEVERITY_CONSULT_RE.test(t)) score += 10

  if (isCustomerCorrectionText(t)) score += 100
  if (/(?:稍后|拓扑|未回复|保留工单|提供材料)/.test(t) && !SEVERITY_FAULT_RE.test(t)) {
    score -= 18
  }
  if (/(?:已联系|已指导|已协助)/.test(t)) score -= 40
  if (isResolvedCustomerText(t)) score -= 60

  score += Math.min(candidate.phase, 4) * 8
  score += Math.min(candidate.order, 20) * 0.5

  return score
}

/**
 * @param {CustomerRequestCandidate[]} candidates
 */
export function selectBestCustomerRequest(candidates) {
  if (!candidates.length) return ''

  const active = candidates.filter((c) => c.text && !isResolvedCustomerText(c.text))
  const pool = active.length ? active : candidates

  /** @type {CustomerRequestCandidate | null} */
  let best = null

  for (const c of pool) {
    if (!best) {
      best = c
      continue
    }

    const tierA = getCustomerRequestPriorityTier(c)
    const tierB = getCustomerRequestPriorityTier(best)
    if (tierA !== tierB) {
      if (tierA < tierB) best = c
      continue
    }

    const sevA = getCustomerRequestSeverityTier(c.text)
    const sevB = getCustomerRequestSeverityTier(best.text)
    if (sevA !== sevB) {
      if (sevA < sevB) best = c
      continue
    }

    if (c.order !== best.order) {
      if (c.order > best.order) best = c
      continue
    }

    const scoreA = scoreCustomerRequestCandidate(c)
    const scoreB = scoreCustomerRequestCandidate(best)
    if (scoreA > scoreB) best = c
    else if (scoreA === scoreB && c.text.length > best.text.length) best = c
  }

  return best?.text || ''
}

const PHASE_LABELS = {
  1: '受理',
  2: '协办/反馈',
  3: '追加',
  4: '处理意见',
}

/**
 * @param {CustomerRequestCandidate[]} candidates
 */
export function formatCustomerRequestCandidatesForLlm(candidates) {
  if (!candidates.length) return '（无规则候选）'
  return candidates
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c, i) => {
      const label = PHASE_LABELS[c.phase] || '其他'
      return `${i + 1}. [${label}] ${c.text}`
    })
    .join('\n')
}

/**
 * 贯穿工单全生命周期收集客户诉求候选
 * @param {Object} input
 */
export function collectCustomerRequestCandidates(input) {
  const fields = {
    handlingText: input.handlingText,
    rawText: input.rawText,
    customerQuote: input.customerQuote,
    sourceColumns: input.sourceColumns,
  }

  /** @type {CustomerRequestCandidate[]} */
  const candidates = []

  const quote = input.customerQuote?.trim()
  if (quote) {
    const display = resolveDisplayCustomerQuote(quote, fields)
    if (display) {
      candidates.push({ text: cleanCustomerRequestPhrase(display), phase: 1, order: 0 })
    }
  }

  const segments = extractCustomerRequestSegments(fields)
  segments.forEach((seg, index) => {
    const phase = seg.phase === 'append' ? 3 : 1
    candidates.push({
      text: cleanCustomerRequestPhrase(seg.text),
      phase,
      order: 10 + index,
    })
  })

  const effectiveHandling = extractHandlingTextFromFields(fields)
  const corpus = [input.rawText, effectiveHandling].filter(Boolean).join('\n')
  extractLifecycleCustomerPhrases(corpus).forEach((phrase, index) => {
    candidates.push({ text: phrase, phase: 2, order: 100 + index })
  })

  return candidates.filter(
    (c) =>
      c.text &&
      !isMeaninglessTicketPlaceholderText(c.text) &&
      !isCustomerRequestPlatformNoise(c.text) &&
      !isInternalCsBackendText(c.text) &&
      !isPlatformOutcomeContent(c.text) &&
      !isFormattedTemplateContent(c.text) &&
      isCustomerDemandLike(c.text),
  )
}

/**
 * 从处理意见中提取客户侧诉求（当受理侧无有效客户请求时的 fallback）
 * @param {string} handlingText
 * @returns {string}
 */
function extractCustomerRequestFromHandling(handlingText) {
  if (isMeaninglessTicketPlaceholderText(handlingText)) return ''
  if (!handlingText?.trim()) return ''
  const phrases = extractLifecycleCustomerPhrases(handlingText)
  if (phrases.length) {
    const best = selectBestCustomerRequest(
      phrases.map((p, i) => ({ text: p, phase: 4, order: 200 + i })),
    )
    if (best) return best
  }
  return ''
}

/**
 * 规则版客户请求（全生命周期候选 + 选取 + 截断），供 LLM fallback 与无 Key 场景
 * @param {Object} input
 */
export function extractCustomerRequestRule(input) {
  const candidates = collectCustomerRequestCandidates(input)
  const consolidated = consolidateCustomerRequestTexts(candidates.map((c) => c.text))
  if (consolidated) return truncateCustomerRequest(consolidated)

  const best = selectBestCustomerRequest(candidates)
  if (best) return truncateCustomerRequest(normalizeCustomerRequestText(best))

  const fields = {
    handlingText: input.handlingText,
    rawText: input.rawText,
    customerQuote: input.customerQuote,
    sourceColumns: input.sourceColumns,
  }
  const quote = input.customerQuote?.trim()
  if (quote && !isFormattedTemplateContent(quote)) {
    const display = resolveDisplayCustomerQuote(quote, fields)
    if (display && !isFormattedTemplateContent(display)) {
      return truncateCustomerRequest(cleanCustomerRequestPhrase(display))
    }
  }

  const fromHandling = extractCustomerRequestFromHandling(
    extractHandlingTextFromFields(fields),
  )
  if (fromHandling) return truncateCustomerRequest(fromHandling)

  const fromAcceptance = extractCustomerRequestFromAcceptance(fields)
  if (fromAcceptance) return truncateCustomerRequest(fromAcceptance)

  if (quote && !isFormattedTemplateContent(quote)) {
    return truncateCustomerRequest(quote)
  }

  return ''
}

/**
 * 用户请求内容：规则版提取（LLM 增强见 customerRequestLLM.js）
 * @param {Object} input
 */
export function extractCustomerRequest(input) {
  return extractCustomerRequestRule(input)
}

/**
 * @param {Object} input
 */
export function buildCustomerRequestExtractionContext(input) {
  const candidates = collectCustomerRequestCandidates(input)
  const ruleFallback = extractCustomerRequestRule(input)
  return { candidates, ruleFallback }
}
