/** 协办/首处理等内部流转前缀（组别名中不含句号/逗号，避免吞掉客户正文） */
const INTERNAL_GROUP_PREFIX_RE =
  /^[^&\n。，、；;！!？?\s]{1,10}&[^：:\n]{1,16}[：:]/

const DETAIL_CONTENT_PREFIX_RE = /^详细内容[：:]\s*/

/**
 * 去掉工单内部组别名前缀，保留客户现象描述
 * @param {string} text
 */
export function stripInternalWorkflowPrefix(text) {
  let t = (text || '').trim()
  if (!t) return ''
  for (let i = 0; i < 4; i += 1) {
    const next = t.replace(INTERNAL_GROUP_PREFIX_RE, '').trim()
    if (next === t) break
    t = next
  }
  t = t.replace(DETAIL_CONTENT_PREFIX_RE, '').trim()
  return t
}

/**
 * @param {string} text
 */
export function stripTaggingNoise(text) {
  return stripInternalWorkflowPrefix(text)
    .replace(/^(?:客户反馈|用户反馈|客户表示|用户表示)/, '')
    .trim()
}
