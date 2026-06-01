import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import BarCountLabel from './BarCountLabel.jsx'
import CategoryAxisTick from './CategoryAxisTick.jsx'
import {
  HORIZONTAL_BAR_MAX_SIZE,
  HORIZONTAL_BAR_MIN_HEIGHT,
  horizontalBarChartHeight,
  horizontalBarChartLayout,
} from './chartConstants.js'

export default function ThemeBarChart({ data, onBarClick, activeLabel }) {
  const chartData = useMemo(
    () =>
      (data || []).slice(0, 10).map((t) => ({
        name: t.label,
        fullName: t.label,
        count: t.count,
        negativePct: t.count ? Math.round((t.negative / t.count) * 100) : 0,
      })),
    [data],
  )

  const layout = useMemo(
    () => horizontalBarChartLayout(chartData),
    [chartData],
  )

  const axisData = useMemo(
    () =>
      chartData.map((row) => ({
        ...row,
        name: layout.formatLabel(row.name),
      })),
    [chartData, layout],
  )

  if (!chartData.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-ink-400"
        style={{ height: HORIZONTAL_BAR_MIN_HEIGHT }}
      >
        暂无数据
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={horizontalBarChartHeight(chartData.length)}>
      <BarChart
        data={axisData}
        layout="vertical"
        margin={layout.margin}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
        <YAxis
          type="category"
          dataKey="name"
          width={layout.yAxisWidth}
          interval={0}
          tick={<CategoryAxisTick />}
        />
        <Tooltip
          contentStyle={{ borderRadius: 8, fontSize: 12 }}
          formatter={(value, _name, props) => [
            `${value} 条 (负面 ${props.payload.negativePct}%)`,
            props.payload.fullName,
          ]}
        />
        <Bar
          dataKey="count"
          fill="#6366F1"
          radius={[0, 4, 4, 0]}
          maxBarSize={HORIZONTAL_BAR_MAX_SIZE}
          cursor={onBarClick ? 'pointer' : 'default'}
          onClick={(d) => onBarClick?.(d.fullName)}
        >
          {axisData.map((entry) => (
            <Cell
              key={entry.fullName}
              fill={activeLabel === entry.fullName ? '#4338CA' : '#6366F1'}
            />
          ))}
          <BarCountLabel />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
