import { isNegativeSentiment } from './sentiment.js'

/** @typedef {{ id: string; label: string; description?: string; keywords: string[] }} ThemeRule */

/** @type {ThemeRule[]} */
export const DEFAULT_THEME_RULES = [
  {
    id: 'login',
    label: '登录注册',
    description: '用户无法正常登录、注册、找回密码、验证码收不到、账号权限相关问题',
    keywords: ['登录', '注册', '密码', '验证码', '账号'],
  },
  {
    id: 'performance',
    label: '性能体验',
    description: '系统响应慢、页面卡顿、加载超时、操作延迟等性能类问题',
    keywords: ['慢', '卡', '加载', '延迟', '超时'],
  },
  {
    id: 'billing',
    label: '计费账单',
    description: '账单金额异常、扣费争议、退款、发票、套餐资费相关问题',
    keywords: ['计费', '账单', '扣费', '退款', '发票'],
  },
  {
    id: 'feature',
    label: '功能需求',
    description: '希望新增功能、现有功能不满足、产品能力缺失或改进建议',
    keywords: ['功能', '希望', '建议', '增加', '缺少'],
  },
  {
    id: 'support',
    label: '客服态度',
    description: '客服响应慢、服务态度、沟通体验、回访不及时等服务类问题',
    keywords: ['客服', '态度', '回复', '等待', '联系'],
  },
  {
    id: 'network',
    label: '网络连接',
    description: '网络波动、断网、连接不稳定、带宽异常等网络连通性问题',
    keywords: ['网络', '断网', '连接', '波动', '信号'],
  },
  {
    id: 'ui',
    label: '界面交互',
    description: '界面难用、找不到入口、操作流程复杂、交互设计不合理',
    keywords: ['界面', '操作', '按钮', '找不到', '难用'],
  },
  {
    id: 'data',
    label: '数据同步',
    description: '数据丢失、同步失败、备份恢复、报表数据不准确等问题',
    keywords: ['数据', '同步', '丢失', '备份', '导出'],
  },
  {
    id: 'cloud',
    label: '云主机/资源',
    description: '云主机 ECS、实例、资源池、虚拟机、弹性计算等资源类产品问题',
    keywords: ['云主机', 'ECS', '资源池', '实例', '弹性计算'],
  },
  {
    id: 'fault',
    label: '故障/不可用',
    description: '服务中断、宕机、故障无法复现、业务不可用等严重可用性问题',
    keywords: ['故障', '不可用', '中断', '宕机', '无法复现'],
  },
]

/** @deprecated use DEFAULT_THEME_RULES */
export const THEME_RULES = DEFAULT_THEME_RULES

import { textForKeywordExtraction, tokenizeForKeywords } from './keywordExtraction.js'
import { filterKeywordsWithLlm } from './keywordLlmFilter.js'
import { canUseSemanticMatch } from './themeSemantic.js'

export { isMeaninglessKeyword, textForKeywordExtraction, tokenizeForKeywords } from './keywordExtraction.js'
export {
  buildKeywordAnalysisContext,
  buildKeywordFilterPrompts,
  buildKeywordSampleLines,
  filterKeywordsWithLlm,
} from './keywordLlmFilter.js'

/**
 * 纯关键词匹配（最快）
 * @param {string} text
 * @param {ThemeRule[]} [rules]
 * @returns {string[]}
 */
export function matchThemes(text, rules = DEFAULT_THEME_RULES) {
  if (!text?.trim()) return ['未分类']
  const lower = text.toLowerCase()
  const matched = []
  for (const rule of rules) {
    if (!rule.label?.trim()) continue
    const keywords = rule.keywords?.filter(Boolean) || []
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      matched.push(rule.label)
    }
  }
  return matched.length > 0 ? matched : ['未分类']
}

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 */
export function aggregateThemes(feedbacks) {
  /** @type {Map<string, { label: string; count: number; negative: number; latest: string | null; ids: string[] }>} */
  const map = new Map()

  for (const fb of feedbacks) {
    const themeList = fb.themes?.length ? fb.themes : ['未分类']
    for (const label of themeList) {
      if (!map.has(label)) {
        map.set(label, { label, count: 0, negative: 0, latest: null, ids: [] })
      }
      const entry = map.get(label)
      entry.count += 1
      if (isNegativeSentiment(fb.sentiment)) entry.negative += 1
      entry.ids.push(fb.id)
      if (fb.createdAt && (!entry.latest || fb.createdAt > entry.latest)) {
        entry.latest = fb.createdAt
      }
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count)
}

/**
 * 本地规则统计候选高频词（不含 LLM）
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 * @param {number} limit
 */
export function collectTopKeywords(feedbacks, limit = 20) {
  /** @type {Map<string, number>} */
  const freq = new Map()

  for (const fb of feedbacks) {
    const tokens = tokenizeForKeywords(textForKeywordExtraction(fb))
    for (const t of tokens) {
      freq.set(t, (freq.get(t) || 0) + 1)
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }))
}

/** @deprecated 使用 topKeywordsAsync；同步版仅本地规则 */
export function topKeywords(feedbacks, limit = 20) {
  return collectTopKeywords(feedbacks, limit)
}

/**
 * 本地候选 + LLM 过滤无意义词（需 API Key）
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 * @param {import('./storage.js').AppSettings | null | undefined} settings
 * @param {number} [limit]
 */
export async function topKeywordsAsync(feedbacks, settings, limit = 24) {
  const candidateLimit = Math.max(limit * 3, 48)
  const candidates = collectTopKeywords(feedbacks, candidateLimit)
  if (!canUseSemanticMatch(settings)) {
    return candidates.slice(0, limit)
  }

  return filterKeywordsWithLlm(candidates, feedbacks, settings, limit)
}

/**
 * @param {string} keywordsText comma-separated
 * @returns {string[]}
 */
export function parseKeywords(keywordsText) {
  return keywordsText
    .split(/[,，;；\n]/)
    .map((k) => k.trim())
    .filter(Boolean)
}

/**
 * 迁移旧规则，补全 description
 * @param {ThemeRule[]} rules
 */
export function normalizeThemeRules(rules) {
  const defaults = Object.fromEntries(DEFAULT_THEME_RULES.map((r) => [r.id, r]))
  return rules.map((r) => ({
    ...r,
    description: r.description ?? defaults[r.id]?.description ?? '',
    keywords: r.keywords || [],
  }))
}
