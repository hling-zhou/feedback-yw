import { useEffect, useMemo, useState } from 'react'
import { Card, Form, Select, Tag, Typography } from 'antd'
import ThemeBarChart from '../charts/ThemeBarChart.jsx'
import TrendChart from '../charts/TrendChart.jsx'
import JourneyFeedbackSection from '../JourneyFeedbackSection.jsx'
import SentimentDistributionPanel from '../SentimentDistributionPanel.jsx'
import SentimentExperiencePanel from '../SentimentExperiencePanel.jsx'
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
import WanTouRatioPanel from './WanTouRatioPanel.jsx'
import WorkbenchAnalysisHint from './WorkbenchAnalysisHint.jsx'

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
  const { feedbacks, currentPeriod, orderVolumes } = useInsights()
  const items = useMemo(
    () => workbenchTicketRecords(feedbacks, currentPeriod, snapshot),
    [feedbacks, currentPeriod, snapshot],
  )

  const products = useMemo(() => listProducts(items), [items])
  /** 工单 Tab 仅分产品呈现：默认选中第一个产品，不提供「全部产品」 */
  const [internalProduct, setInternalProduct] = useState('')
  const productControlled = onProductChange != null
  const product = productControlled ? productProp ?? '' : internalProduct
  const setProduct = productControlled ? onProductChange : setInternalProduct
  const [resourcePool, setResourcePool] = useState('')
  const [complaintCauseL1, setComplaintCauseL1] = useState('')
  const [journeySel, setJourneySel] = useState({ l1: undefined, l2: undefined })
  const isComplaintSource = snapshot.dataSourceType === 'complaint_ticket'

  useEffect(() => {
    if (!products.length) {
      if (product) setProduct('')
      return
    }
    const next = products.some((p) => p.name === product) ? product : products[0].name
    if (next && next !== product) setProduct(next)
  }, [products, product, setProduct])

  const taxonomyProduct = product || products[0]?.name || ''
  const activeProductKey = useMemo(
    () => resolveCatalogKeyFromProductName(taxonomyProduct),
    [taxonomyProduct],
  )
  const pools = useMemo(
    () => listResourcePools(items, product || undefined),
    [items, product],
  )

  const scoped = useMemo(
    () =>
      filterFeedbacks(items, {
        product: taxonomyProduct || undefined,
        resourcePool: resourcePool || undefined,
        complaintCauseL1: isComplaintSource ? complaintCauseL1 || undefined : undefined,
      }),
    [items, taxonomyProduct, resourcePool, complaintCauseL1, isComplaintSource],
  )

  const taxonomy = getTaxonomy(taxonomyProduct)
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
          product={taxonomyProduct || undefined}
        />
      )}

      {!pdfCaptureMode && (
      <Form className="flex flex-wrap items-end gap-4" layout="vertical">
        <Form.Item label="产品" className="!mb-0">
          <Select
            className="min-w-[220px]"
            value={product || undefined}
            placeholder="请选择产品"
            options={products.map((p) => ({
              label: `${p.name} (${p.count})`,
              value: p.name,
            }))}
            onChange={(value) => {
              setProduct(value)
              setResourcePool('')
              setComplaintCauseL1('')
              setJourneySel({})
            }}
          />
        </Form.Item>
        {isComplaintSource && (
          <Form.Item label="投诉原因（终判）" className="!mb-0">
            <Select
              className="min-w-[200px]"
              value={complaintCauseL1}
              options={[
                { label: '全部一级（终判）', value: '' },
                ...complaintCauseOptions.map((t) => ({
                  label: `${t.name} (${t.count})`,
                  value: t.name,
                })),
              ]}
              onChange={(value) => {
                setComplaintCauseL1(value)
                setJourneySel({})
              }}
            />
          </Form.Item>
        )}
        <Form.Item label="资源池" className="!mb-0">
          <Select
            className="min-w-[200px]"
            value={resourcePool}
            options={[
              { label: '全部资源池', value: '' },
              ...pools.map((p) => ({ label: `${p.name} (${p.count})`, value: p.name })),
            ]}
            onChange={(value) => {
              setResourcePool(value)
              setJourneySel({})
            }}
          />
        </Form.Item>
        {taxonomy.name && (
          <Tag color="blue" className="mb-1">
            {taxonomy.name}
          </Tag>
        )}
        <Typography.Text type="secondary" className="mb-1 text-sm">
          周期内 {items.length} 条 · 当前产品 {scoped.length} 条
          {resourcePool ? '（已筛资源池）' : ''}
        </Typography.Text>
      </Form>
      )}

      {!pdfCaptureMode && snapshot.dataSourceType === 'complaint_ticket' && (
        <div className="page-section-sm">
          <WanTouRatioPanel
            period={currentPeriod}
            productName={taxonomyProduct}
            productKey={activeProductKey}
            records={items}
            allRecords={feedbacks}
            orderVolumes={orderVolumes}
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
              data={trendData}
              areas={[
                { dataKey: 'count', name: '工单总数', stroke: '#4F46E5', fill: 'url(#trendFill)' },
                { dataKey: 'negative', name: '负面工单', stroke: '#EF4444', fill: 'url(#trendNegativeFill)' },
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

      <div className="page-section" data-pdf-chart="source-experience">
        <SentimentExperiencePanel items={scoped} />
      </div>

      <div className="page-section" data-pdf-chart="source-journey">
        <JourneyFeedbackSection
          items={scoped}
          taxonomy={taxonomy}
          productName={taxonomyProduct}
          dataSourceType={snapshot.dataSourceType}
          painPointClustering={snapshot.aggregates?.painPointClustering}
          journeySel={journeySel}
          onJourneySelect={(l1, l2) => setJourneySel({ l1, l2: l2 || undefined })}
        />
      </div>

      <div
        className={`page-section grid items-stretch gap-4 ${
          isComplaintSource ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}
      >
        <Card title={<Typography.Text strong>请求场景分布</Typography.Text>}>
          <div data-pdf-chart="source-request-scenes" className="rounded-lg bg-white p-2">
            <ThemeBarChart data={requestScenes} onBarClick={() => setJourneySel({})} />
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
            <ThemeBarChart data={problemTypes} onBarClick={() => setJourneySel({})} />
          </div>
        </Card>
      </div>
    </div>
  )
}
