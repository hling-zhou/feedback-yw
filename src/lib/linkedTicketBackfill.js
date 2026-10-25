/**
 * 关联反馈按需补拉（举措抽屉全量口径）：
 * 举措的关联工单号里，洞察周期缓存（feedbackByTicketId）没有的部分，
 * 打开举措抽屉时按工单号从服务端全量补拉，用于补全抽屉内
 * 问题范围聚合 / 关联反馈列表 / 点开工单链路（不受洞察周期窗口截断）。
 *
 * 洞察周期缓存仅含 complaint_ticket + consultation_ticket 两类（与 InsightsContext
 * 的 dataSourceTypes 口径一致），故补拉也只查这两类，复用既有
 * POST /api/storage/records/by-ticket-ids（服务端零改动）。
 */

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/** 抽屉关联反馈可补拉的数据源类型（与 InsightsContext feedbacks 口径一致） */
export const LINKED_FEEDBACK_SOURCE_TYPES = ['complaint_ticket', 'consultation_ticket']

/**
 * @param {string[] | undefined} ticketIds
 * @returns {string[]} trim + 去重后的非空工单号
 */
export function normalizeTicketIds(ticketIds) {
  const seen = new Set()
  const out = []
  for (const raw of ticketIds || []) {
    const ticketId = String(raw ?? '').trim()
    if (!ticketId || seen.has(ticketId)) continue
    seen.add(ticketId)
    out.push(ticketId)
  }
  return out
}

/**
 * 计算工单索引中尚不存在的关联工单号（trim + 去重）。
 * @param {Map<string, FeedbackRecord> | null | undefined} feedbackByTicketId
 * @param {string[] | undefined} linkedTicketIds
 * @returns {string[]}
 */
export function collectMissingTicketIds(feedbackByTicketId, linkedTicketIds) {
  return normalizeTicketIds(linkedTicketIds).filter(
    (ticketId) => !feedbackByTicketId?.has(ticketId),
  )
}

/**
 * 按数据源类型（投诉 + 咨询）并行补拉指定工单号的记录，按工单号合并去重（先到先得）。
 * @param {string[] | undefined} ticketIds
 * @param {{ listRecordsByTicketIds: (dataSourceType: string, ticketIds: string[]) => Promise<FeedbackRecord[]> }} adapter
 * @returns {Promise<FeedbackRecord[]>}
 */
export async function fetchFeedbackRecordsByTicketIds(ticketIds, adapter) {
  const ids = normalizeTicketIds(ticketIds)
  if (!ids.length || !adapter) return []
  const batches = await Promise.all(
    LINKED_FEEDBACK_SOURCE_TYPES.map((dataSourceType) =>
      adapter.listRecordsByTicketIds(dataSourceType, ids),
    ),
  )
  /** @type {Map<string, FeedbackRecord>} */
  const byTicketId = new Map()
  for (const records of batches) {
    for (const record of records || []) {
      const ticketId = String(record?.ticketId ?? '').trim()
      if (ticketId && !byTicketId.has(ticketId)) byTicketId.set(ticketId, record)
    }
  }
  return [...byTicketId.values()]
}

/**
 * 把补拉记录合并进工单索引，返回新 Map（基础索引已有工单优先，补拉只填空）。
 * 补拉为空时返回原索引引用（保持下游 useMemo 引用稳定）。
 * @param {Map<string, FeedbackRecord>} baseByTicketId
 * @param {Map<string, FeedbackRecord>} backfillByTicketId
 * @returns {Map<string, FeedbackRecord>}
 */
export function mergeFeedbackIndexMaps(baseByTicketId, backfillByTicketId) {
  if (!backfillByTicketId?.size) return baseByTicketId
  const merged = new Map(baseByTicketId)
  for (const [ticketId, record] of backfillByTicketId) {
    if (!merged.has(ticketId)) merged.set(ticketId, record)
  }
  return merged
}
