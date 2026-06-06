import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { SENTIMENT_CHART_COLORS } from '../../lib/sentiment.js'
import BarCountLabel from './BarCountLabel.jsx'
import CategoryAxisTick from './CategoryAxisTick.jsx'
import ChartTooltip from './ChartTooltip.jsx'
import {
  HORIZONTAL_BAR_MAX_SIZE,
  HORIZONTAL_BAR_MIN_HEIGHT,
  horizontalBarChartHeight,
  horizontalBarChartLayout,
} from './chartConstants.js'

/** 条末「数量（占比%）」比纯数字需要更多右侧留白 */
const PCT_LABEL_MARGIN_EXTRA = 40

/**
 * @param {{ data: { name: string; value: number; key: string; pct?: number }[]; total?: number }}
 */
export default function SentimentChart({ data, total }) {
  const chartData = (data || []).map((d) => ({
    name: d.name,
    count: d.value,
    pct: d.pct ?? 0,
    key: d.key,
  }))

  if (!chartData.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-ink-400"
        style={{ height: HORIZONTAL_BAR_MIN_HEIGHT }}
      >
        暂无情绪数据
      </div>
    )
  }

  const sum = total ?? chartData.reduce((s, d) => s + d.count, 0)
  const layout = horizontalBarChartLayout(chartData, { fontSize: 11 })
  const margin = {
    ...layout.margin,
    right: layout.margin.right + PCT_LABEL_MARGIN_EXTRA,
  }
  const axisData = chartData.map((row) => ({
    ...row,
    name: layout.formatLabel(row.name),
  }))

  return (
    <ResponsiveContainer width="100%" height={horizontalBarChartHeight(chartData.length)}>
      <BarChart data={axisData} layout="vertical" margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
        <YAxis
          type="category"
          dataKey="name"
          width={layout.yAxisWidth}
          interval={0}
          tick={<CategoryAxisTick fontSize={11} />}
        />
        <ChartTooltip
          formatter={(value, _name, props) => {
            const pct = sum ? Math.round((Number(value) / sum) * 100) : props.payload.pct
            return [`${value} 条（${pct}%）`, props.payload.name]
          }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={HORIZONTAL_BAR_MAX_SIZE}>
          {chartData.map((entry) => (
            <Cell key={entry.key} fill={SENTIMENT_CHART_COLORS[entry.key] || '#9CA3AF'} />
          ))}
          <BarCountLabel
            formatLabel={(num, entry) => {
              const pct =
                entry?.payload?.pct ??
                (sum ? Math.round((Number(num) / sum) * 100) : 0)
              return `${num}（${pct}%）`
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
