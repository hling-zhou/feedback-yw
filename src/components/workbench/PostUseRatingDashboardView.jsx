import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Space, Spin, Tag, Typography, message } from 'antd'
import PostUseStoryView from './PostUseStoryView.jsx'
import FeedbackDrawer from '../FeedbackDrawer.jsx'
import { useFeedbackDrawerSelection } from '../../hooks/useFeedbackDrawerSelection.js'
import { normalizeTicketId } from '../../lib/desensitize.js'
import { loadVisitRecords } from '../../lib/postUseRating/visitRecords.js'
import { loadPostUseTrend } from '../../lib/postUseRating/trendStore.js'
import { listActionItems } from '../../lib/actionItemClient.js'
import { createActionItem } from '../../lib/actionItemClient.js'
import { useInsights } from '../../context/InsightsContext.jsx'
import { filterRecordsForScope } from '../../snapshots/recordScope.js'
import {
  getPostUseFocusTrackedNames,
  getPostUseRatingProductNames,
  scopePostUseRatingRecords,
} from '../../lib/productCatalog/postUseRatingProducts.js'
import { getCatalogProducts } from '../../lib/productCatalogLoader.js'
import { postUseVisitMonthsForPeriod } from '../../lib/postUseRating/periodScope.js'
import { loadPostUsePeriodQuality } from '../../lib/postUseRating/qualityStore.js'
import { buildPostUseStoryModel } from '../../lib/postUseRating/storyModel.js'
import { normalizeDepartmentStatusTrends, rollupCompanyMetrics } from '../../lib/postUseRating/statusTrends.js'
import {
  applyPostUseWorkbenchAggregate,
  postUseWorkbenchMatchesCatalog,
} from '../../lib/workbenchStoredAggregates.js'

/**
 * 用后即评工作台：线上综合分析；单月可打开独立 HTML 月报。
 */
export default function PostUseRatingDashboardView() {
  const {
    feedbacks,
    currentPeriod,
    adapter,
    settings,
    postUseRatingOnDemand,
    postUseSettledPeriodIds,
    sourceSnapshots,
  } = useInsights()
  const [extrasReady, setExtrasReady] = useState(false)
  const [visits, setVisits] = useState([])
  const [actionItems, setActionItems] = useState([])
  const [trendSnap, setTrendSnap] = useState(null)
  const [quality, setQuality] = useState(null)
  const [remoteStatusTrends, setRemoteStatusTrends] = useState(null)
  const [statusTrendsPending, setStatusTrendsPending] = useState(false)
  const hasRemoteStatusTrendsRef = useRef(false)
  const [creatingSignalKey, setCreatingSignalKey] = useState('')
  const postUseCount = useMemo(
    () => (feedbacks || []).filter((record) => record.dataSourceType === 'post_use_rating').length,
    [feedbacks],
  )
  const items = useMemo(
    () => filterRecordsForScope(feedbacks, currentPeriod, 'post_use_rating'),
    [feedbacks, currentPeriod],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!adapter) {
        if (!cancelled) setExtrasReady(true)
        return
      }
      try {
        const [v, actionsRes, trend, qualityStore] = await Promise.all([
          loadVisitRecords(adapter),
          listActionItems({ linkedDataSources: 'post_use_rating', limit: 500 }).catch(() => ({ items: [] })),
          loadPostUseTrend(adapter).catch(() => null),
          loadPostUsePeriodQuality(adapter).catch(() => null),
        ])
        if (!cancelled) {
          setVisits(v)
          setActionItems(actionsRes?.items || [])
          setTrendSnap(trend)
          setQuality(qualityStore)
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setExtrasReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, feedbacks])

  useEffect(() => {
    if (!adapter || typeof adapter.listPostUseStatusTrends !== 'function') {
      setStatusTrendsPending(false)
      return undefined
    }
    let cancelled = false
    if (!hasRemoteStatusTrendsRef.current) setStatusTrendsPending(true)
    ;(async () => {
      try {
        const trends = normalizeDepartmentStatusTrends(await adapter.listPostUseStatusTrends())
        if (!cancelled) {
          hasRemoteStatusTrendsRef.current = true
          setRemoteStatusTrends(trends)
          setStatusTrendsPending(false)
        }
      } catch {
        if (!cancelled) setStatusTrendsPending(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, postUseCount])

  const catalog = useMemo(() => getCatalogProducts(), [feedbacks])
  const productNames = useMemo(() => getPostUseRatingProductNames(catalog), [catalog])
  const focusNames = useMemo(() => getPostUseFocusTrackedNames(catalog), [catalog])
  const scopedItems = useMemo(() => scopePostUseRatingRecords(items, catalog), [items, catalog])
  const ticketRecords = useMemo(
    () =>
      (feedbacks || []).filter(
        (record) =>
          record.dataSourceType === 'complaint_ticket' ||
          record.dataSourceType === 'consultation_ticket',
      ),
    [feedbacks],
  )
  const {
    selected,
    selectFeedback,
    requestCloseDrawer,
    closeDrawer,
    onDrawerDirtyChange,
  } = useFeedbackDrawerSelection()
  // 原工单编号 → 工单记录的查找表（ticketId 与 id 双索引），用于点击原工单号打开详情抽屉
  const ticketLookup = useMemo(() => {
    const map = new Map()
    for (const record of ticketRecords) {
      const tid = normalizeTicketId(record.ticketId)
      if (tid) map.set(tid, record)
      const rid = String(record.id || '').trim()
      if (rid) map.set(rid, record)
    }
    return map
  }, [ticketRecords])
  const openTicketByOriginalId = useCallback(
    (originalTicketId) => {
      if (!originalTicketId) return
      const norm = normalizeTicketId(originalTicketId)
      const ticket = (norm && ticketLookup.get(norm)) || ticketLookup.get(originalTicketId)
      if (ticket) {
        selectFeedback(ticket)
      } else {
        message.info(`未找到原工单 ${originalTicketId} 对应的工单记录，请确认该工单已导入`)
      }
    },
    [ticketLookup, selectFeedback],
  )
  const scopedVisits = useMemo(() => {
    const months = new Set(postUseVisitMonthsForPeriod(currentPeriod))
    return scopePostUseRatingRecords(
      visits.filter((visit) => months.has(visit.importMonth || visit.visitMonth)),
      catalog,
    )
  }, [visits, currentPeriod, catalog])
  const allScopedItems = useMemo(
    () => scopePostUseRatingRecords(feedbacks.filter((r) => r.dataSourceType === 'post_use_rating'), catalog),
    [feedbacks, catalog],
  )

  const createActionFromSignal = async (signal) => {
    const key = `${signal.type}-${signal.productName}-${signal.title}`
    if ((actionItems || []).some((item) => signal.linkedInsightIds?.some((id) => item.linkedInsightIds?.includes(id)))) {
      message.info('该洞察已关联举措')
      return
    }
    setCreatingSignalKey(key)
    try {
      const created = await createActionItem({
        content: signal.title,
        detail: signal.detail,
        productName: signal.productName,
        status: 'pending_evaluation',
        painPointSnapshot: signal.insightTheme || signal.title,
        linkedDataSources: ['post_use_rating'],
        linkedInsightIds: signal.linkedInsightIds || [],
        evidenceRecordIds: signal.evidenceRecordIds || [],
        insightTheme: signal.insightTheme || '',
        triggerMetric: signal.triggerMetric,
        firstProposedAt: new Date().toISOString().slice(0, 10),
      })
      setActionItems((items) => [created, ...items])
      message.success('已创建举措并关联洞察证据')
    } catch (error) {
      message.error(error?.message || '创建举措失败')
    } finally {
      setCreatingSignalKey('')
    }
  }

  const reportMonth = reportMonthSafe(currentPeriod)
  const qualityMonth = reportMonth || [...new Set(scopedItems.map((r) => r.importMonth).filter(Boolean))].sort().at(-1) || ''
  const periodQuality = quality?.periods?.[qualityMonth] || null
  const useRemoteCompany = Array.isArray(remoteStatusTrends?.companyMetrics)
  const remoteCompanyMetrics = useMemo(
    () => (useRemoteCompany ? rollupCompanyMetrics(remoteStatusTrends.companyMetrics, currentPeriod) : null),
    [useRemoteCompany, remoteStatusTrends, currentPeriod],
  )
  const storedWorkbench = sourceSnapshots.post_use_rating?.aggregates?.workbench
  const catalogMatchesStored = postUseWorkbenchMatchesCatalog(storedWorkbench, catalog)
  const storyModel = useMemo(() => {
    const live = buildPostUseStoryModel({
      records: scopedItems,
      allRecords: allScopedItems,
      companyRecords: useRemoteCompany ? undefined : items,
      companyMetrics: remoteCompanyMetrics,
      companyMetricsPending: Boolean(statusTrendsPending && !useRemoteCompany),
      visits: scopedVisits,
      productNames,
      focusNames,
      actions: actionItems,
      trend: trendSnap,
      quality: periodQuality,
      period: currentPeriod,
      settings,
      ticketRecords,
      statusTrends: remoteStatusTrends,
      statusTrendsPending: Boolean(statusTrendsPending && !remoteStatusTrends),
    })
    return catalogMatchesStored ? applyPostUseWorkbenchAggregate(live, storedWorkbench) : live
  }, [scopedItems, allScopedItems, items, useRemoteCompany, remoteCompanyMetrics, scopedVisits, productNames, focusNames, actionItems, trendSnap, periodQuality, currentPeriod, settings, ticketRecords, remoteStatusTrends, statusTrendsPending, catalogMatchesStored, storedWorkbench])

  const ratingsPending =
    postUseRatingOnDemand &&
    Boolean(currentPeriod?.id) &&
    !postUseSettledPeriodIds.includes(currentPeriod.id)

  if (ratingsPending || !extrasReady) {
    return (
      <div className="page-card flex min-h-[280px] items-center justify-center">
        <Spin size="large" description="正在加载用后即评…" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="page-card-sm">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Typography.Title level={4} className="!mb-0">
              {reportMonth ? '用后即评分析与报告' : '用后即评综合分析'}
            </Typography.Title>
            {reportMonth ? (
              <Button
                onClick={() => window.open(`/workbench/post-use-report/${reportMonth}`, '_blank')}
              >
                打开月报
              </Button>
            ) : null}
          </div>
          <Space size={[8, 8]} wrap>
            <Tag color={storyModel.scope.qualityWarningCount ? 'gold' : storyModel.quality ? 'green' : 'default'}>
              {storyModel.scope.qualityStatus}
            </Tag>
            <Tag color="blue">范围 {storyModel.scope.periodLabel}</Tag>
            <Tag>产品 {storyModel.scope.productCount}</Tag>
            <Tag>样本 {storyModel.scope.validSample}</Tag>
            {reportMonth ? <Tag color="green">月报 {reportMonth}</Tag> : null}
          </Space>
        </div>
      </div>

      <PostUseStoryView
        model={storyModel}
        creatingSignalKey={creatingSignalKey}
        onCreateAction={(signal) => void createActionFromSignal(signal)}
        onOpenTicket={openTicketByOriginalId}
      />
      <FeedbackDrawer
        feedback={selected}
        onClose={requestCloseDrawer}
        onSavedClose={closeDrawer}
        onDirtyChange={onDrawerDirtyChange}
      />
    </div>
  )
}

/** @param {{ id?: string } | null | undefined} period */
function reportMonthSafe(period) {
  if (!period?.id?.includes('period:month:')) return ''
  return period.id.replace('period:month:', '')
}
