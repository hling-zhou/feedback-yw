import { PROBLEM_TYPES_BUILTIN } from './sharedTagDefs.js'

/** @typedef {import('./sharedTagDefs.js').SharedTagRule} SharedTagRule */

export const PROBLEM_TYPE_OTHER = '其他'
export const PROBLEM_TYPE_CONSULT = '产品功能咨询'

/** 对端问题排除：网络可达证据 */
const PEER_REACHABLE_RE = /ping\s*通|ping正常|telnet\s*通|telnet正常|能ping通|网络正常/i

/** 对端问题排除：对端拒绝 */
const PEER_REFUSAL_RE =
  /\breset\b|\brefused\b|对端拒绝|被对方重置|对端服务器(?:问题)?/i

/** 纯情绪（无技术关键词时归入「其他」） */
const EMOTION_ONLY_HINT_RE =
  /不认可|要求升级|威胁流失|再不解决|上次结论|强烈不满|要投诉|投诉到底/

/** 咨询语境（正常操作/规则/步骤询问） */
const CONSULT_INTENT_RE =
  /如何|怎么|怎样|请问|流程是什么|规则是什么|是什么|查看|查一下|查询|怎么算|怎样算|什么时间|是否支持|指导|帮助文档|操作步骤|退订流程|核实/

/** 主动申请语境（配额类优先于开通失败） */
const APPLICATION_INTENT_RE =
  /申请|请提升|请帮忙解|解售罄|提升配额|配额申请|轻载|灰度|解除8:1|取消8:1|大带宽权限|扩容带宽|带宽提升|增加IP数量/

/** 操作/退订失败语境 */
const OPERATION_FAILURE_RE =
  /失败|报错|无法|错误|不生效|删不掉|内部错误|依赖|卡住/

/** 开通/创建过程中的超时（归资源开通，不归性能） */
const CREATION_TIMEOUT_RE =
  /开通[^。，；\n]{0,24}超时|申购[^。，；\n]{0,24}超时|创建[^。，；\n]{0,24}超时|一直卡在创建/

/** 决策树中视为「技术/业务」命中的关键词集合（用于纯情绪判定） */
const TECH_KEYWORD_POOL = PROBLEM_TYPES_BUILTIN.filter((r) => r.label !== PROBLEM_TYPE_OTHER).flatMap(
  (r) => r.keywords,
)

/**
 * @param {string} text
 */
function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

/**
 * @param {string} text
 * @param {string} keyword
 */
function matchesKeyword(text, keyword) {
  const t = text
  const kw = (keyword || '').trim()
  if (!kw || !t) return false
  const lower = t.toLowerCase()
  const kwLower = kw.toLowerCase()

  if (kw === '创建失败') {
    return /创建失败|创建[^。，；\n]{0,24}失败/.test(t)
  }

  if (kw === '开通失败') {
    return /开通失败|开通[^。，；\n]{0,24}失败/.test(t)
  }

  if (kw === '绑定失败') {
    return /绑定失败|绑定[^。，；\n]{0,24}失败/.test(t)
  }

  if (kw === '解绑失败') {
    return /解绑失败|解绑[^。，；\n]{0,24}失败/.test(t)
  }

  if (kw === '修改配置失败') {
    return /修改配置失败|修改[^。，；\n]{0,16}配置[^。，；\n]{0,16}失败|修改配置[^。，；\n]{0,16}报错/.test(t)
  }

  if (kw === '调整带宽失败') {
    return /调整带宽失败|修改带宽[^。，；\n]{0,16}报错|修改带宽报错/.test(t)
  }

  if (kw === '订购失败') {
    return /订购失败|订购[^。，；\n]{0,24}(失败|报错|售罄)/.test(t)
  }

  if (kwLower === 'reset' || kwLower === 'refused') {
    return new RegExp(`\\b${kwLower}\\b`, 'i').test(t)
  }

  return lower.includes(kwLower)
}

/**
 * @param {string} text
 * @param {string[]} keywords
 */
function matchesAnyKeyword(text, keywords) {
  const sorted = [...(keywords || [])].sort((a, b) => b.length - a.length)
  return sorted.some((kw) => matchesKeyword(text, kw))
}

/**
 * @param {string} text
 */
function hasConsultIntent(text) {
  return CONSULT_INTENT_RE.test(text)
}

/**
 * @param {string} text
 */
function hasApplicationIntent(text) {
  return APPLICATION_INTENT_RE.test(text)
}

/**
 * @param {string} text
 * @param {string[]} keywords
 */
function matchesPerformance(text, keywords) {
  if (CREATION_TIMEOUT_RE.test(text)) return false
  return matchesAnyKeyword(text, keywords)
}

/**
 * @param {string} text
 * @param {string[]} keywords
 */
function matchesAvailability(text, keywords) {
  if (matchesAnyKeyword(text, keywords)) return true
  // 资源被冻结且要排查/恢复：客户感知是不可用，不是来问账单
  if (/被冻结|订单冻结/.test(text) && /排查|协助|原因|恢复|异常|加急/.test(text)) {
    return true
  }
  return false
}

function matchesBilling(text, keywords) {
  if (matchesAnyKeyword(text, keywords)) return true
  // 欠费恢复后业务异常（§6.2 / §7.3）
  if (/欠费/.test(text) && /(异常|不合理|误判|限速|恢复)/.test(text)) return true
  // 重复扣费
  if (/扣[^。，；\n]{0,8}两次|两次[^。，；\n]{0,8}扣/.test(text)) return true
  return false
}

/**
 * @param {string} text
 */
function isQuotaHowToConsult(text) {
  return /如何[^。，；\n]{0,16}(申请|提升)|怎么[^。，；\n]{0,16}(申请|提升)|怎样[^。，；\n]{0,16}(申请|提升)|提升配额流程|配额流程/.test(
    text,
  )
}

/**
 * @param {string} text
 * @param {string[]} keywords
 */
/** 放开限制：配额/权限/售罄等。裸「带宽」不算，避免升降配被收进配额。 */
const QUOTA_LIMIT_ASK_RE = /配额|上限|售罄|轻载|灰度|8:1|8：1|IP数量|上架/

function matchesQuota(text, keywords) {
  if (isQuotaHowToConsult(text)) return false
  if (/解除[^。，；\n]{0,8}售罄|解售罄/.test(text)) return true
  if (/配额不足|配额已满|配额超限/.test(text)) return true
  if (/订购权限|开通权限|大带宽权限/.test(text) && !/如何|怎么|怎样/.test(text)) {
    return true
  }
  if (hasApplicationIntent(text) && QUOTA_LIMIT_ASK_RE.test(text)) {
    return true
  }
  if (hasConsultIntent(text) && /到期|有效期|进度|什么时间/.test(text)) return false
  const quotaKeywords = (keywords || []).filter(
    (kw) => kw !== '扩容带宽' && kw !== '带宽提升',
  )
  if (matchesAnyKeyword(text, quotaKeywords)) return true
  if (hasConsultIntent(text) && !OPERATION_FAILURE_RE.test(text)) return false
  return false
}

/**
 * @param {string} text
 * @param {string[]} keywords
 */
function matchesCreation(text, keywords) {
  if (CREATION_TIMEOUT_RE.test(text)) return true
  if (/无法订购|无法创建|无法申购/.test(text)) return true
  if (matchesKeyword(text, '订购失败') && !hasApplicationIntent(text)) return true
  return matchesAnyKeyword(
    text,
    keywords.filter((kw) => kw !== '订购失败'),
  )
}

/**
 * @param {string} text
 * @param {string[]} keywords
 */
function matchesConfig(text, keywords) {
  if (/不生效|配置了但|规则.*不生效/.test(text)) return true
  if (/解绑[^。，；\n]{0,16}(错误|失败|报错)/.test(text)) return true
  if (/绑定[^。，；\n]{0,16}(错误|失败|报错)/.test(text)) return true
  if (/修改带宽[^。，；\n]{0,16}报错|无法保存/.test(text)) return true
  if (hasConsultIntent(text) && !OPERATION_FAILURE_RE.test(text)) return false
  return matchesAnyKeyword(text, keywords)
}

/**
 * @param {string} text
 * @param {string[]} keywords
 */
function matchesUnsubscribe(text, keywords) {
  if (/请帮我退订|请帮忙释放|请帮忙退订|请帮我释放/.test(text)) return true
  if (/无法[^。，；\n]{0,12}退订/.test(text)) return true
  if (/退订[^。，；\n]{0,12}(报错|失败)/.test(text)) return true
  if (/释放[^。，；\n]{0,16}(失败|报错)|删除[^。，；\n]{0,16}(失败|报错)/.test(text)) {
    return true
  }
  if (hasConsultIntent(text) && !OPERATION_FAILURE_RE.test(text)) return false
  return matchesAnyKeyword(text, keywords)
}

function matchesConsult(text, keywords) {
  if (matchesAnyKeyword(text, keywords)) return true
  if (hasConsultIntent(text) && !OPERATION_FAILURE_RE.test(text)) return true
  if (/查一下|明细/.test(text) && /费用|账单/.test(text)) return true
  return false
}

/**
 * @param {string} text
 * @param {SharedTagRule} rule
 */
function matchesRule(text, rule) {
  const keywords = rule.keywords || []
  switch (rule.label) {
    case '可用性/连通性故障':
      return matchesAvailability(text, keywords)
    case '性能问题':
      return matchesPerformance(text, keywords)
    case '计费与账单':
      return matchesBilling(text, keywords)
    case '配额与权限申请':
      return matchesQuota(text, keywords)
    case '资源开通与创建':
      return matchesCreation(text, keywords)
    case '配置与操作':
      return matchesConfig(text, keywords)
    case '退订与释放':
      return matchesUnsubscribe(text, keywords)
    case '产品功能咨询':
      return matchesConsult(text, keywords)
    default:
      return matchesAnyKeyword(text, keywords)
  }
}

/**
 * 对端问题排除：网络可达 + 对端拒绝 → 产品功能咨询
 * @param {string} text
 */
export function isPeerSideExclusion(text) {
  const t = normalizeText(text)
  if (!t) return false
  return PEER_REACHABLE_RE.test(t) && PEER_REFUSAL_RE.test(t)
}

/**
 * @param {string} text
 */
function hasTechnicalKeywordHit(text) {
  return matchesAnyKeyword(text, TECH_KEYWORD_POOL)
}

/**
 * 仅含情绪表述、无决策树技术关键词
 * @param {string} text
 */
export function isPureEmotionOnly(text) {
  const t = normalizeText(text)
  if (!t) return true
  if (hasTechnicalKeywordHit(t)) return false
  return EMOTION_ONLY_HINT_RE.test(t)
}

/**
 * 按决策树优先级逐级匹配（复合问题取首个命中）
 * @param {string} text
 * @param {SharedTagRule[]} [rules]
 * @returns {string | null} 命中标签；无命中返回 null（由调用方决定是否归「其他」）
 */
export function matchProblemTypeByDecisionTree(text, rules = PROBLEM_TYPES_BUILTIN) {
  const t = normalizeText(text)
  if (!t) return null

  for (const rule of rules) {
    if (!rule.label || rule.label === PROBLEM_TYPE_OTHER) continue
    if (matchesRule(t, rule)) return rule.label
  }
  return null
}

/**
 * 问题类型决策树分类（对齐 data/问题类型自动化分类.md V2.0 §4）
 *
 * 按 PROBLEM_TYPES_BUILTIN 数组顺序逐级匹配；复合问题命中即停止。
 *
 * @param {string} text 工单痛点/打标语料
 * @param {SharedTagRule[]} [rules]
 * @returns {string}
 */
export function classifyProblemType(text, rules = PROBLEM_TYPES_BUILTIN) {
  const t = normalizeText(text)
  if (!t) return PROBLEM_TYPE_OTHER

  if (isPeerSideExclusion(t)) return PROBLEM_TYPE_CONSULT

  const matched = matchProblemTypeByDecisionTree(t, rules)
  if (matched) return matched

  if (isPureEmotionOnly(t)) return PROBLEM_TYPE_OTHER

  return PROBLEM_TYPE_OTHER
}
