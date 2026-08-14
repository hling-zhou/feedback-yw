/**
 * @param {unknown} err
 * @param {string} fallback
 */
export function topicRequestErrorMessage(err, fallback) {
  const msg = err instanceof Error ? err.message : String(err || '')
  if (!msg || msg === 'Failed to fetch' || /NetworkError|network error/i.test(msg)) {
    return `${fallback}：无法连接服务器，请确认已登录且 API 已启动`
  }
  return msg
}

/**
 * @param {string} type
 */
export function customTopicQueryHint(type) {
  if (type === 'customer') return '可输入客户名称、编码或一段描述。下一步会抽出客户对象请你确认；匹配仍按名称/编码。'
  if (type === 'product_issue') return '可输入产品、问题或两者连写。系统会拆开匹配，原文不必出现完整连写。'
  return '按问题类型或关键词跨产品匹配；可夹杂产品名。原文不必 100% 连写。'
}

/**
 * @param {string} type
 * @param {string} query
 */
export function customTopicTypeMismatch(type, query) {
  const text = String(query || '').trim()
  if (!text || type !== 'customer') return ''
  const looksLikeCustomer = /公司|集团|局|厅|委|大学|学院|医院|银行|有限|股份/.test(text)
    || /^[A-Za-z0-9][A-Za-z0-9._-]{3,}$/.test(text)
  if (looksLikeCustomer) return ''
  return `「${text}」更像问题关键词。客户专题只会按客户名称/编码找记录，建议改选「共性问题专题」。`
}

/** 确认步里产品/关键词用顿号分隔；输入时保留末尾顿号，生成时再丢掉空段。 */
export function topicLabelListFromInput(text) {
  return String(text ?? '').split(/[、,，]/)
}

export function topicLabelListToInput(items) {
  return (Array.isArray(items) ? items : []).join('、')
}

export function parseTopicLabelList(items) {
  return (Array.isArray(items) ? items : topicLabelListFromInput(items))
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

/**
 * 纳入分析时去掉内存 records，避免把工单全文写入 meta。
 * @param {object} topic
 */
export function topicForPersist(topic) {
  if (!topic || typeof topic !== 'object') return topic
  const { records, ...rest } = topic
  return rest
}
