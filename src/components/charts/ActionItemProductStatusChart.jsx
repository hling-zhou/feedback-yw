import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  XAxis,
  YAxis,
} from 'recharts'
import ChartTooltip from './ChartTooltip.jsx'
import { ACTION_ITEM_STATUSES, ACTION_ITEM_STATUS_LABELS } from '../../domain/actionItem.js'
import { ACTION_ITEM_STATUS_CHART_COLORS } from '../../domain/actionItemStatusStyle.js'

/**
 * @typedef {{ productName?: string; productKey?: string; counts?: Record<string, number>; linkedFeedbackCounts?: Record<string, number>; total?: number; rate?: number }} ProductStatusChartRow
 */

/**
 * @param {ProductStatusChartRow[]} rows
 * @param {string[]} statuses
 */
export function buildProductStatusChartData(rows, statuses) {
  return (rows || []).map((row) => {
    const counts = row.counts || {}
    const total =
      row.total ??
      statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0)
    return {
      productName: row.productName || row.productKey || '未标注产品',
      rate: Number.isFinite(Number(row.rate)) ? Number(row.rate) : 0,
      total,
      ...statuses.reduce(
        (acc, status) => {
          acc[status] = counts[status] ?? 0
          acc[`${status}Feedback`] = row.linkedFeedbackCounts?.[status] ?? 0
          return acc
        },
        /** @type {Record<string, number>} */ ({}),
      ),
    }
  })
}

/**
 * @param {import('react').RefObject<HTMLElement | null>} ref
 * @param {number} fallback
 */
function useElementWidth(ref, fallback) {
  const [width, setWidth] = useState(fallback)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    const update = () => {
      const next = Math.floor(el.getBoundingClientRect().width)
      if (next > 0) setWidth(next)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}

/**
 * @param {Object} props
 * @param {ProductStatusChartRow[]} [props.data]
 * @param {string[]} [props.statuses]
 * @param {Record<string, string>} [props.statusLabels]
 * @param {Record<string, string>} [props.statusColors]
 * @param {string} [props.rateLabel]
 * @param {string} [props.countNoun]
 * @param {boolean} [props.showLinkedFeedback]
 */
export default function ActionItemProductStatusChart({
  data,
  statuses = ACTION_ITEM_STATUSES,
  statusLabels = ACTION_ITEM_STATUS_LABELS,
  statusColors = ACTION_ITEM_STATUS_CHART_COLORS,
  rateLabel = '完成率',
  countNoun = '条举措',
  showLinkedFeedback = true,
}) {
  const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const chartData = useMemo(() => buildProductStatusChartData(data, statuses), [data, statuses])
  const chartHeight = Math.min(360, Math.max(220, Math.max(chartData.length, 1) * 52 + 48))
  const chartWidth = useElementWidth(containerRef, 520)

  return (
    <div ref={containerRef} className="w-full min-w-0" style={{ minHeight: chartHeight }}>
      {chartData.length === 0 ? (
        <div
          className="flex items-center justify-center text-sm text-ink-400"
          style={{ height: chartHeight }}
        >
          暂无数据
        </div>
      ) : (
        <ComposedChart
          width={chartWidth}
          height={chartHeight}
          data={chartData}
          margin={{ top: 8, right: 44, left: 0, bottom: chartData.length > 6 ? 56 : 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
          <XAxis
            dataKey="productName"
            tick={{ fontSize: 11, fill: '#6B7280' }}
            interval={0}
            angle={chartData.length > 6 ? -24 : 0}
            textAnchor={chartData.length > 6 ? 'end' : 'middle'}
            height={chartData.length > 6 ? 56 : 32}
          />
          <YAxis
            yAxisId="count"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: '#6B7280' }}
            width={36}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: '#0F766E' }}
            width={40}
            tickFormatter={(value) => `${value}%`}
          />
          <ChartTooltip
            formatter={(value, name, item) => {
              if (name === 'rate') {
                return [`${value ?? 0}%`, rateLabel]
              }
              const status = String(name)
              const feedback = item?.payload?.[`${status}Feedback`] ?? 0
              const countText = `${value ?? 0} ${countNoun}`
              return [
                showLinkedFeedback ? `${countText}，关联反馈 ${feedback} 条` : countText,
                statusLabels[status] || status,
              ]
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value) =>
              value === 'rate' ? rateLabel : statusLabels[value] || value
            }
          />
          {statuses.map((status) => (
            <Bar
              key={status}
              yAxisId="count"
              dataKey={status}
              name={status}
              fill={statusColors[status] || '#94A3B8'}
              maxBarSize={32}
              radius={[2, 2, 0, 0]}
            />
          ))}
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="rate"
            name="rate"
            stroke="#0F766E"
            strokeWidth={2}
            dot={{ r: 3, fill: '#0F766E' }}
          />
        </ComposedChart>
      )}
    </div>
  )
}
