import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Select, Space, Spin, Tag, Tooltip, Typography, message } from 'antd'
import PostUseStoryView from './PostUseStoryView.jsx'
import PostUseCallbackProcessModal from './PostUseCallbackProcessModal.jsx'
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
  CALLBACK_ENTRY_DISABLED_REASON,
  isCallbackEntryDisabled,
} from '../../lib/postUseRating/callbackEntry.js'
import { canUsePostUseCallbackList } from '../../domain/auth/permissions.js'
import { useAuth } from '../../context/AuthContext.jsx'
import {
  getPostUseFocusTrackedNames,
  getPostUseRatingProductNames,
  scopePostUseRatingRecords,
} from '../../lib/productCatalog/postUseRatingProducts.js'
import { getCatalogProducts } from '../../lib/productCatalogLoader.js'
import { postUseVisitMonthsForPeriod } from '../../lib/postUseRating/periodScope.js'
import { loadPostUsePeriodQuality } from '../../lib/postUseRating/qualityStore.js'
import { buildPostUseStoryModel } from '../../lib/postUseRating/storyModel.js'
import { buildProductStatusTrends, normalizeDepartmentStatusTrends, rollupCompanyMetrics } from '../../lib/postUseRating/statusTrends.js'
import {
  applyPostUseWorkbenchAggregate,
  postUseWorkbenchMatchesCatalog,
} from '../../lib/workbenchStoredAggregates.js'
import { resolveChartEndMonth } from '../../domain/insightPeriod.js'
import { postUsePeriodMonths } from '../../lib/postUseRating/periodScope.js'

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
  const { user } = useAuth()
  const canOpenCallbackList = canUsePostUseCallbackList(user?.role)
  // 2026-11-09 双入口同弹窗：弹窗状态上提到本组件（头部「分析与报告」入口 + StoryView「客户与证据」入口共用）
  const [callbackProcessOpen, setCallbackProcessOpen] = useState(false)
  const [extrasReady, setExtrasReady] = useState(false)
  const [visits, setVisits] = useState([])
  const [actionItems, setActionItems] = useState([])
  const [trendSnap, setTrendSnap] = useState(null)
  const [quality, setQuality] = useState(null)
  const [remoteStatusTrends, setRemoteStatusTrends] = useState(null)
  const [statusTrendsPending, setStatusTrendsPending] = useState(false)
  const hasRemoteStatusTrendsRef = useRef(false)
  const [creatingSignalKey, setCreatingSignalKey] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
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
  const productOptions = useMemo(() => {
    const counts = new Map()
    for (const record of scopedItems) {
      const name = String(record.product || '').trim()
      if (name) counts.set(name, (counts.get(name) || 0) + 1)
    }
    return [...counts].map(([name, count]) => ({ value: name, label: `${name} (${count})` }))
      .sort((a, b) => a.value.localeCompare(b.value, 'zh'))
  }, [scopedItems])
  const selectedItems = useMemo(
    () => selectedProduct ? scopedItems.filter((record) => record.product === selectedProduct) : scopedItems,
    [scopedItems, selectedProduct],
  )
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
  const selectedAllItems = useMemo(
    () => selectedProduct ? allScopedItems.filter((record) => record.product === selectedProduct) : allScopedItems,
    [allScopedItems, selectedProduct],
  )
  const selectedVisits = useMemo(
    () => selectedProduct ? scopedVisits.filter((visit) => visit.product === selectedProduct) : scopedVisits,
    [scopedVisits, selectedProduct],
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

  const reportTarget = reportTargetSafe(currentPeriod)
  const reportMonth = reportTarget?.kind === 'month' ? reportTarget.key : ''
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
    const statusTrends = selectedProduct
      ? buildProductStatusTrends({
        productName: selectedProduct,
        trend: trendSnap,
        companyTrends: remoteStatusTrends,
        departmentRecords: selectedAllItems,
        companyRecords: feedbacks.filter((record) => record.dataSourceType === 'post_use_rating'),
        nowMonth: resolveChartEndMonth(currentPeriod),
      })
      : remoteStatusTrends
    const live = buildPostUseStoryModel({
      records: selectedItems,
      allRecords: selectedAllItems,
      companyRecords: useRemoteCompany ? undefined : items,
      companyMetrics: remoteCompanyMetrics,
      companyMetricsPending: Boolean(statusTrendsPending && !useRemoteCompany),
      visits: selectedVisits,
      productNames: selectedProduct ? [selectedProduct] : productNames,
      focusNames: selectedProduct ? [selectedProduct] : focusNames,
      actions: actionItems,
      trend: trendSnap,
      quality: periodQuality,
      period: currentPeriod,
      settings,
      ticketRecords,
      statusTrends,
      statusTrendsPending: Boolean(!selectedProduct && statusTrendsPending && !remoteStatusTrends),
      nowMonth: resolveChartEndMonth(currentPeriod),
    })
    return catalogMatchesStored && !selectedProduct ? applyPostUseWorkbenchAggregate(live, storedWorkbench) : live
  }, [selectedItems, selectedAllItems, items, feedbacks, useRemoteCompany, remoteCompanyMetrics, selectedVisits, selectedProduct, productNames, focusNames, actionItems, trendSnap, periodQuality, currentPeriod, settings, ticketRecords, remoteStatusTrends, statusTrendsPending, catalogMatchesStored, storedWorkbench])

  const loadMonthIds = useMemo(
    () => (currentPeriod ? postUsePeriodMonths(currentPeriod).map((month) => `period:month:${month}`) : []),
    [currentPeriod],
  )
  const ratingsPending =
    postUseRatingOnDemand &&
    loadMonthIds.length > 0 &&
    loadMonthIds.some((periodId) => !postUseSettledPeriodIds.includes(periodId))
  // 2026-11-09 双入口：与 StoryView「客户与证据」入口共用同源 disabled 判定
  const callbackEntryDisabled = isCallbackEntryDisabled(storyModel)

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
              {reportTarget ? '用后即评分析与报告' : '用后即评综合分析'}
            </Typography.Title>
            {reportTarget ? (
              <Button
                onClick={() => window.open(`/workbench/post-use-report/${reportTarget.key}`, '_blank')}
              >
                {reportTarget.kind === 'quarter' ? '打开季报' : '打开月报'}
              </Button>
            ) : null}
            {canOpenCallbackList ? (
              <Tooltip
                title={callbackEntryDisabled ? CALLBACK_ENTRY_DISABLED_REASON : ''}
              >
                <span className="ml-auto">
                  <Button
                    size="small"
                    disabled={callbackEntryDisabled}
                    onClick={() => setCallbackProcessOpen(true)}
                  >
                    查看并处理建议回访/溯源清单
                  </Button>
                </span>
              </Tooltip>
            ) : null}
          </div>
          <Space size={[8, 8]} wrap>
            <Typography.Text strong>产品</Typography.Text>
            <Select
              showSearch
              optionFilterProp="label"
              className="min-w-[220px]"
              value={selectedProduct}
              options={[{ value: '', label: `全部产品 (${scopedItems.length})` }, ...productOptions]}
              onChange={(value) => setSelectedProduct(value || '')}
            />
            <Tag color={storyModel.scope.qualityWarningCount ? 'gold' : storyModel.quality ? 'green' : 'default'}>
              {storyModel.scope.qualityStatus}
            </Tag>
            <Tag color="blue">范围 {storyModel.scope.periodLabel}</Tag>
            <Tag>产品 {storyModel.scope.productCount}</Tag>
            <Tag>样本 {storyModel.scope.validSample}</Tag>
            {reportTarget?.kind === 'month' ? <Tag color="green">月报 {reportTarget.key}</Tag> : null}
            {reportTarget?.kind === 'quarter' ? <Tag color="green">季报 {reportTarget.key}</Tag> : null}
          </Space>
        </div>
      </div>

      <PostUseStoryView
        model={storyModel}
        selectedProduct={selectedProduct}
        onProductChange={setSelectedProduct}
        products={productOptions}
        periodId={currentPeriod?.id || ''}
        creatingSignalKey={creatingSignalKey}
        onCreateAction={(signal) => void createActionFromSignal(signal)}
        onOpenTicket={openTicketByOriginalId}
        onOpenCallbackProcess={() => {
          // 双入口共用同一防御：空清单点按给提示（与 disabled 判定同源 helper）
          if (isCallbackEntryDisabled(storyModel)) {
            message.info('当前范围内暂无建议回访/溯源记录')
            return
          }
          setCallbackProcessOpen(true)
        }}
      />
      <FeedbackDrawer
        feedback={selected}
        onClose={requestCloseDrawer}
        onSavedClose={closeDrawer}
        onDirtyChange={onDrawerDirtyChange}
      />
      <PostUseCallbackProcessModal
        open={callbackProcessOpen}
        onClose={() => setCallbackProcessOpen(false)}
        recommendations={storyModel.callbackRecommendations || []}
        callbackNonTenRecords={storyModel.callbackNonTenRecords || []}
        scopeLabel={storyModel.scope?.periodLabel || '当前范围'}
        onOpenTicket={openTicketByOriginalId}
      />
    </div>
  )
}

/** @param {{ id?: string, granularity?: string, anchorYear?: number, anchorQuarter?: number } | null | undefined} period */
function reportTargetSafe(period) {
  if (period?.granularity === 'quarter' && period.anchorYear && period.anchorQuarter) {
    return { kind: 'quarter', key: `${period.anchorYear}-Q${period.anchorQuarter}` }
  }
  if (!period?.id?.includes('period:month:')) return null
  return { kind: 'month', key: period.id.replace('period:month:', '') }
}
