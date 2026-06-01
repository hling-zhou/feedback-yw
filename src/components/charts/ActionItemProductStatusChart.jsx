import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ACTION_ITEM_STATUSES, ACTION_ITEM_STATUS_LABELS } from '../../domain/actionItem.js'
import { ACTION_ITEM_STATUS_CHART_COLORS } from '../../domain/actionItemStatusStyle.js'

/** @typedef {import('../../lib/actionItemClient.js').ActionItemProductStatusRow} ActionItemProductStatusRow */

/**
 * @param {ActionItemProductStatusRow[]} rows
 */
function buildChartData(rows) {
  return (rows || []).map((row) => ({
    productName: row.productName || row.productKey || '未标注产品',
    ...ACTION_ITEM_STATUSES.reduce(
      (acc, status) => {
        acc[status] = row.counts?.[status] ?? 0
        return acc
      },
      /** @type {Record<string, number>} */ ({}),
    ),
  }))
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
 * @param {ActionItemProductStatusRow[]} [props.data]
 */
export default function ActionItemProductStatusChart({ data }) {
  const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const chartData = useMemo(() => buildChartData(data), [data])
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
        <BarChart
          width={chartWidth}
          height={chartHeight}
          data={chartData}
          margin={{ top: 8, right: 12, left: 0, bottom: chartData.length > 6 ? 56 : 8 }}
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
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} width={36} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
            formatter={(value, name) => [
              `${value ?? 0} 条`,
              ACTION_ITEM_STATUS_LABELS[/** @type {keyof typeof ACTION_ITEM_STATUS_LABELS} */ (name)] ||
                name,
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value) =>
              ACTION_ITEM_STATUS_LABELS[/** @type {keyof typeof ACTION_ITEM_STATUS_LABELS} */ (value)] ||
              value
            }
          />
          {ACTION_ITEM_STATUSES.map((status) => (
            <Bar
              key={status}
              dataKey={status}
              name={status}
              fill={ACTION_ITEM_STATUS_CHART_COLORS[status]}
              maxBarSize={32}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      )}
    </div>
  )
}
