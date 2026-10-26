/**
 * 用后即评旅程范围判断。不看评分，只认反馈库里的用后即评记录。
 * 产品是否开启用后即评分析由调用方用目录过滤。
 * 写入不再使用下面的六组通用关键词，改由产品旅程模板 + 门闸完成。
 */
import {
  isPostUseRatingLibraryRecord,
} from '../../domain/postUseRatingImport.js'
import { recordHasUnknownJourney } from '../journeySemantic.js'
import { resolveJourneyLlmSkipScoreThreshold } from '../journeyMatchConfidence.js'
import { getManualTagFields } from '../manualTagFields.js'

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
 * 旧的六组关键词已经写出具体环节。未识别的不算，人工改过的不算。
 * @param {import('../types.js').FeedbackRecord | Record<string, unknown> | null | undefined} record
 */
export function isLegacyPostUseKeywordJourney(record) {
  if (!isPostUseRatingLibraryRecord(record)) return false
  if (getManualTagFields(record).includes('journey')) return false
  if (record?.journeySource !== POST_USE_JOURNEY_SOURCE) return false
  return !recordHasUnknownJourney(record)
}

/**
 * 待补构成分类（计数接口 breakdown 与 needsPostUseJourney 共用同一口径）。
 * - 'auto'：自动待补——旅程为空/未识别且未经模型定论，或规则分未过门闸
 * - 'llm_unknown'：模型已判「未识别环节」，默认不再自动重试，仅显式勾选重试
 * - 'legacy'：旧关键词写出的具体环节，仅显式勾选时按产品模板重打
 * - 'none'：不需要补旅程
 * @param {import('../types.js').FeedbackRecord | Record<string, unknown> | null | undefined} record
 * @param {import('../storage.js').AppSettings} [settings]
 * @returns {'auto' | 'llm_unknown' | 'legacy' | 'none'}
 */
export function classifyPostUseJourney(record, settings) {
  if (!isPostUseRatingLibraryRecord(record)) return 'none'
  if (getManualTagFields(record).includes('journey')) return 'none'
  const unknown = recordHasUnknownJourney(record)
  if (record?.journeySource === 'llm') {
    // 模型已给出定论：具体环节不再打；仍是「未识别环节」的默认不重试，
    // 否则会永远留在待补计数里、每次补全重跑同一批 LLM（数字永不清零）。
    return unknown ? 'llm_unknown' : 'none'
  }
  if (unknown) return 'auto'
  if (record?.journeySource === 'rule') {
    const score = Number(record?.journeyMatchScore)
    if (!Number.isFinite(score)) return 'none'
    return score < resolveJourneyLlmSkipScoreThreshold(settings) ? 'auto' : 'none'
  }
  if (isLegacyPostUseKeywordJourney(record)) return 'legacy'
  return 'none'
}

/**
 * 是否还要补旅程：反馈库用后即评（不含回访），且旅程为空、未识别，或规则分未过门闸。不看评分。
 * 口径 = classifyPostUseJourney：模型已判「未识别环节」的默认不再重试（避免计数死循环），
 * 仅 options.retryLlmUnknownJourneys 显式要求时才重试；旧关键词旅程仅显式勾选时重打。
 * 人工改过的旅程不覆盖。
 * @param {import('../types.js').FeedbackRecord | Record<string, unknown> | null | undefined} record
 * @param {import('../storage.js').AppSettings} [settings]
 * @param {{ includeLegacyKeywordJourneys?: boolean, retryLlmUnknownJourneys?: boolean }} [options]
 */
export function needsPostUseJourney(record, settings, options = {}) {
  const cls = classifyPostUseJourney(record, settings)
  if (cls === 'auto') return true
  if (cls === 'llm_unknown') return options.retryLlmUnknownJourneys === true
  if (cls === 'legacy') return options.includeLegacyKeywordJourneys === true
  return false
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
