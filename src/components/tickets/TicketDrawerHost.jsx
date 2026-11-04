import { useCallback, useMemo, useState } from 'react'
import { App } from 'antd'
import FeedbackDrawer from '../FeedbackDrawer.jsx'
import { useInsights } from '../../context/InsightsContext.jsx'
import { useFeedbackDrawerSelection } from '../../hooks/useFeedbackDrawerSelection.js'
import { fetchFeedbackRecordsByTicketIds } from '../../lib/linkedTicketBackfill.js'
import { getApiStorageAdapter } from '../../storage/apiStorageAdapter.js'

/** @typedef {import('../../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {{ recordId?: string, recordDataSource?: string, ticketId?: string }} OpenRecordLink */
/** @typedef {(openRecord: (link: OpenRecordLink) => void, openRecordByPair: (recordId: string, dataSourceType?: string) => void) => import('react').ReactNode} TicketDrawerHostRenderTab */

/**
 * 工单详情抽屉宿主容器——「抽屉内点工单 → 叠加工单详情抽屉」的唯一正确实现
 * （2026-11-04 单源化：留观/举一反三两容器 ~90 行逐字重复后收敛）。
 *
 * 叠加语义约定（用户拍板）：工单详情抽屉（FeedbackDrawer zIndex 1010）盖在宿主抽屉
 * 之上，关闭后宿主必须仍在——本容器只做 setSelectedDirect，绝不触碰宿主 open 状态。
 *
 * 查找顺序（三级）：洞察周期缓存（投诉/咨询按 ticketId）→ 按 recordId 匹配
 * （评价类 / 周期窗口外工单的兜底）→ 按 ticketId 服务端补拉（投诉/咨询）。
 * 均未命中时 message.warning 提示。
 *
 * @param {Object} props
 * @param {import('react').ReactNode | TicketDrawerHostRenderTab} props.children - 业务 Tab 本体；传函数时注入 openRecord / openRecordByPair 两个签名适配器
 * @param {string} [props.missingHint] - 三级查找均未命中时的提示文案（默认通用文案）
 */
export default function TicketDrawerHost({ children, missingHint }) {
  const { feedbacks } = useInsights()
  const { message } = App.useApp()
  const {
    selected: selectedFeedback,
    setSelectedDirect,
    requestCloseDrawer,
    closeDrawer,
    onDrawerDirtyChange,
  } = useFeedbackDrawerSelection()
  /** @type {[Map<string, FeedbackRecord>, import('react').Dispatch<import('react').SetStateAction<Map<string, FeedbackRecord>>>]} */
  const [backfill, setBackfill] = useState(() => new Map())

  // 周期缓存索引：工单号 → 记录（仅投诉/咨询有 ticketId）
  const feedbackByTicketId = useMemo(() => {
    /** @type {Map<string, FeedbackRecord>} */
    const map = new Map()
    for (const record of feedbacks || []) {
      const ticketId = record?.ticketId?.trim()
      if (ticketId && !map.has(ticketId)) map.set(ticketId, record)
    }
    return map
  }, [feedbacks])

  // recordId → 记录（评价类与工单类通吃，含周期窗口外）
  const feedbackById = useMemo(() => {
    /** @type {Map<string, FeedbackRecord>} */
    const map = new Map()
    for (const record of feedbacks || []) {
      if (record?.id && !map.has(record.id)) map.set(record.id, record)
    }
    return map
  }, [feedbacks])

  /**
   * 统一入口（叠加语义）。兼容两种签名：详情抽屉传 link 对象；MatchQueue 传 (recordId, dataSourceType)。
   * @type {(linkOrRecordId: OpenRecordLink | string | null | undefined, dataSourceType?: string) => Promise<void>}
   */
  const openRecord = useCallback(
    async (linkOrRecordId, dataSourceType) => {
      const link = typeof linkOrRecordId === 'string'
        ? { recordId: linkOrRecordId, recordDataSource: dataSourceType }
        : (linkOrRecordId || {})
      const ticketId = String(link.ticketId || '').trim()
      // ① 周期缓存 / 补拉缓存里已有该工单 → 直接开
      if (ticketId) {
        const cached = feedbackByTicketId.get(ticketId) || backfill.get(ticketId)
        if (cached) {
          setSelectedDirect(cached)
          return
        }
      }
      // ② 按 recordId 匹配（评价类无 ticketId；工单被周期窗口截断时也走这）
      const recordId = String(link.recordId || '').trim()
      if (recordId && feedbackById.has(recordId)) {
        setSelectedDirect(feedbackById.get(recordId))
        return
      }
      // ③ 工单号服务端兜底补拉（投诉/咨询）
      if (ticketId) {
        const adapter = getApiStorageAdapter()
        const [record] = await fetchFeedbackRecordsByTicketIds(
          [ticketId],
          /** @type {{ listRecordsByTicketIds: (dataSourceType: string, ticketIds: string[]) => Promise<FeedbackRecord[]> }} */ (adapter),
        )
        if (record) {
          const key = record.ticketId?.trim() || ticketId
          setBackfill((prev) => new Map(prev).set(key, record))
          setSelectedDirect(record)
          return
        }
      }
      message.warning(missingHint || '未找到该记录，可能不在当前数据源或已被删除')
    },
    [feedbackByTicketId, feedbackById, backfill, setSelectedDirect, message, missingHint],
  )

  return (
    <div className="space-y-6">
      {typeof children === 'function'
        ? /** @type {TicketDrawerHostRenderTab} */ (children)(
            (link) => void openRecord(link),
            (recordId, dataSourceType) => void openRecord(recordId, dataSourceType),
          )
        : children}
      <FeedbackDrawer
        feedback={selectedFeedback}
        onClose={requestCloseDrawer}
        onSavedClose={closeDrawer}
        onDirtyChange={onDrawerDirtyChange}
      />
    </div>
  )
}
