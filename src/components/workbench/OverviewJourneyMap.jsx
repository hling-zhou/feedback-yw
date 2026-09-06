import { useEffect, useMemo, useState } from 'react'
import { Card, Select, Segmented, Space, Typography } from 'antd'
import { listProducts } from '../../lib/productTaxonomy.js'
import { filterFeedbacks } from '../../lib/productAnalytics.js'
import {
  buildJourneyStages,
  collectOverviewJourneyRecordsForMonths,
  resolveJourneyComparisonWindow,
} from '../../lib/ticketStoryModel.js'
import TicketJourneyMap from './TicketJourneyMap.jsx'

const SOURCE_OPTIONS = [
  { label: '全部反馈', value: 'all' },
  { label: '投诉', value: 'complaint' },
  { label: '咨询', value: 'consultation' },
]

/**
 * 综合概述总旅程图：本地产品选择 + 来源切换，不写入快照。
 * 多月范围按当前旅程环节取月均，并与范围开始月的上一个月对比。
 */
export default function OverviewJourneyMap({ feedbacks = [], currentPeriod = null }) {
  const [product, setProduct] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const comparison = useMemo(() => resolveJourneyComparisonWindow(currentPeriod), [currentPeriod])
  const currentRecords = useMemo(
    () => collectOverviewJourneyRecordsForMonths(feedbacks, comparison.currentMonths),
    [feedbacks, comparison.currentMonths],
  )
  const previousRecords = useMemo(
    () => collectOverviewJourneyRecordsForMonths(feedbacks, comparison.previousMonths),
    [feedbacks, comparison.previousMonths],
  )
  const products = useMemo(() => listProducts(currentRecords), [currentRecords])

  useEffect(() => {
    if (product && !products.some((item) => item.name === product)) {
      setProduct('')
    }
  }, [product, products])

  const journeyModel = useMemo(() => {
    const current = product ? filterFeedbacks(currentRecords, { product }) : currentRecords
    const previous = product ? filterFeedbacks(previousRecords, { product }) : previousRecords
    return buildJourneyStages({
      currentRecords: current,
      previousRecords: previous,
      hasPreviousPeriod: comparison.previousMonths.length > 0 && comparison.currentMonths.length > 0,
      selectedProduct: product,
      sourceFilter,
      useMonthlyAverage: comparison.useMonthlyAverage,
      currentMonthCount: comparison.currentMonths.length,
    })
  }, [currentRecords, previousRecords, comparison, product, sourceFilter])

  return (
    <Card
      title="用户旅程"
      extra={
        <Typography.Text type="secondary" className="text-xs">
          投诉仅含客户体验类
          {comparison.useMonthlyAverage ? ` · 多月按月均，对比${comparison.previousLabel}` : ''}
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
        previousPeriodLabel={comparison.previousLabel}
        currentPeriodLabel={comparison.currentLabel}
        products={products}
        onProductChange={setProduct}
      />
    </Card>
  )
}
