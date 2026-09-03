import { useMemo, useState } from 'react'
import { Card, Empty, Select, Space, Table, Tag, Typography } from 'antd'
import TrendChart from '../charts/TrendChart.jsx'
import { buildProductExperienceTrend } from '../../domain/workbenchProductTrends.js'
import { listProducts } from '../../lib/productTaxonomy.js'
import { getCatalogProducts } from '../../lib/productCatalogLoader.js'
import { getPostUseFocusTrackedNames } from '../../lib/productCatalog/postUseRatingProducts.js'

/** @typedef {import('../../lib/types.js').FeedbackRecord} FeedbackRecord */

const SERIES_COLORS = {
  complaint: '#DC2626',
  consultation: '#D97706',
  postUseScore: '#2563EB',
  satisfaction: '#059669',
}

/**
 * 单产品体验趋势：标准化叠加图（看相关性）+ 原值表（读绝对值）。
 *
 * @param {Object} props
 * @param {FeedbackRecord[]} [props.feedbacks]
 */
export default function ProductExperienceTrendPanel({ feedbacks = [] }) {
  const catalogProducts = useMemo(() => getCatalogProducts(), [])
  const productOptions = useMemo(
    () => listProducts(feedbacks).map((p) => ({ value: p.name, label: p.name })),
    [feedbacks],
  )
  const focusNames = useMemo(
    () => getPostUseFocusTrackedNames(catalogProducts),
    [catalogProducts],
  )

  const [selected, setSelected] = useState('')
  const productName =
    selected || focusNames.find((n) => productOptions.some((o) => o.value === n)) || focusNames[0] || productOptions[0]?.value || ''

  const trend = useMemo(
    () => buildProductExperienceTrend(feedbacks, productName, { limit: 12 }),
    [feedbacks, productName],
  )

  const chartData = useMemo(
    () =>
      trend.months.map((month) => {
        /** @type {Record<string, unknown>} */
        const row = { date: month }
        for (const s of trend.series) row[s.key] = s.normalized[month]
        return row
      }),
    [trend],
  )

  const chartAreas = useMemo(
    () =>
      trend.series.map((s) => ({
        dataKey: s.key,
        name: s.name,
        stroke: SERIES_COLORS[s.key] || '#6B7280',
      })),
    [trend],
  )

  const nameToSeries = useMemo(
    () => new Map(trend.series.map((s) => [s.name, s])),
    [trend],
  )

  const tooltipFormatter = (value, name, item) => {
    const s = nameToSeries.get(name)
    const month = item?.payload?.date
    if (!s || !month) return [String(value ?? '—'), name]
    const raw = s.raw[month]
    return [raw == null ? '—' : `${raw}${s.unit}`, s.name]
  }

  const tableColumns = useMemo(
    () => [
      { title: '月份', dataIndex: 'month', width: 100, fixed: 'left' },
      ...trend.series.map((s) => ({
        title: s.name,
        key: s.key,
        width: 120,
        render: (_, row) => {
          const v = s.raw[row.month]
          return v == null ? (
            <Typography.Text type="secondary">—</Typography.Text>
          ) : (
            <span>
              {v}
              <Typography.Text type="secondary" className="ml-0.5 text-xs">
                {s.unit}
              </Typography.Text>
            </span>
          )
        },
      })),
    ],
    [trend],
  )

  const tableData = useMemo(
    () => trend.months.map((month) => ({ key: month, month, ...Object.fromEntries(trend.series.map((s) => [s.key, s.raw[month]])) })),
    [trend],
  )

  return (
    <Card
      size="small"
      className="!border-ink-100"
      title={
        <Space size={8} wrap>
          <Typography.Text strong>单产品体验趋势</Typography.Text>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择产品"
            value={productName || undefined}
            options={productOptions}
            onChange={setSelected}
            className="min-w-[180px]"
          />
        </Space>
      }
    >
      {!productName || !trend.hasAnyData ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={productName ? '该产品近 12 个月暂无数据' : '请选择产品'}
          className="!my-6"
        />
      ) : (
        <div className="space-y-3">
          <Typography.Text type="secondary" className="block text-xs">
            各指标按自身区间归一到 0–100，看走势与相关性；hover 显示原值
          </Typography.Text>
          <TrendChart
            variant="line"
            height={260}
            data={chartData}
            areas={chartAreas}
            tooltipFormatter={tooltipFormatter}
          />
          <Space size={12} wrap className="!text-xs">
            {trend.series.map((s) => {
              const { min, max } = s.range
              return (
                <Tag key={s.key} className="!m-0 !text-xs" color={SERIES_COLORS[s.key]}>
                  {s.name}：{min == null || max == null ? '—' : `${min}–${max}${s.unit}`}
                </Tag>
              )
            })}
          </Space>
          <Table
            size="small"
            columns={tableColumns}
            dataSource={tableData}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </div>
      )}
    </Card>
  )
}
