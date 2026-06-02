import {
  cleanCustomerRequestPhrase,
  isCustomerDemandLike,
  isFormattedTemplateContent,
} from '../ticketAnalysis/customerRequestFilters.js'

/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

const CLUSTER_PAIN_MIN_LEN = 4
const CLUSTER_PAIN_PLACEHOLDER_RE =
  /^(?:无|暂无|未知|未识别|未提供|待补充|待完善|不涉及|n\/a|na|—|-+|\.+)$/i

/** 业务背景叙述（非痛点/诉求） */
const BACKGROUND_CONTEXT_LEAD_RE =
  /^(?:由于|因为|鉴于|我(?:司|单位|公司|方)|本(?:司|单位|公司)|近期|目前|原来|之前|首先)/

const INCOMPLETE_TAIL_RE = /(?:-{2,}|\*{2,}|…|\.\.\.)$/

const DEMAND_CLAUSE_HINT_RE =
  /(?:无法|不能|缺少|不足|不明确|不支持|报错|失败|异常|不通|卡顿|延迟|慢|扩容|配额|限制|希望|需要|咨询|申请|怎么|如何|为什么|提升|升级|订购|退订|解售罄|配置|性能|OOM|带宽|内存|CPU|渲染任务|渲染失败|渲染超时)/

const BACKGROUND_NARRATIVE_RE =
  /承接(?:了|大量)|智能剪辑|游戏画面|渲染处理业|业务量|近期承接/

const CLAUSE_SPLIT_RE = /[，,。；;\n]+/

/**
 * @param {string | undefined | null} text
 */
export function isUsableClusteringPainText(text) {
  const t = (text || '').trim()
  if (!t || t.length < CLUSTER_PAIN_MIN_LEN) return false
  if (CLUSTER_PAIN_PLACEHOLDER_RE.test(t)) return false
  if (isFormattedTemplateContent(t)) return false
  return true
}

/** 洞察摘要/聚类 label 是否仍含工单元数据字段 */
export function looksLikeTicketMetadataSummary(text) {
  const t = (text || '').trim()
  if (!t) return false
  if (isFormattedTemplateContent(t)) return true
  return /请求节点[：:]|工单标题[：:]|详细内容[：:]/.test(t)
}

/**
 * 是否为业务背景叙述（非可执行痛点/诉求）
 * @param {string | undefined | null} text
 */
export function isBackgroundContextText(text) {
  const t = (text || '').trim()
  if (!t) return false
  if (!BACKGROUND_CONTEXT_LEAD_RE.test(t)) return false

  const hasProblemSignal =
    /(?:无法|不能|缺少|不足|需要|希望|申请|咨询|报错|失败|异常|OOM|扩容|升级|提升|卡顿|延迟|慢|限制|保障)/.test(t)
  if (BACKGROUND_NARRATIVE_RE.test(t) && !hasProblemSignal) return true

  const firstClause = t.split(CLAUSE_SPLIT_RE)[0]?.trim() || t
  if (DEMAND_CLAUSE_HINT_RE.test(firstClause) && !BACKGROUND_NARRATIVE_RE.test(firstClause)) {
    return false
  }
  if (isCustomerDemandLike(firstClause) && !BACKGROUND_NARRATIVE_RE.test(firstClause)) return false
  return !hasProblemSignal
}

/**
 * @param {string} clause
 */
function scoreDemandClause(clause) {
  let score = 0
  if (BACKGROUND_CONTEXT_LEAD_RE.test(clause)) score -= 3
  if (/承接了|业务量|智能剪辑|渲染处理/.test(clause) && !DEMAND_CLAUSE_HINT_RE.test(clause)) {
    score -= 2
  }
  if (DEMAND_CLAUSE_HINT_RE.test(clause)) score += 3
  if (isCustomerDemandLike(clause)) score += 2
  if (clause.length > 60) score -= 1
  if (clause.length > 100) score -= 2
  if (INCOMPLETE_TAIL_RE.test(clause)) score -= 5
  return score
}

/**
 * 从长文本中提取最像诉求/痛点的分句（跳过业务背景铺垫）
 * @param {string | undefined | null} text
 */
export function extractDemandClause(text) {
  const t = cleanCustomerRequestPhrase((text || '').trim())
  if (!t) return ''
  const clauses = t.split(CLAUSE_SPLIT_RE).map((c) => c.trim()).filter((c) => c.length >= 4)
  if (!clauses.length) return t.replace(INCOMPLETE_TAIL_RE, '').trim()

  let best = clauses[0]
  let bestScore = scoreDemandClause(best)
  for (let i = 1; i < clauses.length; i += 1) {
    const score = scoreDemandClause(clauses[i])
    if (score > bestScore) {
      best = clauses[i]
      bestScore = score
    }
  }
  if (bestScore < 0) return ''
  return best.replace(INCOMPLETE_TAIL_RE, '').trim()
}

/**
 * @param {string | undefined | null} text
 */
function refineInsightPainText(text) {
  let t = cleanCustomerRequestPhrase((text || '').trim())
  if (!t) return ''

  t = normalizeClusteringPainText(t) || t
  if (isBackgroundContextText(t) || t.length > 80 || t.includes('，')) {
    const extracted = extractDemandClause(t)
    if (extracted) t = extracted
    else if (isBackgroundContextText(t)) return ''
  }
  t = t.replace(INCOMPLETE_TAIL_RE, '').trim()
  if (!t || isBackgroundContextText(t)) return ''
  if (!isUsableClusteringPainText(t) && !DEMAND_CLAUSE_HINT_RE.test(t)) return ''
  return t
}

/**
 * 洞察摘要语料：仅用需求痛点挖掘（painPoint），必要时 fallback problemSummary；不用 customerRequest 原文
 * @param {FeedbackRecord} record
 */
export function getInsightPainText(record) {
  const fromPain = refineInsightPainText(record?.painPoint)
  if (fromPain) return fromPain
  return refineInsightPainText(record?.problemSummary)
}

/**
 * 为洞察摘要选取群组代表痛点：优先高频、可执行痛点，避免单条背景叙述
 * @param {FeedbackRecord[]} records
 */
export function pickInsightRepresentativePain(records) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const r of records) {
    const pain = getInsightPainText(r)
    if (!pain) continue
    map.set(pain, (map.get(pain) || 0) + 1)
  }
  if (!map.size) return ''

  let best = ''
  let bestCount = 0
  let bestScore = -999
  for (const [text, count] of map) {
    const score = count * 10 + scoreDemandClause(text)
    if (count > bestCount || (count === bestCount && score > bestScore)) {
      best = text
      bestCount = count
      bestScore = score
    }
  }
  return best
}

/** 洞察摘要是否像单条工单背景叙述（需重算） */
export function looksLikeBackgroundInsightSummary(text) {
  const t = (text || '').trim()
  if (!t) return false
  if (looksLikeTicketMetadataSummary(t)) return true
  const core = t.replace(/（\d+ 条工单[^）]*）$/, '').trim()
  return isBackgroundContextText(core) || INCOMPLETE_TAIL_RE.test(core)
}

/**
 * 清洗聚类/展示用语料：剥离请求节点、工单标题等模板字段，保留客户诉求正文
 * @param {string | undefined | null} text
 */
export function normalizeClusteringPainText(text) {
  let t = (text || '').trim()
  if (!t) return ''

  const detail = t.match(/详细内容[：:]\s*([\s\S]{4,240})/)
  if (detail?.[1]?.trim()) {
    t = detail[1]
      .trim()
      .replace(/【[^】]*$/g, '')
      .replace(/-{2,}$/g, '')
      .trim()
  } else {
    const about = t.match(/关于([^，,。；;\n]{4,120})/)
    if (about?.[1]?.trim()) {
      t = `关于${about[1].trim()}`
    } else if (isFormattedTemplateContent(t)) {
      return ''
    }
  }

  t = t
    .replace(/^请求节点[：:][^关于详细内容]*/i, '')
    .replace(/工单标题[：:][^\n]*/gi, '')
    .replace(/^详细内容[：:]\s*/i, '')
    .replace(/--+/g, ' ')
    .trim()

  t = cleanCustomerRequestPhrase(t)
  if (!t || isFormattedTemplateContent(t)) return ''
  if (!isUsableClusteringPainText(t)) return ''
  return t
}

/**
 * 从清洗后的痛点提取行动建议用的主题短语（不引用工单元数据）
 * @param {string} pain
 * @param {number} [maxLen]
 */
export function extractClusterPainTheme(pain, maxLen = 28) {
  let t = getInsightPainText({ painPoint: pain }) || normalizeClusteringPainText(pain) || (pain || '').trim()
  if (!t) return '该类体验问题'

  t = extractDemandClause(t) || t

  t = t.replace(/^关于/, '').trim()
  t = t.split(/[。；\n]/)[0]?.trim() || t
  t = t.replace(/^(?:客户|用户)(?:反馈|咨询|表示|希望|需要)/, '').trim()
  t = t.replace(/^[：:，,\s]+/, '').trim()

  if (!t || t.length < 4) return '该类体验问题'
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen - 1)}…`
}

/**
 * 聚类语料：优先 painPoint，不足时 fallback customerRequest，再 problemSummary（P1-4）
 * @param {FeedbackRecord} record
 */
export function getClusteringPainText(record) {
  const pain = normalizeClusteringPainText(record?.painPoint)
  if (pain) return pain

  const request = normalizeClusteringPainText(record?.customerRequest)
  if (request) return request

  const summary = normalizeClusteringPainText(record?.problemSummary)
  if (summary) return summary

  return ''
}
