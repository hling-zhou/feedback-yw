import { useEffect, useMemo, useState } from 'react'
import { Card, Select, Segmented, Space, Typography } from 'antd'
import { listProducts } from '../../lib/productTaxonomy.js'
import { filterFeedbacks } from '../../lib/productAnalytics.js'
import {
  buildJourneyStages,
  collectOverviewJourneyRecords,
  monthsForInsightPeriod,
  periodComparisonColumnLabels,
} from '../../lib/ticketStoryModel.js'
import { resolvePreviousInsightPeriod } from '../../domain/insightPeriod.js'
import TicketJourneyMap from './TicketJourneyMap.jsx'

const SOURCE_OPTIONS = [
  { label: '全部反馈', value: 'all' },
  { label: '投诉', value: 'complaint' },
  { label: '咨询', value: 'consultation' },
]

/**
 * 综合概述总旅程图：本地产品选择 + 来源切换，不写入快照。
 */
export default function OverviewJourneyMap({ feedbacks = [], currentPeriod = null }) {
  const [product, setProduct] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const previousPeriod = useMemo(
    () => resolvePreviousInsightPeriod(currentPeriod),
    [currentPeriod],
  )
  const currentRecords = useMemo(
    () => collectOverviewJourneyRecords(feedbacks, currentPeriod),
    [feedbacks, currentPeriod],
  )
  const previousRecords = useMemo(() => {
    if (!previousPeriod || !monthsForInsightPeriod(previousPeriod).length) return []
    return collectOverviewJourneyRecords(feedbacks, previousPeriod)
  }, [feedbacks, previousPeriod])
  const products = useMemo(() => listProducts(currentRecords), [currentRecords])

  useEffect(() => {
    if (product && !products.some((item) => item.name === product)) {
      setProduct('')
    }
  }, [product, products])

  const comparisonLabels = periodComparisonColumnLabels(currentPeriod?.granularity)
  const journeyModel = useMemo(() => {
    const current = product ? filterFeedbacks(currentRecords, { product }) : currentRecords
    const previous = product ? filterFeedbacks(previousRecords, { product }) : previousRecords
    const currentMonths = monthsForInsightPeriod(currentPeriod)
    const previousMonths = monthsForInsightPeriod(previousPeriod)
    return buildJourneyStages({
      currentRecords: current,
      previousRecords: previous,
      hasPreviousPeriod: currentMonths.length > 0 && previousMonths.length > 0,
      selectedProduct: product,
      sourceFilter,
    })
  }, [currentRecords, previousRecords, currentPeriod, previousPeriod, product, sourceFilter])

  return (
    <Card
      title="用户旅程"
      extra={
        <Typography.Text type="secondary" className="text-xs">
          投诉仅含客户体验类
        </Typography.Text>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Space size={8} wrap>
          <Typography.Text strong>产品</Typography.Text>
          <Select
            showSearch
            allowClear
            optionFilterProp="label"
            className="min-w-[220px]"
            placeholder="选择一个产品"
            value={product || undefined}
            options={products.map((item) => ({ value: item.name, label: `${item.name} (${item.count})` }))}
            onChange={(value) => setProduct(value || '')}
          />
          <Segmented
            size="small"
            value={sourceFilter}
            options={SOURCE_OPTIONS}
            onChange={(value) => setSourceFilter(value)}
          />
        </Space>
      </div>
      <TicketJourneyMap
        layout={journeyModel.layout}
        stages={journeyModel.stages}
        highlights={journeyModel.highlights}
        sourceFilter={sourceFilter}
        selectedProduct={product}
        previousPeriodLabel={comparisonLabels.previous}
        currentPeriodLabel={comparisonLabels.current}
      />
    </Card>
  )
}
