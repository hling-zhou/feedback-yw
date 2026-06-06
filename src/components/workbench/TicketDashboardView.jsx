import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Tag, Typography } from 'antd'
import ThemeBarChart from '../charts/ThemeBarChart.jsx'
import TrendChart from '../charts/TrendChart.jsx'
import JourneyFeedbackSection from '../JourneyFeedbackSection.jsx'
import SentimentDistributionPanel from '../SentimentDistributionPanel.jsx'
import SentimentExperiencePanel from '../SentimentExperiencePanel.jsx'
import WorkbenchScopeCompositeFilter from './WorkbenchScopeCompositeFilter.jsx'
import { useInsights } from '../../context/InsightsContext.jsx'
import { getTaxonomy } from '../../lib/productTaxonomy.js'
import { countByField, filterFeedbacks } from '../../lib/productAnalytics.js'
import {
  aggregateComplaintCauseL1Insights,
  countComplaintCauseL1,
} from '../../domain/complaintCause.js'
import { listProducts, listResourcePools } from '../../lib/productTaxonomy.js'
import { workbenchTicketRecords } from '../../snapshots/recordScope.js'
import { resolveCatalogKeyFromProductName } from '../../lib/wanTouRatio.js'
import { suggestImportMonth } from '../../domain/insightPeriod.js'
import {
  buildTicketWorkbenchDrillDownUrl,
  drillDownFieldParam,
} from '../../lib/feedbackFilters.js'
import WanTouRatioPanel from './WanTouRatioPanel.jsx'
import WorkbenchAnalysisHint from './WorkbenchAnalysisHint.jsx'
import {
  clearAllWorkbenchScopeFilters,
  createEmptyWorkbenchScopeFilters,
  WORKBENCH_TICKET_SCOPE_KEYS,
} from '../../lib/workbenchScopeFilterModel.js'

/**
 * @param {Object} props
 * @param {import('../../domain/snapshot.js').InsightSnapshot} props.snapshot
 * @param {string} props.sourceLabel
 * @param {string} [props.product]
 * @param {(value: string) => void} [props.onProductChange]
 * @param {boolean} [props.pdfCaptureMode] PDF 离屏截图：隐藏筛选栏等非图表 UI
 */
export default function TicketDashboardView({
  snapshot,
  sourceLabel,
  product: productProp,
  onProductChange,
  pdfCaptureMode = false,
}) {
  const { feedbacks, currentPeriod, orderVolumes, wanTouTargets } = useInsights()
  const items = useMemo(
    () => workbenchTicketRecords(feedbacks, currentPeriod, snapshot),
    [feedbacks, currentPeriod, snapshot],
  )

  const products = useMemo(() => listProducts(items), [items])
  const productControlled = onProductChange != null
  const [scopeFilters, setScopeFilters] = useState(() => ({
    ...createEmptyWorkbenchScopeFilters(),
    product: productProp ?? '',
  }))
  const product = scopeFilters.product
  const resourcePool = scopeFilters.resourcePool
  const complaintCauseL1 = scopeFilters.complaintCauseL1

  const applyProductChange = useCallback(
    (value) => {
      if (productControlled) {
        onProductChange?.(value)
      }
      setScopeFilters((prev) => ({ ...prev, product: value }))
    },
    [productControlled, onProductChange],
  )
  const [journeySel, setJourneySel] = useState({ l1: undefined, l2: undefined })
  const isComplaintSource = snapshot.dataSourceType === 'complaint_ticket'

  useEffect(() => {
    if (!productControlled) return
    setScopeFilters((prev) => ({ ...prev, product: productProp ?? '' }))
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
  const pools = useMemo(
    () => listResourcePools(items, product || undefined),
    [items, product],
  )

  const scoped = useMemo(
    () =>
      filterFeedbacks(items, {
        product: isAllProducts ? undefined : sectionProduct || undefined,
        resourcePool: resourcePool || undefined,
        complaintCauseL1: isComplaintSource ? complaintCauseL1 || undefined : undefined,
      }),
    [items, isAllProducts, sectionProduct, resourcePool, complaintCauseL1, isComplaintSource],
  )

  const taxonomy = getTaxonomy(sectionProduct)
  const drillDownBase = useMemo(
    () => ({
      source: snapshot.dataSourceType,
      month: suggestImportMonth(currentPeriod),
      product: product || undefined,
      complaintCauseL1:
        isComplaintSource && complaintCauseL1 ? complaintCauseL1 : undefined,
    }),
    [snapshot.dataSourceType, currentPeriod, product, isComplaintSource, complaintCauseL1],
  )
  const requestScenes = useMemo(
    () =>
      countByField(scoped, 'requestScene').map((d) => ({
        label: d.name,
        count: d.count,
        negative: 0,
      })),
    [scoped],
  )
  const problemTypes = useMemo(
    () =>
      countByField(scoped, 'problemType').map((d) => ({
        label: d.name,
        count: d.count,
        negative: 0,
      })),
    [scoped],
  )
  const complaintCauseChart = useMemo(() => {
    if (!isComplaintSource) return []
    return aggregateComplaintCauseL1Insights(scoped).map((d) => ({
      label: d.label,
      count: d.count,
      negative: d.negative,
    }))
  }, [scoped, isComplaintSource])
  const complaintCauseOptions = useMemo(
    () => (isComplaintSource ? countComplaintCauseL1(items) : []),
    [items, isComplaintSource],
  )

  const scopeFilterOptions = useMemo(
    () => ({
      productOptions: products.map((p) => ({
        label: `${p.name} (${p.count})`,
        value: p.name,
      })),
      resourcePoolOptions: pools.map((p) => ({
        label: `${p.name} (${p.count})`,
        value: p.name,
      })),
      complaintCauseOptions: complaintCauseOptions.map((t) => ({
        label: `${t.name} (${t.count})`,
        value: t.name,
      })),
    }),
    [products, pools, complaintCauseOptions],
  )

  const handleScopeFiltersChange = useCallback(
    (next, meta) => {
      setScopeFilters(next)
      if (meta?.key === 'product' && productControlled) {
        onProductChange?.(next.product)
      }
      setJourneySel({})
    },
    [productControlled, onProductChange],
  )

  const handleClearScopeFilters = useCallback(() => {
    setScopeFilters(clearAllWorkbenchScopeFilters(WORKBENCH_TICKET_SCOPE_KEYS))
    applyProductChange('')
    setJourneySel({})
  }, [applyProductChange])
  const scopeFilterHints = useMemo(() => {
    /** @type {string[]} */
    const hints = []
    if (complaintCauseL1) hints.push('已筛投诉原因（终判）')
    if (resourcePool) hints.push('已筛资源池')
    return hints
  }, [complaintCauseL1, resourcePool])

  const trendData = snapshot.aggregates?.monthlyTrend || []
  const latestMonth = trendData.at(-1)
  const previousMonth = trendData.at(-2)
  const monthDelta = latestMonth && previousMonth ? latestMonth.count - previousMonth.count : null

  if (!items.length) {
    return (
      <Card>
        <Typography.Text type="secondary">当前周期内暂无「{sourceLabel}」数据，请先导入。</Typography.Text>
      </Card>
    )
  }

  return (
    <div>
      {!pdfCaptureMode && (
        <WorkbenchAnalysisHint
          className="mb-4 !rounded-lg"
          sourceLabel={sourceLabel}
          product={product || undefined}
        />
      )}

      {!pdfCaptureMode && (
        <div className="mb-4 space-y-2">
          <WorkbenchScopeCompositeFilter
            preset="ticket"
            filters={scopeFilters}
            onFiltersChange={handleScopeFiltersChange}
            onClearFilters={handleClearScopeFilters}
            showComplaintCauseFilter={isComplaintSource}
            options={scopeFilterOptions}
          />
          <div className="flex flex-wrap items-center gap-2">
            {product && taxonomy.name ? <Tag color="blue">{taxonomy.name}</Tag> : null}
            <Typography.Text type="secondary" className="text-sm">
              周期内 {items.length} 条
              {isAllProducts ? ` · 全部产品 ${scoped.length} 条` : ` · 当前产品 ${scoped.length} 条`}
              {scopeFilterHints.length ? `（${scopeFilterHints.join(' · ')}）` : ''}
            </Typography.Text>
          </div>
        </div>
      )}

      {!pdfCaptureMode && snapshot.dataSourceType === 'complaint_ticket' && (
        <div className="page-section-sm">
          <WanTouRatioPanel
            period={currentPeriod}
            productName={isAllProducts ? undefined : sectionProduct}
            productKey={isAllProducts ? undefined : activeProductKey}
            productList={isAllProducts ? products : undefined}
            records={items}
            allRecords={feedbacks}
            orderVolumes={orderVolumes}
            wanTouTargets={wanTouTargets}
            variant={currentPeriod?.granularity === 'month' ? 'compact' : 'full'}
          />
        </div>
      )}

      <div className="page-section grid items-stretch gap-4 lg:grid-cols-2">
        <Card
          className="h-full"
          title={<Typography.Text strong>月度趋势</Typography.Text>}
          extra={
            latestMonth ? (
              <Typography.Text type="secondary" className="text-xs">
                {latestMonth.date}
                {monthDelta != null ? ` · 环比${monthDelta >= 0 ? '+' : ''}${monthDelta}` : ''}
              </Typography.Text>
            ) : null
          }
        >
          <div data-pdf-chart="source-trend" className="rounded-lg bg-white p-2">
            <TrendChart
              variant="line"
              data={trendData}
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

      {!isAllProducts && (
        <div className="page-section" data-pdf-chart="source-experience">
          <SentimentExperiencePanel items={scoped} />
        </div>
      )}

      {!isAllProducts && (
        <div className="page-section" data-pdf-chart="source-journey">
          <JourneyFeedbackSection
            items={scoped}
            taxonomy={taxonomy}
            productName={sectionProduct}
            dataSourceType={snapshot.dataSourceType}
            painPointClustering={snapshot.aggregates?.painPointClustering}
            journeySel={journeySel}
            onJourneySelect={(l1, l2) => setJourneySel({ l1, l2: l2 || undefined })}
          />
        </div>
      )}

      <div
        className={`page-section grid items-stretch gap-4 ${
          isComplaintSource ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}
      >
        <Card title={<Typography.Text strong>请求场景分布</Typography.Text>}>
          <div data-pdf-chart="source-request-scenes" className="rounded-lg bg-white p-2">
            <ThemeBarChart
              data={requestScenes}
              onBarClick={() => setJourneySel({})}
              buildFeedbacksHref={(label) =>
                buildTicketWorkbenchDrillDownUrl({
                  ...drillDownBase,
                  requestScene: drillDownFieldParam(label),
                })
              }
            />
          </div>
        </Card>
        {isComplaintSource && (
          <Card title={<Typography.Text strong>投诉原因（终判）分布</Typography.Text>}>
            <div data-pdf-chart="source-complaint-cause" className="rounded-lg bg-white p-2">
              <ThemeBarChart
                data={complaintCauseChart}
                onBarClick={(label) => {
                  setComplaintCauseL1(label)
                  setJourneySel({})
                }}
              />
            </div>
          </Card>
        )}
        <Card title={<Typography.Text strong>问题类型（打标）分布</Typography.Text>}>
          <div data-pdf-chart="source-problems" className="rounded-lg bg-white p-2">
            <ThemeBarChart
              data={problemTypes}
              onBarClick={() => setJourneySel({})}
              buildFeedbacksHref={(label) =>
                buildTicketWorkbenchDrillDownUrl({
                  ...drillDownBase,
                  problemType: drillDownFieldParam(label),
                })
              }
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
