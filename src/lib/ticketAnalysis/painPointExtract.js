import { isMeaninglessTicketPlaceholderText } from '../taggingText.js'

export const PAIN_POINT_DEFAULT_MAX = 60
export const PAIN_POINT_HARD_MAX = 80

const LEADING_PHRASE_RE =
  /^(?:用户(?:希望|建议|反馈|要求|反映|咨询)|客户(?:希望|建议|反馈|要求|反映)|请(?:帮忙|协助)|希望|建议)/

const EMOTION_SNIPPETS =
  /太垃圾了|真无语|受不了|烦死了|着急|焦急|催|尽快|感谢|满意|不满|投诉|麻烦|请尽快/g

const OBJECTIVE_HINT_RE =
  /(?:导致|无法|失败|不通|异常|中断|不可用|未放行|缺少|错误|报错|超时|丢包|绑定失败|未配置|未开通|限制|拦截|不支持|缺失|不足|不明确|不稳定|效率低)/

const DEMAND_REWRITE_RULES = [
  {
    test: /(?:希望|建议|想要).*(?:批量删除|批量删)/,
    rewrite: '删除资源需逐个操作，效率低。',
  },
  {
    test: /(?:希望|建议|想要).*(?:批量导出|批量操作)/,
    rewrite: '不支持批量操作，效率低。',
  },
  {
    test: /(?:希望|建议).*(?:夜间模式|深色模式)/,
    rewrite: '控制台缺少夜间模式切换。',
  },
]

/**
 * @param {string} text
 */
function stripLeadingPhrases(text) {
  let t = (text || '').trim()
  for (let i = 0; i < 3; i += 1) {
    const next = t.replace(LEADING_PHRASE_RE, '').trim()
    if (next === t) break
    t = next
  }
  return t.replace(/^[：:，,。\s]+/, '').trim()
}

/**
 * 需求类痛点规则改写（LLM 不可用时的 fallback）
 * @param {string} text
 */
export function rewriteDemandPainPoint(text) {
  const t = (text || '').trim()
  if (!t) return ''
  for (const rule of DEMAND_REWRITE_RULES) {
    if (rule.test.test(t)) return rule.rewrite
  }
  if (/^(?:希望|建议|想要)/.test(t)) {
    const body = stripLeadingPhrases(t)
    if (body && body !== t) return truncatePainPoint(body)
  }
  return truncatePainPoint(t)
}

/**
 * @param {string} text
 * @param {number} [hardMax]
 */
export function truncatePainPoint(text, hardMax = PAIN_POINT_HARD_MAX) {
  let t = stripLeadingPhrases(text)
  t = t.replace(EMOTION_SNIPPETS, '').replace(/\s+/g, '').trim()
  if (!t || isMeaninglessTicketPlaceholderText(t)) return ''
  if (!/[。！？!?]$/.test(t)) {
    if (t.length > PAIN_POINT_DEFAULT_MAX) {
      const cut = t.split(/[，,；;]/)[0] || t
      if (cut.length >= 4) t = cut
    }
  }
  if (t.length > hardMax) t = t.slice(0, hardMax)
  if (t && !/[。！？!?]$/.test(t)) t = `${t.replace(/[，,；;]$/, '')}。`
  return t
}

/**
 * 规则版痛点挖掘
 * @param {Object} input
 * @param {string} [input.taggingText]
 * @param {string} [input.customerRequest]
 * @param {string} [input.handlingText]
 * @param {string} [input.rootCauseCol]
 */
export function extractPainPoint(input) {
  const customerRequest = input.customerRequest?.trim()
  const text = input.taggingText || ''

  if (customerRequest) {
    const fromRequest = rewriteDemandPainPoint(customerRequest)
    if (fromRequest) return fromRequest
  }

  const phenomenon =
    (text.match(/客户反馈([^，,。；;\n]{4,120})/) || [])[1]?.trim() ||
    (text.match(/故障现象[：:]([^\n]{4,120})/) || [])[1]?.trim() ||
    (text.match(/问题现象[：:]([^\n]{4,120})/) || [])[1]?.trim()

  if (phenomenon) return truncatePainPoint(phenomenon)

  const rc =
    input.rootCauseCol?.trim() ||
    (text.match(/根因[（(]?必填[）)]?[：:]([^\n]+)/) || [])[1]?.trim() ||
    (text.match(/定位为[：:]([^\n。；;]{4,120})/) || [])[1]?.trim() ||
    (text.match(/经排查[，,]([^\n。；;]{4,120})/) || [])[1]?.trim()

  if (rc && OBJECTIVE_HINT_RE.test(rc)) {
    return truncatePainPoint(rc.replace(/^原因是/, ''))
  }

  const title = (text.match(/工单标题[：:]([^\n]+)/) || [])[1]?.trim()
  if (title) return truncatePainPoint(title)

  return ''
}
