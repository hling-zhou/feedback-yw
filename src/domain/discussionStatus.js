/**
 * 讨论状态（优化建议·人工复核区标记，2026-11-25 拍板）：
 * 三态单向枚举 —— 未标记('') → 待讨论('pending') → 已讨论('done')，全程不可逆（max 闩锁合并）。
 *
 * 语义与「纳入听音」(listeningReviewed, OR 闩锁) 同构的复核标记：
 * - 全局共享：一个用户标记，所有人可见（非个人态）
 * - 单向推进：落库即锁，保存后不可回退（误勾出路 = 推进到终态，与听音同信任水平）
 * - 再导入 / 重打标保留（preserveUserEditedTicketFields / reprocessFeedbackRecord）
 */

/** @typedef {'' | 'pending' | 'done'} DiscussionStatus */

/** 全部合法讨论状态（含未标记空串） */
export const DISCUSSION_STATUSES = /** @type {const} */ (['', 'pending', 'done'])

/** 单向档位（max 闩锁合并依据）：未标记 0 < 待讨论 1 < 已讨论 2 */
const DISCUSSION_STATUS_RANK = /** @type {Record<string, number>} */ ({
  '': 0,
  pending: 1,
  done: 2,
})

/**
 * 归一任意输入为合法讨论状态；undefined / 非法值 → ''（未标记，老数据兼容）。
 * @param {unknown} raw
 * @returns {DiscussionStatus}
 */
export function normalizeDiscussionStatus(raw) {
  const value = String(raw ?? '').trim()
  return /** @type {DiscussionStatus} */ (
    DISCUSSION_STATUS_RANK[value] != null ? value : ''
  )
}

/**
 * 闩锁合并（写入链唯一合并语义）：取「更深」状态，单向不可回退。
 * updateFeedback / ticketImportMerge 共用——任何写路径都不允许把已落库的深度清掉。
 * @param {unknown} existing 已落库状态
 * @param {unknown} incoming 本次写入状态
 * @returns {DiscussionStatus}
 */
export function mergeDiscussionStatus(existing, incoming) {
  const a = normalizeDiscussionStatus(existing)
  const b = normalizeDiscussionStatus(incoming)
  return /** @type {DiscussionStatus} */ (
    DISCUSSION_STATUS_RANK[a] >= DISCUSSION_STATUS_RANK[b] ? a : b
  )
}

/** 展示标签（Tag/筛选选项/列表列共用单源） */
export const DISCUSSION_STATUS_LABELS = /** @type {Record<DiscussionStatus, string>} */ ({
  '': '未标记',
  pending: '待讨论',
  done: '已讨论',
})

/** @typedef {'' | 'none' | 'pending' | 'done'} DiscussionStatusFilterValue */

/**
 * 筛选值归一（URL param 值与存储值同源：none/pending/done）。
 * 筛选四态：''（全部）/ 'none'（未标记）/ 'pending' / 'done'。
 * @param {unknown} raw @returns {DiscussionStatusFilterValue}
 */
export function normalizeDiscussionStatusFilter(raw) {
  const value = String(raw ?? '').trim()
  if (value === 'none' || value === 'pending' || value === 'done') {
    return /** @type {DiscussionStatusFilterValue} */ (value)
  }
  return ''
}

/**
 * 记录是否匹配讨论状态筛选。
 * @param {{ discussionStatus?: unknown }} [record]
 * @param {DiscussionStatusFilterValue} filter
 */
export function matchesDiscussionStatusFilter(record, filter = '') {
  if (!filter) return true
  const status = normalizeDiscussionStatus(record?.discussionStatus)
  if (filter === 'none') return status === ''
  return status === filter
}
