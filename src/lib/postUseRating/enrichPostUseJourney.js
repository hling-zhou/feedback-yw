/**
 * 用后即评非 10 分专用旅程补全（规则关键词，不走工单批量打标）
 */
import {
  isPostUseNon10LibraryRecord,
} from '../../domain/postUseRatingImport.js'

export const POST_USE_JOURNEY_UNKNOWN_L1 = '未识别环节'
export const POST_USE_JOURNEY_UNKNOWN_L2 = '未识别子环节'
export const POST_USE_JOURNEY_SOURCE = 'post_use_non10'

/**
 * 关键词 → 旅程（按优先级；先匹配先得）
 * @type {{ keywords: string[]; journeyL1: string; journeyL2: string }[]}
 */
export const POST_USE_JOURNEY_RULES = [
  { keywords: ['退订', '释放', '注销', '删除资源', '到期不续'], journeyL1: '退订', journeyL2: '退订/释放' },
  { keywords: ['开通', '创建', '申领', '配额申请', '无法开通'], journeyL1: '开通', journeyL2: '开通/创建' },
  { keywords: ['变更', '升降配', '扩容', '缩容', '改配', '带宽调整'], journeyL1: '变更', journeyL2: '变更/升降配' },
  { keywords: ['费用', '计费', '账单', '价格', '扣费', '收费', '贵'], journeyL1: '费用', journeyL2: '计费/价格' },
  { keywords: ['账号', '权限', '登录', '认证', '子用户', 'IAM'], journeyL1: '账号', journeyL2: '账号/权限' },
  { keywords: ['使用', '连通', '访问', '不通', '配置', '故障', '慢', '不稳定', '页面'], journeyL1: '使用', journeyL2: '使用/连通' },
]

/**
 * @param {{ rawText?: string; lowScoreReason?: string; commentText?: string } | null | undefined} record
 */
export function collectPostUseJourneyText(record) {
  return [record?.rawText, record?.lowScoreReason, record?.commentText]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * @param {string} text
 * @returns {{ journeyL1: string; journeyL2: string }}
 */
export function matchPostUseJourneyFromText(text) {
  const corpus = String(text || '')
  if (!corpus.trim()) {
    return { journeyL1: POST_USE_JOURNEY_UNKNOWN_L1, journeyL2: POST_USE_JOURNEY_UNKNOWN_L2 }
  }
  for (const rule of POST_USE_JOURNEY_RULES) {
    if (rule.keywords.some((kw) => corpus.includes(kw))) {
      return { journeyL1: rule.journeyL1, journeyL2: rule.journeyL2 }
    }
  }
  return { journeyL1: POST_USE_JOURNEY_UNKNOWN_L1, journeyL2: POST_USE_JOURNEY_UNKNOWN_L2 }
}

/**
 * 是否需要补旅程：library 非 10 分，且尚无有效旅程
 * @param {import('../types.js').FeedbackRecord | Record<string, unknown> | null | undefined} record
 */
export function needsPostUseJourney(record) {
  if (!isPostUseNon10LibraryRecord(record)) return false
  const l1 = String(record?.journeyL1 ?? '').trim()
  return !l1 || l1 === POST_USE_JOURNEY_UNKNOWN_L1
}

/**
 * @param {import('../types.js').FeedbackRecord | Record<string, unknown>} record
 * @returns {{ journeyL1: string; journeyL2: string; journeySource: typeof POST_USE_JOURNEY_SOURCE }}
 */
export function enrichPostUseJourneyRecord(record) {
  const matched = matchPostUseJourneyFromText(collectPostUseJourneyText(record))
  return {
    journeyL1: matched.journeyL1,
    journeyL2: matched.journeyL2,
    journeySource: POST_USE_JOURNEY_SOURCE,
  }
}

/**
 * @param {Array<import('../types.js').FeedbackRecord | Record<string, unknown>>} records
 * @returns {Array<{ id?: string; patch: ReturnType<typeof enrichPostUseJourneyRecord> }>}
 */
export function enrichPostUseJourneyBatch(records) {
  return (records || [])
    .filter((r) => needsPostUseJourney(r))
    .map((r) => ({
      id: /** @type {{ id?: string }} */ (r).id,
      patch: enrichPostUseJourneyRecord(r),
    }))
}
