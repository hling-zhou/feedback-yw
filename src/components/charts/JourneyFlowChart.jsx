import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import ChartTooltip from './ChartTooltip.jsx'
import BarCountLabel from './BarCountLabel.jsx'
import CategoryAxisTick from './CategoryAxisTick.jsx'
import {
  HORIZONTAL_BAR_MAX_SIZE,
  horizontalBarChartHeight,
  horizontalBarChartLayout,
} from './chartConstants.js'

/**
 * @param {{ data: { name: string; fullName: string; count: number; negativePct: number }[]; selectedL1?: string; onSelect?: (l1: string) => void }}
 */
export default function JourneyFlowChart({ data, selectedL1, onSelect }) {
  if (!data?.length) {
    return <p className="py-8 text-center text-sm text-ink-400">暂无旅程数据</p>
  }

  const layout = horizontalBarChartLayout(data, { labelKey: 'name' })
  const axisData = data.map((row) => ({
    ...row,
    name: layout.formatLabel(row.name ?? row.fullName ?? ''),
  }))

  return (
    <ResponsiveContainer width="100%" height={horizontalBarChartHeight(data.length)}>
      <BarChart
        data={axisData}
        layout="vertical"
        margin={layout.margin}
        onClick={(state) => {
          if (state?.activePayload?.[0]?.payload?.fullName) {
            onSelect?.(state.activePayload[0].payload.fullName)
          }
        }}
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
        <ChartTooltip
          formatter={(value, _name, props) => [
            `${value} 条 · 负面 ${props.payload.negativePct}%`,
            props.payload.fullName,
          ]}
        />
        <Bar
          dataKey="count"
          fill="#6366F1"
          radius={[0, 4, 4, 0]}
          maxBarSize={HORIZONTAL_BAR_MAX_SIZE}
          cursor="pointer"
          opacity={0.9}
        >
          <BarCountLabel />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
