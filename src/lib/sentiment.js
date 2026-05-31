/** @typedef {'positive' | 'neutral_inquiry' | 'neutral_pending' | 'mild_negative' | 'negative' | 'strong_negative'} MainSentiment */
/** @typedef {MainSentiment | 'urgent'} Sentiment */
/** @typedef {'none' | 'high'} UrgencyLevel */

const POSITIVE = [
  '满意', '感谢', '好用', '流畅', '推荐', '优秀', '不错', '解决了', '很好', '赞',
  'good', 'great', 'love', 'excellent', 'thanks', 'helpful', 'resolved',
]

const STRONG_NEGATIVE = [
  '强烈不满', '非常不满', '太差', '极差', '愤怒', '气愤', '垃圾', '烂透了', '忍无可忍',
  '投诉到底', '要赔偿', '太差劲', '极其不满',
]

/** 明确不满/失望（纯技术词见 COMPLAINT_CONTEXT / MILD_NEGATIVE） */
const NEGATIVE = [
  '投诉', '不满', '差', '慢', '卡', '崩溃', '错误', 'bug',
  '退款', '生气', '失望', '难用', '断网', '超时', '未解决', '中断', '丢包',
  'bad', 'slow', 'broken', 'crash', 'fail', 'error', 'terrible', 'awful', 'frustrated',
]

const URGENT = [
  '着急', '焦急', '催', '催办', '加急', '尽快', '马上', '影响业务', '业务中断',
  '等了很久', '一直等', '还没处理', '什么时候能', '紧急',
]

const MILD_NEGATIVE = [
  '异常', '不正常', '有问题', '不好用', '不稳定', '偶发', '有时', '帮忙看下', '协助排查',
]

const NEUTRAL_INQUIRY = [
  '咨询', '请问', '如何', '怎么', '是否支持', '能否', '想了解', '问一下', '什么情况下',
  '规则', '说明', '计费方式', '有什么区别',
]

const NEUTRAL_PENDING = [
  '观察', '持续关注', '待确认', '待观察', '后续', '跟进', '请客户观察', '再观察',
  '暂时', '先这样', '后续再',
]

const COMPLAINT_CONTEXT = /故障|无法|失败|异常|不可用|不通|绑定失败|退订/

const LEGACY_MAP = {
  positive: 'positive',
  neutral: 'neutral_inquiry',
  negative: 'negative',
  urgent: 'negative',
}

/**
 * @param {string | undefined} sentiment
 * @returns {MainSentiment}
 */
export function normalizeSentiment(sentiment) {
  if (!sentiment) return 'neutral_inquiry'
  if (sentiment in LEGACY_MAP) return /** @type {MainSentiment} */ (LEGACY_MAP[sentiment])
  if (sentiment in SENTIMENT_LABELS) return /** @type {MainSentiment} */ (sentiment)
  return 'neutral_inquiry'
}

/**
 * @param {string | UrgencyLevel | undefined} urgencyLevel
 * @param {string | undefined} [legacySentiment] - 旧数据 sentiment=urgent 时视为加急
 * @returns {UrgencyLevel}
 */
export function normalizeUrgencyLevel(urgencyLevel, legacySentiment) {
  if (urgencyLevel === 'high' || legacySentiment === 'urgent') return 'high'
  return 'none'
}

/**
 * @param {{ sentiment?: string; urgencyLevel?: UrgencyLevel | string }} [record]
 * @returns {UrgencyLevel}
 */
export function getUrgencyLevel(record) {
  return normalizeUrgencyLevel(record?.urgencyLevel, record?.sentiment)
}

/**
 * @param {string | undefined} sentiment
 */
export function isNegativeSentiment(sentiment) {
  const s = normalizeSentiment(sentiment)
  return s === 'mild_negative' || s === 'negative' || s === 'strong_negative'
}

/**
 * @param {string} text
 * @returns {UrgencyLevel}
 */
export function analyzeUrgencyLevel(text) {
  if (!text?.trim()) return 'none'
  const lower = text.toLowerCase()
  for (const w of URGENT) {
    if (lower.includes(w.toLowerCase())) return 'high'
  }
  return 'none'
}

/**
 * @param {string} text
 * @returns {MainSentiment}
 */
function analyzeMainSentiment(text) {
  if (!text?.trim()) return 'neutral_inquiry'

  const lower = text.toLowerCase()
  /** @type {Record<string, number>} */
  const scores = {
    positive: 0,
    strong_negative: 0,
    negative: 0,
    mild_negative: 0,
    neutral_inquiry: 0,
    neutral_pending: 0,
  }

  const bump = (key, words) => {
    for (const w of words) {
      if (lower.includes(w.toLowerCase())) scores[key] += 1
    }
  }

  bump('positive', POSITIVE)
  bump('strong_negative', STRONG_NEGATIVE)
  bump('negative', NEGATIVE)
  bump('mild_negative', MILD_NEGATIVE)
  bump('neutral_inquiry', NEUTRAL_INQUIRY)
  bump('neutral_pending', NEUTRAL_PENDING)

  if (
    scores.positive >= 2 &&
    scores.strong_negative === 0 &&
    scores.positive > scores.negative + scores.mild_negative
  ) {
    return 'positive'
  }

  const ranked = [
    ['strong_negative', scores.strong_negative],
    ['negative', scores.negative],
    ['mild_negative', scores.mild_negative],
    ['neutral_pending', scores.neutral_pending],
    ['neutral_inquiry', scores.neutral_inquiry],
  ].sort((a, b) => b[1] - a[1])

  const [topKey, topScore] = ranked[0]
  if (topScore > 0) return /** @type {MainSentiment} */ (topKey)

  if (COMPLAINT_CONTEXT.test(text)) return 'mild_negative'
  return 'neutral_inquiry'
}

/**
 * @param {string} text
 * @returns {{ sentiment: MainSentiment; urgencyLevel: UrgencyLevel }}
 */
export function analyzeTicketSentiment(text) {
  return {
    sentiment: analyzeMainSentiment(text),
    urgencyLevel: analyzeUrgencyLevel(text),
  }
}

/**
 * @param {string} text
 * @returns {MainSentiment}
 */
export function analyzeSentiment(text) {
  return analyzeTicketSentiment(text).sentiment
}

export const SENTIMENT_LABELS = {
  positive: '正面',
  neutral_inquiry: '中性·咨询',
  neutral_pending: '中性·待跟进',
  mild_negative: '轻度不满',
  negative: '不满',
  strong_negative: '强烈不满',
}

export const URGENCY_LABELS = {
  none: '',
  high: '加急',
}

/** 工单详情 hover 用语义说明（非 taxonomy 配置项） */
export const SENTIMENT_DESCRIPTIONS = {
  positive:
    '用户表达满意、感谢或问题已解决，整体情绪积极，无明确不满或催促。',
  neutral_inquiry:
    '以咨询、了解规则或能力为主，尚未表现出明显不满，也非单纯等待处理结果。',
  neutral_pending:
    '处理尚未定论，建议观察、跟进或待确认；语气平和，未强烈施压。',
  mild_negative:
    '对异常或体验有疑虑、协助排查，不满程度较轻，未上升到投诉或强烈指责。',
  negative:
    '明确表达不满、失望或投诉倾向，认为产品/服务未达预期或问题未解决。',
  strong_negative:
    '情绪激烈，强烈指责、威胁投诉或赔偿，不满程度显著高于一般负面反馈。',
}

export const URGENCY_DESCRIPTION =
  '强调时效与业务影响、催促加急处理；与主情绪独立标注，可叠加在任意情绪之上。'

export const SENTIMENT_COLORS = {
  positive: 'bg-accent-500/15 text-accent-500 border-accent-500/30',
  neutral_inquiry: 'bg-slate-100 text-slate-600 border-slate-200',
  neutral_pending: 'bg-amber-50 text-amber-700 border-amber-200',
  mild_negative: 'bg-orange-50 text-orange-700 border-orange-200',
  negative: 'bg-red-50 text-red-600 border-red-200',
  strong_negative: 'bg-red-100 text-red-700 border-red-300',
}

export const URGENCY_TAG_COLOR = 'magenta'

/** 图表用色（与标签语义一致） */
export const SENTIMENT_CHART_COLORS = {
  positive: '#10B981',
  neutral_inquiry: '#94A3B8',
  neutral_pending: '#F59E0B',
  mild_negative: '#FB923C',
  negative: '#EF4444',
  strong_negative: '#DC2626',
}

/** 统计展示顺序：负面优先 */
export const SENTIMENT_ORDER = [
  'strong_negative',
  'negative',
  'mild_negative',
  'neutral_inquiry',
  'neutral_pending',
  'positive',
]

/** @type {Record<MainSentiment, string>} */
export const SENTIMENT_DISPLAY_LABELS = {
  positive: '正面',
  neutral_inquiry: '平稳',
  neutral_pending: '平稳',
  mild_negative: '轻度不满',
  negative: '不满',
  strong_negative: '强烈不满',
}

/**
 * 工单详情展示用语（文档示例：焦急/平稳）
 * @param {{ sentiment?: string; urgencyLevel?: string }} [record]
 */
export function getSentimentDisplayLabel(record) {
  if (getUrgencyLevel(record) === 'high') return '焦急'
  const key = normalizeSentiment(record?.sentiment)
  if (key === 'positive') return SENTIMENT_DISPLAY_LABELS.positive
  if (key === 'mild_negative' || key === 'negative' || key === 'strong_negative') {
    return SENTIMENT_LABELS[key]
  }
  return SENTIMENT_DISPLAY_LABELS[key] || SENTIMENT_LABELS[key] || '平稳'
}

/** @type {Record<MainSentiment, string>} */
export const SENTIMENT_TAG_COLORS = {
  positive: 'success',
  neutral_inquiry: 'default',
  neutral_pending: 'gold',
  mild_negative: 'orange',
  negative: 'error',
  strong_negative: 'red',
}
