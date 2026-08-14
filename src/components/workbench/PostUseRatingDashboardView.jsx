import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Space, Tag, Typography, message } from 'antd'
import PostUseStoryView from './PostUseStoryView.jsx'
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

/**
 * 用后即评工作台：线上综合分析；单月可打开独立 HTML 月报。
 */
export default function PostUseRatingDashboardView() {
  const { feedbacks, currentPeriod, adapter, settings } = useInsights()
  const [visits, setVisits] = useState([])
  const [actionItems, setActionItems] = useState([])
  const [trendSnap, setTrendSnap] = useState(null)
  const [quality, setQuality] = useState(null)
  const [creatingSignalKey, setCreatingSignalKey] = useState('')
  const items = useMemo(
    () => filterRecordsForScope(feedbacks, currentPeriod, 'post_use_rating'),
    [feedbacks, currentPeriod],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!adapter) return
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
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, feedbacks])

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
  const storyModel = useMemo(() => buildPostUseStoryModel({
    records: scopedItems,
    allRecords: allScopedItems,
    companyRecords: items,
    visits: scopedVisits,
    productNames,
    focusNames,
    actions: actionItems,
    trend: trendSnap,
    quality: periodQuality,
    period: currentPeriod,
    settings,
    ticketRecords,
  }), [scopedItems, allScopedItems, items, scopedVisits, productNames, focusNames, actionItems, trendSnap, periodQuality, currentPeriod, settings, ticketRecords])

  return (
    <div className="space-y-4">
      <Card size="small">
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
      </Card>

      <PostUseStoryView
        model={storyModel}
        creatingSignalKey={creatingSignalKey}
        onCreateAction={(signal) => void createActionFromSignal(signal)}
      />
    </div>
  )
}

/** @param {{ id?: string } | null | undefined} period */
function reportMonthSafe(period) {
  if (!period?.id?.includes('period:month:')) return ''
  return period.id.replace('period:month:', '')
}
