import { useMemo, useState } from 'react'
import { Empty, Select, Space, Table, Tag, Typography } from 'antd'
import TrendChart from '../charts/TrendChart.jsx'
import { buildProductExperienceTrend } from '../../domain/workbenchProductTrends.js'
import { listProducts } from '../../lib/productTaxonomy.js'
import { getEnabledProducts } from '../../lib/productCatalogLoader.js'
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
 * 时间窗口锚定到当前选中月份（近 12 个月）。
 *
 * @param {Object} props
 * @param {FeedbackRecord[]} [props.feedbacks]
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null} [props.currentPeriod]
 * @param {string} [props.product] 与页面其他产品选择联动；空字符串表示全部产品
 * @param {(product: string) => void} [props.onProductChange]
 */
export default function ProductExperienceTrendPanel({
  feedbacks = [],
  currentPeriod = null,
  product: productProp,
  onProductChange,
  storedTrends = null,
}) {
  const enabledProducts = useMemo(() => getEnabledProducts(), [])
  const enabledNames = useMemo(() => new Set(enabledProducts.map((p) => p.name)), [enabledProducts])
  const productOptions = useMemo(() => {
    const seen = new Set()
    const options = listProducts(feedbacks)
      .filter((p) => enabledNames.has(p.name))
      .map((p) => ({ value: p.name, label: p.name }))
    for (const item of options) seen.add(item.value)
    for (const name of Object.keys(storedTrends || {})) {
      if (!name || seen.has(name)) continue
      if (enabledNames.size && !enabledNames.has(name)) continue
      options.push({ value: name, label: name })
      seen.add(name)
    }
    if (productProp && !options.some((item) => item.value === productProp)) {
      options.push({ value: productProp, label: productProp })
    }
    return options
  }, [feedbacks, enabledNames, productProp, storedTrends])
  const focusNames = useMemo(
    () => getPostUseFocusTrackedNames(enabledProducts),
    [enabledProducts],
  )

  const [selected, setSelected] = useState('')
  const controlled = onProductChange != null
  const productName = controlled
    ? (productProp || '')
    : (selected || focusNames.find((n) => productOptions.some((o) => o.value === n)) || focusNames[0] || productOptions[0]?.value || '')
  const setProduct = (value) => {
    const next = value || ''
    if (controlled) onProductChange(next)
    else setSelected(next)
  }

  const endMonth = useMemo(() => {
    if (!currentPeriod) return ''
    // month 粒度：anchorYear + anchorMonth → YYYY-MM
    if (currentPeriod.granularity === 'month' && currentPeriod.anchorYear && currentPeriod.anchorMonth) {
      return `${currentPeriod.anchorYear}-${String(currentPeriod.anchorMonth).padStart(2, '0')}`
    }
    // 其他粒度兜底：取 endDate 的 YYYY-MM
    if (currentPeriod.endDate) return currentPeriod.endDate.slice(0, 7)
    return ''
  }, [currentPeriod])

  const trend = useMemo(() => {
    const stored = productName && storedTrends?.[productName]
    if (stored && Array.isArray(stored.months)) return stored
    return buildProductExperienceTrend(feedbacks, productName, { limit: 12, endMonth })
  }, [feedbacks, productName, endMonth, storedTrends])

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
    <div className="page-card-sm"><div className="page-card-header"><span className="page-card-title">{
        <Space size={8} wrap>
          <Typography.Text strong>单产品体验趋势</Typography.Text>
          <Select
            showSearch
            allowClear={controlled}
            optionFilterProp="label"
            placeholder={controlled ? '全部产品' : '选择产品'}
            value={productName || undefined}
            options={productOptions}
            onChange={(value) => setProduct(value || '')}
            className="min-w-[180px]"
          />
        </Space>
      }</span></div>
      {!productName || !trend.hasAnyData ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={productName ? '该产品近 12 个月暂无数据' : '选择具体产品后查看体验趋势'}
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
    </div>
  )
}
