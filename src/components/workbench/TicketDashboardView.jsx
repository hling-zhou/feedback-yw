import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Segmented, Select, Space, Tag, Typography } from 'antd'
import ThemeBarChart from '../charts/ThemeBarChart.jsx'
import TrendChart from '../charts/TrendChart.jsx'
import SentimentDistributionPanel from '../SentimentDistributionPanel.jsx'
import CxWanTouTrendChart from './CxWanTouTrendChart.jsx'
import DimensionQuantityTrendPanel from './DimensionQuantityTrendPanel.jsx'
import PlanningRecommendationsPanel from './PlanningRecommendationsPanel.jsx'
import WorkbenchAnalysisHint from './WorkbenchAnalysisHint.jsx'
import { useInsights } from '../../context/InsightsContext.jsx'
import { getTaxonomy, listProducts } from '../../lib/productTaxonomy.js'
import { countByField, filterFeedbacks } from '../../lib/productAnalytics.js'
import { workbenchTicketRecords } from '../../snapshots/recordScope.js'
import { resolveCatalogKeyFromProductName } from '../../lib/wanTouRatio.js'
import { suggestImportMonth } from '../../domain/insightPeriod.js'
import { monthlyTrend } from '../../lib/analytics.js'
import {
  filterRecordsByImportMonths,
  resolveTrendMonthWindow,
} from '../../lib/workbenchTrendWindow.js'
import {
  buildTicketWorkbenchDrillDownUrl,
  drillDownFieldParam,
} from '../../lib/feedbackFilters.js'
import { prepareOverviewConclusionsForDisplay } from '../../snapshots/rehydrateOverviewRecommendations.js'
import { WORKBENCH_TICKET_TABS_WHATS_NEW_DESCRIPTION } from '../../lib/whatsNew.js'

const PROBLEM_DIM_OPTIONS = [
  { value: 'requestScene', label: '请求场景' },
  { value: 'problemType', label: '问题类型' },
  { value: 'journeyL1', label: '一级旅程' },
]

/**
 * @param {Object} props
 * @param {import('../../domain/snapshot.js').InsightSnapshot} props.snapshot
 * @param {string} props.sourceLabel
 * @param {string} [props.product]
 * @param {(value: string) => void} [props.onProductChange]
 * @param {boolean} [props.pdfCaptureMode] PDF 离屏截图：隐藏筛选栏等非图表 UI
 * @param {boolean} [props.showWhatsNew]
 * @param {() => void} [props.onDismissWhatsNew]
 */
export default function TicketDashboardView({
  snapshot,
  sourceLabel,
  product: productProp,
  onProductChange,
  pdfCaptureMode = false,
  showWhatsNew = false,
  onDismissWhatsNew,
}) {
  const {
    feedbacks,
    currentPeriod,
    orderVolumes,
    wanTouTargets,
  } = useInsights()
  const items = useMemo(
    () => workbenchTicketRecords(feedbacks, currentPeriod, snapshot),
    [feedbacks, currentPeriod, snapshot],
  )

  const products = useMemo(() => listProducts(items), [items])
  const productControlled = onProductChange != null
  const [productLocal, setProductLocal] = useState(productProp ?? '')
  const product = productControlled ? productProp ?? '' : productLocal
  const [problemDim, setProblemDim] = useState(
    /** @type {'requestScene' | 'problemType' | 'journeyL1'} */ ('requestScene'),
  )

  const applyProductChange = useCallback(
    (value) => {
      const next = value || ''
      if (productControlled) {
        onProductChange?.(next)
      } else {
        setProductLocal(next)
      }
    },
    [productControlled, onProductChange],
  )
  const isComplaintSource = snapshot.dataSourceType === 'complaint_ticket'

  useEffect(() => {
    if (!productControlled) return
    setProductLocal(productProp ?? '')
  }, [productProp, productControlled])

  useEffect(() => {
    if (!products.length) {
      if (product) applyProductChange('')
      return
    }
    if (product && !products.some((p) => p.name === product)) {
      applyProductChange('')
    }
  }, [products, product, applyProductChange])

  const isAllProducts = !product && !pdfCaptureMode
  const sectionProduct = product || (pdfCaptureMode ? products[0]?.name : '') || ''
  const activeProductKey = useMemo(
    () => resolveCatalogKeyFromProductName(sectionProduct),
    [sectionProduct],
  )

  const productOptions = useMemo(
    () => [
      { value: '', label: `全部产品 (${items.length})` },
      ...products.map((p) => ({
        value: p.name,
        label: `${p.name} (${p.count})`,
      })),
    ],
    [products, items.length],
  )

  const scoped = useMemo(
    () =>
      filterFeedbacks(items, {
        product: isAllProducts ? undefined : sectionProduct || undefined,
      }),
    [items, isAllProducts, sectionProduct],
  )

  const trendWindow = useMemo(() => resolveTrendMonthWindow(currentPeriod), [currentPeriod])

  const sourceAllRecords = useMemo(() => {
    const type = snapshot.dataSourceType
    return (feedbacks || []).filter((r) => (r.dataSourceType || 'complaint_ticket') === type)
  }, [feedbacks, snapshot.dataSourceType])

  const trendBaseRecords = useMemo(() => {
    const inWindow = filterRecordsByImportMonths(sourceAllRecords, trendWindow.months)
    return filterFeedbacks(inWindow, {
      product: isAllProducts ? undefined : sectionProduct || undefined,
    })
  }, [sourceAllRecords, trendWindow.months, isAllProducts, sectionProduct])

  const volumeTrendData = useMemo(() => {
    const trend = monthlyTrend(trendBaseRecords, { basis: 'importMonth', limit: 120 })
    const byDate = new Map(trend.map((row) => [row.date, row]))
    return trendWindow.months.map((month) => {
      const row = byDate.get(month)
      return {
        date: month,
        count: row?.count ?? 0,
        negative: row?.negative ?? 0,
      }
    })
  }, [trendBaseRecords, trendWindow.months])

  const taxonomy = getTaxonomy(sectionProduct)
  const drillDownBase = useMemo(
    () => ({
      source: snapshot.dataSourceType,
      month: suggestImportMonth(currentPeriod),
      product: product || undefined,
    }),
    [snapshot.dataSourceType, currentPeriod, product],
  )

  const problemDistData = useMemo(() => {
    if (problemDim === 'journeyL1') {
      return countByField(scoped, 'journeyL1').map((d) => ({
        label: d.name,
        count: d.count,
        negative: 0,
      }))
    }
    if (problemDim === 'problemType') {
      return countByField(scoped, 'problemType').map((d) => ({
        label: d.name,
        count: d.count,
        negative: 0,
      }))
    }
    return countByField(scoped, 'requestScene').map((d) => ({
      label: d.name,
      count: d.count,
      negative: 0,
    }))
  }, [scoped, problemDim])

  const { conclusions: displayConclusions } = useMemo(() => {
    const raw = snapshot?.aggregates?.planningConclusions
    return prepareOverviewConclusionsForDisplay(raw)
  }, [snapshot?.aggregates?.planningConclusions])

  const sourceFeedbacks = useMemo(() => {
    const type = snapshot.dataSourceType
    return (feedbacks || []).filter((r) => (r.dataSourceType || 'complaint_ticket') === type)
  }, [feedbacks, snapshot.dataSourceType])

  const latestMonth = [...volumeTrendData].reverse().find((r) => r.count > 0) || volumeTrendData.at(-1)
  let monthDelta = null
  if (latestMonth) {
    const prev = [...volumeTrendData]
      .reverse()
      .find((r) => r.date < latestMonth.date)
    if (prev) monthDelta = latestMonth.count - prev.count
  }

  if (!items.length) {
    return (
      <Card>
        <Typography.Text type="secondary">
          当前周期内暂无「{sourceLabel}」数据，请先导入。
        </Typography.Text>
      </Card>
    )
  }

  return (
    <div>
      {!pdfCaptureMode && showWhatsNew ? (
        <Alert
          className="mb-4 !rounded-lg"
          type="info"
          showIcon
          closable
          message="功能上新"
          description={WORKBENCH_TICKET_TABS_WHATS_NEW_DESCRIPTION}
          onClose={() => onDismissWhatsNew?.()}
          action={
            <Button size="small" type="link" onClick={() => onDismissWhatsNew?.()}>
              不再显示
            </Button>
          }
        />
      ) : null}

      {!pdfCaptureMode && (
        <WorkbenchAnalysisHint
          className="mb-4 !rounded-lg"
          sourceLabel={sourceLabel}
          product={product || undefined}
        />
      )}

      {!pdfCaptureMode && (
        <div className="mb-4 space-y-2">
          <Space wrap align="center" size="middle">
            <Typography.Text strong className="text-sm">
              产品
            </Typography.Text>
            <Select
              showSearch
              optionFilterProp="label"
              className="min-w-[220px]"
              value={product || ''}
              options={productOptions}
              onChange={(value) => applyProductChange(value)}
            />
            {product && taxonomy.name ? <Tag color="blue">{taxonomy.name}</Tag> : null}
            <Typography.Text type="secondary" className="text-sm">
              周期内 {items.length} 条
              {isAllProducts
                ? ` · 全部产品 ${scoped.length} 条`
                : ` · 当前产品 ${scoped.length} 条`}
            </Typography.Text>
          </Space>
        </div>
      )}

      {isComplaintSource && (
        <div className="page-section-sm">
          <CxWanTouTrendChart
            period={currentPeriod}
            productName={isAllProducts ? undefined : sectionProduct}
            productKey={isAllProducts ? undefined : activeProductKey}
            records={filterRecordsByImportMonths(sourceAllRecords, trendWindow.months)}
            orderVolumes={orderVolumes}
            wanTouTargets={wanTouTargets}
          />
        </div>
      )}

      <div className="page-section grid items-stretch gap-4 lg:grid-cols-2">
        <Card
          className="h-full"
          title={<Typography.Text strong>工单量趋势</Typography.Text>}
          extra={
            <Typography.Text type="secondary" className="text-xs">
              {trendWindow.startMonth}～{trendWindow.endMonth}
              {latestMonth && monthDelta != null
                ? ` · ${latestMonth.date} 环比${monthDelta >= 0 ? '+' : ''}${monthDelta}`
                : ''}
            </Typography.Text>
          }
        >
          <div data-pdf-chart="source-trend" className="rounded-lg bg-white p-2">
            <TrendChart
              variant="line"
              data={volumeTrendData}
              areas={[
                { dataKey: 'count', name: '工单总数', stroke: '#4F46E5' },
                { dataKey: 'negative', name: '负向工单', stroke: '#EF4444' },
              ]}
            />
          </div>
        </Card>
        <div data-pdf-chart="source-sentiment">
          <SentimentDistributionPanel
            className="h-full"
            items={scoped}
            subtitle={`${scoped.length} 条 · ${sourceLabel} · 客户请求与需求痛点`}
          />
        </div>
      </div>

      <Card
        className="page-section"
        title={
          <div className="flex flex-wrap items-center gap-3">
            <Typography.Text strong>问题分布</Typography.Text>
            <Segmented
              size="small"
              value={problemDim}
              options={PROBLEM_DIM_OPTIONS}
              onChange={(v) => setProblemDim(v)}
            />
          </div>
        }
      >
        <div data-pdf-chart="source-problem-dist" className="rounded-lg bg-white p-2">
          <ThemeBarChart
            data={problemDistData}
            buildFeedbacksHref={(label) =>
              buildTicketWorkbenchDrillDownUrl({
                ...drillDownBase,
                ...(problemDim === 'requestScene'
                  ? { requestScene: drillDownFieldParam(label) }
                  : {}),
                ...(problemDim === 'problemType'
                  ? { problemType: drillDownFieldParam(label) }
                  : {}),
                ...(problemDim === 'journeyL1'
                  ? { journeyL1: drillDownFieldParam(label) }
                  : {}),
              })
            }
          />
        </div>
      </Card>

      {!pdfCaptureMode && (
        <DimensionQuantityTrendPanel
          period={currentPeriod}
          trendRecords={trendBaseRecords}
          periodRecords={scoped}
        />
      )}

      {!pdfCaptureMode && (
        <div className="page-section">
          <PlanningRecommendationsPanel
            title="典型问题"
            conclusions={displayConclusions}
            feedbacks={sourceFeedbacks}
            syncedProduct={product || undefined}
          />
        </div>
      )}
    </div>
  )
}
