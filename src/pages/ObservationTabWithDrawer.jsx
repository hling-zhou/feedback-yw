import { useCallback, useMemo, useState } from 'react'
import { App } from 'antd'
import FeedbackDrawer from '../components/FeedbackDrawer.jsx'
import ObservationTab from './observation/ObservationTab.jsx'
import ObservationMatchQueue from './observation/ObservationMatchQueue.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { useFeedbackDrawerSelection } from '../hooks/useFeedbackDrawerSelection.js'
import { fetchFeedbackRecordsByTicketIds } from '../lib/linkedTicketBackfill.js'
import { getApiStorageAdapter } from '../storage/apiStorageAdapter.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * 留观 Tab 容器：挂 FeedbackDrawer 实例 + 给留观抽屉/待复核队列注入 onOpenRecord，
 * 工单号/评价可点 → 原地打开对应详情抽屉（2026-11-01 抽屉改版接线收尾）。
 *
 * 查找顺序：洞察周期缓存（投诉/咨询按 ticketId）→ 按 recordId 匹配（评价类 / 周期
 * 窗口外工单的兜底）→ 按 ticketId 服务端补拉（投诉/咨询）。均未命中时提示。
 */
export default function ObservationTabWithDrawer() {
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
   * 留观证据/队列 → 详情抽屉统一入口。
   * 兼容两种签名：ObservationTab 传 link 对象；ObservationMatchQueue 传 (recordId, dataSourceType)。
   * @param {{ recordId?: string, recordDataSource?: string, ticketId?: string } | string} linkOrRecordId
   * @param {string} [dataSourceType]
   */
  const openObservationRecord = useCallback(
    /**
     * @param {{ recordId?: string, recordDataSource?: string, ticketId?: string } | string | null | undefined} linkOrRecordId
     * @param {string} [dataSourceType] 仅 Queue 直传 (recordId, dataSourceType) 时使用
     */
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
      message.warning('未找到该记录，可能不在当前数据源或已被删除')
    },
    [feedbackByTicketId, feedbackById, backfill, setSelectedDirect, message],
  )

  return (
    <div className="space-y-6">
      {/* 两个消费方签名不同（Tab 传 link 对象 / Queue 传 recordId+来源），薄包装适配 */}
      <ObservationTab onOpenRecord={(link) => void openObservationRecord(link)} />
      <ObservationMatchQueue
        onOpenRecord={(recordId, dataSourceType) => void openObservationRecord(recordId, dataSourceType)}
      />
      <FeedbackDrawer
        feedback={selectedFeedback}
        onClose={requestCloseDrawer}
        onSavedClose={closeDrawer}
        onDirtyChange={onDrawerDirtyChange}
      />
    </div>
  )
}
