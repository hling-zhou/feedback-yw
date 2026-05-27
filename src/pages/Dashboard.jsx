import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Empty, Form, Select, Tag, Typography } from 'antd'
import { useFeedbacks } from '../context/FeedbackContext.jsx'
import { usePeriodScope } from '../hooks/usePeriodScope.js'
import ThemeBarChart from '../components/charts/ThemeBarChart.jsx'
import TrendChart from '../components/charts/TrendChart.jsx'
import JourneyFeedbackSection from '../components/JourneyFeedbackSection.jsx'
import ProductDrillDown from '../components/ProductDrillDown.jsx'
import SentimentDistributionPanel from '../components/SentimentDistributionPanel.jsx'
import { PageHeader } from './Dashboard.shared.jsx'
import { listProducts, listResourcePools, getTaxonomy } from '../lib/productTaxonomy.js'
import { countByField, filterFeedbacks } from '../lib/productAnalytics.js'
import { monthlyTrend } from '../lib/analytics.js'

export default function Dashboard() {
  const { feedbacks } = useFeedbacks()
  const { periodFeedbacks, periodCount, period } = usePeriodScope()
  const products = useMemo(() => listProducts(periodFeedbacks), [periodFeedbacks])

  const [product, setProduct] = useState('')
  const [resourcePool, setResourcePool] = useState('')
  const [journeySel, setJourneySel] = useState({ l1: undefined, l2: undefined })

  const taxonomyProduct = product || products[0]?.name || ''
  const pools = useMemo(
    () => listResourcePools(periodFeedbacks, product || undefined),
    [periodFeedbacks, product],
  )

  const scoped = useMemo(
    () =>
      filterFeedbacks(periodFeedbacks, {
        product: product || undefined,
        resourcePool: resourcePool || undefined,
      }),
    [periodFeedbacks, product, resourcePool],
  )

  const drillItems = useMemo(
    () =>
      filterFeedbacks(scoped, {
        journeyL1: journeySel.l1,
        journeyL2: journeySel.l2,
      }),
    [scoped, journeySel],
  )

  const taxonomy = getTaxonomy(taxonomyProduct)
  const problemTypes = useMemo(
    () => countByField(scoped, 'problemType').map((d) => ({ label: d.name, count: d.count, negative: 0 })),
    [scoped],
  )
  const trendData = useMemo(() => monthlyTrend(scoped, { basis: 'importMonth', limit: 12 }), [scoped])
  const latestMonth = trendData.at(-1)
  const previousMonth = trendData.at(-2)
  const monthDelta = latestMonth && previousMonth ? latestMonth.count - previousMonth.count : null

  if (feedbacks.length === 0) {
    return (
      <div>
        <PageHeader title="产品仪表盘" desc="分产品查看工单打标、用户旅程与根因优化" />
        <Card className="mt-8">
          <Empty
            className="py-10"
            description="暂无数据"
          >
            <Link to="/import">
              <Button type="primary">导入工单</Button>
            </Link>
          </Empty>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="产品仪表盘"
        desc={`基于处理意见自动打标 · 周期内 ${periodCount} 条${period ? `（${period.label}）` : ''}`}
      />

      <Form className="mt-6 flex flex-wrap items-end gap-4" layout="vertical">
        <Form.Item label="产品" className="!mb-0">
          <Select
            className="min-w-[220px]"
            value={product}
            options={[
              { label: `全部产品 (${periodCount})`, value: '' },
              ...products.map((p) => ({
                label: `${p.name} (${p.count})`,
                value: p.name,
              })),
            ]}
            onChange={(value) => {
              setProduct(value)
              setResourcePool('')
              setJourneySel({})
            }}
          />
        </Form.Item>
        <Form.Item label="资源池（联动筛选）" className="!mb-0">
          <Select
            className="min-w-[200px]"
            value={resourcePool}
            options={[
              { label: '全部资源池', value: '' },
              ...pools
                .filter((p) => p.name !== '未标注资源池')
                .map((p) => ({
                  label: `${p.name} (${p.count})`,
                  value: p.name,
                })),
            ]}
            onChange={(value) => {
              setResourcePool(value)
              setJourneySel({})
            }}
          />
        </Form.Item>
        {taxonomy.name && (
          <Tag color="blue" className="mb-1">
            旅程模板：{taxonomy.name}（{taxonomy.journeys.length} 个一级环节，按产品独立）
          </Tag>
        )}
        <Typography.Text type="secondary" className="mb-1 text-sm">
          周期内 {periodCount} 条
          {product || resourcePool ? (
            <>
              {' '}
              · 当前筛选 <span className="font-semibold text-ink-900">{scoped.length}</span> 条
              {resourcePool ? ` · ${resourcePool}` : product ? ` · ${product}` : ''}
            </>
          ) : null}
        </Typography.Text>
      </Form>

      <div className="mt-6 grid items-stretch gap-6 lg:grid-cols-2">
        <Card
          className="h-full"
          title={<Typography.Text strong>月度趋势洞察</Typography.Text>}
          extra={
          latestMonth ? (
            <Typography.Text type="secondary" className="text-xs">
              最新月份 {latestMonth.date} · {monthDelta == null ? '暂无环比' : `环比${monthDelta >= 0 ? '+' : ''}${monthDelta}`}
            </Typography.Text>
          ) : null
          }
        >
        <TrendChart
          data={trendData}
          areas={[
            { dataKey: 'count', name: '工单总数', stroke: '#4F46E5', fill: 'url(#trendFill)' },
            { dataKey: 'negative', name: '负面工单', stroke: '#EF4444', fill: 'url(#trendNegativeFill)' },
          ]}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Typography.Text type="secondary" className="text-xs">
            按导入时填写的“数据月份”统计，适合月度批量导入后的历史对比。
          </Typography.Text>
          {latestMonth && (
            <Typography.Text type="secondary" className="text-xs">
              最新负面占比：{latestMonth.negativePct}%
            </Typography.Text>
          )}
        </div>
      </Card>

        <SentimentDistributionPanel
          className="h-full"
          items={scoped}
          subtitle={`${scoped.length} 条工单 · 基于客户原话/问题摘要`}
        />
      </div>

      <div className="mt-6">
        <JourneyFeedbackSection
          items={scoped}
          taxonomy={taxonomy}
          productName={taxonomyProduct}
          journeySel={journeySel}
          onJourneySelect={(l1, l2) => setJourneySel({ l1, l2: l2 || undefined })}
        />
      </div>

      <Card className="mt-6" title={<Typography.Text strong>通用问题类型分布</Typography.Text>}>
        <ThemeBarChart data={problemTypes} onBarClick={() => setJourneySel({})} />
      </Card>

      <div className="mt-6">
        <ProductDrillDown
          items={journeySel.l1 ? drillItems : scoped.slice(0, 20)}
          journeyL1={journeySel.l1}
          journeyL2={journeySel.l2}
          onClose={journeySel.l1 ? () => setJourneySel({}) : undefined}
        />
      </div>
    </div>
  )
}
