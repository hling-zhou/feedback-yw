const CUSTOMER_QUOTE_RE =
  /(?<=客户问题|详细内容|问题描述|客户反馈|客户需求|工单标题|咨询内容|咨询问题|客户咨询)[:：]*(.*?)(?=\n|联系时间|问题原因|请求节点|客户标签|$)/g

const RESPONSE_RE =
  /(?<=处理意见|解决方案)[:：]*(.*?)(?=\n|如有问题随时咨询|如有其他问题请随时联系|如有问题请随时联系|$)/g

/**
 * @param {string} text
 * @returns {string}
 */
export function extractCustomerQuote(text) {
  if (!text?.trim()) return ''
  const matches = [...text.matchAll(CUSTOMER_QUOTE_RE)].map((m) => m[1]?.trim()).filter(Boolean)
  if (matches.length > 0) return matches[0]
  return text.trim().slice(0, 500)
}

/**
 * @param {string} text
 * @returns {string}
 */
export function extractResponseText(text) {
  if (!text?.trim()) return ''
  const matches = [...text.matchAll(RESPONSE_RE)].map((m) => m[1]?.trim()).filter(Boolean)
  if (matches.length > 0) return matches[matches.length - 1]
  return ''
}

/**
 * @param {string} rawText
 * @param {boolean} useRegex
 */
export function extractFromRaw(rawText, useRegex = true) {
  if (!useRegex) {
    return { customerQuote: rawText?.trim() || '', responseText: '' }
  }
  return {
    customerQuote: extractCustomerQuote(rawText),
    responseText: extractResponseText(rawText),
  }
}
