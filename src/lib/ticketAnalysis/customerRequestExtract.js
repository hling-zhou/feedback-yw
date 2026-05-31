import {
  extractCustomerRequestSegments,
  isMeaninglessCustomerText,
  isPlatformActionContent,
  resolveDisplayCustomerQuote,
} from '../ticketDetailDisplay.js'
import {
  cleanCustomerRequestPhrase,
  isCustomerDemandLike,
  isFormattedTemplateContent,
  isInternalCsBackendText,
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
    const cleaned = cleanCustomerRequestPhrase(raw)
    if (!cleaned || cleaned.length < 2) return
    const key = cleaned.replace(/\s+/g, '')
    if (seen.has(key)) return
    if (isMeaninglessCustomerText(cleaned)) return
    if (isPlatformActionContent(cleaned)) return
    if (isInternalCsBackendText(cleaned)) return
    if (isFormattedTemplateContent(cleaned)) return
    if (!isCustomerDemandLike(cleaned)) return
    seen.add(key)
    phrases.push(cleaned)
  }

  for (const m of corpus.matchAll(/客户原话[：:]\s*[「"']?([^」"'\n]{2,200})/g)) {
    add(m[1])
  }

  const blocks = corpus.split(/(?:^|[。；;\n]\s*)(?:协办|反馈|开始|首处理|详细内容)&[^&\n]{1,20}[：:]/)
  for (const block of blocks) {
    const body = stripInternalWorkflowPrefix(block)
    const voice = body.match(/客户(?:反馈|表示|补充|咨询|原话)[：:，,]?\s*([^。；;\n]{2,200})/)
    if (voice?.[1]) {
      add(voice[1])
      continue
    }
    const beforeHandoff = body.split(/(?:协办|反馈)&[^&\n]+[：:]/)[0]?.trim()
    if (beforeHandoff && beforeHandoff.length >= 4) add(beforeHandoff)
  }

  const detail = corpus.match(/详细内容[：:]([^\n|]{2,400})/)
  if (detail?.[1]) {
    for (const part of detail[1].split(/(?:协办|反馈)&[^&\n]{1,20}[：:]/)) {
      const voice = part.match(/客户(?:反馈|表示|补充)[：:，,]?\s*([^。；;\n]{2,200})/)
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

  const corpus = [input.rawText, input.handlingText].filter(Boolean).join('\n')
  extractLifecycleCustomerPhrases(corpus).forEach((phrase, index) => {
    candidates.push({ text: phrase, phase: 2, order: 100 + index })
  })

  return candidates.filter(
    (c) =>
      c.text &&
      !isMeaninglessCustomerText(c.text) &&
      !isPlatformActionContent(c.text) &&
      !isInternalCsBackendText(c.text) &&
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
  const best = selectBestCustomerRequest(candidates)
  if (best) return truncateCustomerRequest(best)

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

  const fromHandling = extractCustomerRequestFromHandling(input.handlingText)
  if (fromHandling) return truncateCustomerRequest(fromHandling)

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
