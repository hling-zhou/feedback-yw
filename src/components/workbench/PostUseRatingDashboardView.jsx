import { useEffect, useMemo, useState } from 'react'
import { Card, Segmented, Space, Tag, Typography, message } from 'antd'
import { BarChartOutlined, FileWordOutlined } from '@ant-design/icons'
import PostUseMonthlyReportPreview from './PostUseMonthlyReportPreview.jsx'
import PostUseStoryView from './PostUseStoryView.jsx'
import { loadVisitRecords } from '../../lib/postUseRating/visitRecords.js'
import { ensureHistoricalTrendSeed } from '../../lib/postUseRating/trendStore.js'
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
 * 用后即评工作台：统一故事模型驱动线上综合分析与 Word 月报。
 */
export default function PostUseRatingDashboardView() {
  const { feedbacks, currentPeriod, adapter } = useInsights()
  const [visits, setVisits] = useState([])
  const [actionItems, setActionItems] = useState([])
  const [trendSnap, setTrendSnap] = useState(null)
  const [quality, setQuality] = useState(null)
  const [creatingSignalKey, setCreatingSignalKey] = useState('')
  const [viewMode, setViewMode] = useState('online')
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
          ensureHistoricalTrendSeed(adapter).catch(() => null),
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
  const monthReasons = useMemo(() => {
    if (!trendSnap || !reportMonthSafe(currentPeriod)) return []
    const month = reportMonthSafe(currentPeriod)
    return (trendSnap.reasons || [])
      .filter((r) => r.month === month)
      .map((r) => ({
        reason: r.reason,
        count: r.count,
        ...(r.channel != null && r.channel !== '' ? { channel: r.channel } : {}),
      }))
      .sort((a, b) => b.count - a.count)
  }, [trendSnap, currentPeriod])

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
  const activeViewMode = reportMonth ? viewMode : 'online'
  useEffect(() => {
    if (!reportMonth && viewMode !== 'online') setViewMode('online')
  }, [reportMonth, viewMode])
  const qualityMonth = reportMonth || [...new Set(scopedItems.map((r) => r.importMonth).filter(Boolean))].sort().at(-1) || ''
  const periodQuality = quality?.periods?.[qualityMonth] || null
  const storyModel = useMemo(() => buildPostUseStoryModel({
    records: scopedItems,
    allRecords: allScopedItems,
    visits: scopedVisits,
    productNames,
    focusNames,
    actions: actionItems,
    trend: trendSnap,
    quality: periodQuality,
    period: currentPeriod,
  }), [scopedItems, allScopedItems, scopedVisits, productNames, focusNames, actionItems, trendSnap, periodQuality, currentPeriod])

  return (
    <div className="space-y-4">
      <Card size="small">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Typography.Title level={4} className="!mb-0">
              {reportMonth ? '用后即评分析与报告' : '用后即评综合分析'}
            </Typography.Title>
            {reportMonth ? (
              <Segmented
                className="post-use-report-tabs"
                value={activeViewMode}
                onChange={setViewMode}
                options={[
                  { value: 'online', label: '线上综合分析', icon: <BarChartOutlined /> },
                  { value: 'report', label: 'Word 月报', icon: <FileWordOutlined /> },
                ]}
              />
            ) : null}
          </div>
          <Space size={[8, 8]} wrap>
            <Tag color={storyModel.scope.qualityWarningCount ? 'gold' : storyModel.quality ? 'green' : 'default'}>
              {storyModel.scope.qualityStatus}
            </Tag>
            <Tag color={activeViewMode === 'online' ? 'blue' : 'default'}>范围 {storyModel.scope.periodLabel}</Tag>
            <Tag>产品 {storyModel.scope.productCount}</Tag>
            <Tag>样本 {storyModel.scope.validSample}</Tag>
            {reportMonth ? <Tag color="green">月报 {reportMonth}</Tag> : null}
          </Space>
        </div>
      </Card>

      {activeViewMode === 'report' ? (
        <PostUseMonthlyReportPreview
          adapter={adapter}
          reportMonth={reportMonth}
          scoredRows={storyModel.scoredRows}
          productNames={productNames}
          visits={visits}
          actionItems={actionItems}
          reasons={monthReasons}
          insightBundle={storyModel.insightBundle}
          quality={periodQuality}
          storyModel={storyModel}
        />
      ) : (
        <PostUseStoryView
          model={storyModel}
          creatingSignalKey={creatingSignalKey}
          onCreateAction={(signal) => void createActionFromSignal(signal)}
        />
      )}
    </div>
  )
}

/** @param {{ id?: string } | null | undefined} period */
function reportMonthSafe(period) {
  if (!period?.id?.includes('period:month:')) return ''
  return period.id.replace('period:month:', '')
}
