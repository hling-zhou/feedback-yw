import { EMPTY_FILTER_TOKEN } from '../feedbackFilters.js'

/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

export const POST_USE_CHANNEL_LABELS = {
  sms: '短信',
  console: '控制台',
  option: '选项类',
  callback: '投诉回访',
}

export const POST_USE_RATING_BAND_OPTIONS = [
  { value: '10', label: '10 分' },
  { value: 'non10', label: '非 10 分' },
  { value: 'lt7', label: '低于 7 分' },
]

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
function parseRatingScore(raw) {
  if (raw == null || raw === '') return null
  const score = Number(raw)
  return Number.isFinite(score) ? score : null
}

/**
 * @param {{ channel?: string; sourceSubType?: string } | null | undefined} record
 */
export function getPostUseChannelKey(record) {
  const channel = String(record?.channel || '').trim()
  if (channel && POST_USE_CHANNEL_LABELS[channel]) return channel
  const subType = String(record?.sourceSubType || '').trim()
  if (subType === 'sms_survey') return 'sms'
  if (subType === 'web_survey') return 'console'
  if (subType === 'web_option') return 'option'
  return channel || subType || ''
}

/**
 * @param {{ channel?: string; sourceSubType?: string } | string | null | undefined} recordOrKey
 */
export function getPostUseChannelLabel(recordOrKey) {
  const key =
    recordOrKey && typeof recordOrKey === 'object'
      ? getPostUseChannelKey(recordOrKey)
      : String(recordOrKey || '').trim()
  return POST_USE_CHANNEL_LABELS[key] || key || '—'
}

/**
 * @param {FeedbackRecord[] | null | undefined} records
 */
export function listPostUseChannelFilterOptions(records) {
  /** @type {Set<string>} */
  const keys = new Set()
  for (const record of records || []) {
    const key = getPostUseChannelKey(record)
    if (key) keys.add(key)
  }
  return [...keys]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((value) => ({
      value,
      label: POST_USE_CHANNEL_LABELS[value] || value,
    }))
}

/**
 * @param {FeedbackRecord[] | null | undefined} records
 */
export function listPostUseRatingFilterOptions(records) {
  /** @type {Set<number>} */
  const scores = new Set()
  let hasEmpty = false
  for (const record of records || []) {
    const score = parseRatingScore(record?.ratingScore)
    if (score == null) hasEmpty = true
    else scores.add(score)
  }
  /** @type {{ label: string; value: string }[]} */
  const options = POST_USE_RATING_BAND_OPTIONS.map((item) => ({ ...item }))
  if (hasEmpty) options.push({ value: EMPTY_FILTER_TOKEN, label: '未评分' })
  for (const score of [...scores].sort((a, b) => b - a)) {
    if (score === 10) continue
    options.push({ value: String(score), label: `${score} 分` })
  }
  return options
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {string} [value]
 */
export function matchesPostUseRatingFilter(record, value = '') {
  const filter = String(value ?? '').trim()
  if (!filter) return true
  const score = parseRatingScore(record?.ratingScore)
  const hasScore = score != null
  if (filter === EMPTY_FILTER_TOKEN) return !hasScore
  if (filter === '10') return hasScore && score === 10
  if (filter === 'non10') return hasScore && score < 10
  if (filter === 'lt7') return hasScore && score < 7
  return hasScore && String(score) === filter
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {string} [value]
 */
export function matchesPostUseChannelFilter(record, value = '') {
  const filter = String(value ?? '').trim()
  if (!filter) return true
  return getPostUseChannelKey(record) === filter
}

/**
 * 按原文 / 意见字段做关键字模糊匹配（大小写不敏感子串）。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @param {string} [keyword]
 */
export function matchesCommentKeywordFilter(record, keyword = '') {
  const needle = String(keyword ?? '').trim().toLowerCase()
  if (!needle) return true
  const haystack = [record?.rawText, record?.commentText, record?.lowScoreReason]
    .map((part) => String(part ?? ''))
    .join('\n')
    .toLowerCase()
  return haystack.includes(needle)
}
