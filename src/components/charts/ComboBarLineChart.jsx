import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import ChartTooltip from './ChartTooltip.jsx'

/**
 * @typedef {{ dataKey: string, name: string, fill: string }} ComboBarSeries
 * @typedef {{ dataKey: string, name: string, stroke: string }} ComboLineSeries
 */

/**
 * 左轴柱 + 可选右轴折线。折线不连接空值，便于万投比在缺订单数时断开。
 *
 * @param {Object} props
 * @param {Record<string, unknown>[]} props.data
 * @param {ComboBarSeries[]} props.bars
 * @param {ComboLineSeries | null} [props.line]
 * @param {number} [props.height]
 * @param {{ y: number, label?: string } | null} [props.referenceLine]
 * @param {(value: unknown) => string} [props.lineTickFormatter]
 */
export default function ComboBarLineChart({
  data,
  bars,
  line = null,
  height = 260,
  referenceLine = null,
  lineTickFormatter = null,
}) {
  if (!data?.length) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-400" style={{ height }}>
        暂无趋势数据
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: line ? 12 : 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
        <YAxis
          yAxisId="count"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: '#6B7280' }}
          width={36}
        />
        {line ? (
          <YAxis
            yAxisId="line"
            orientation="right"
            allowDecimals
            tick={{ fontSize: 11, fill: '#0F766E' }}
            width={44}
            tickFormatter={lineTickFormatter || undefined}
          />
        ) : null}
        <ChartTooltip
          formatter={(value, name) => {
            if (line && name === line.name) {
              if (value == null || value === '') return ['—', name]
              const numeric = Number(value)
              return [Number.isFinite(numeric) ? String(numeric) : '—', name]
            }
            return [value ?? 0, name]
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, lineHeight: '18px' }} />
        {line && referenceLine && Number.isFinite(referenceLine.y) ? (
          <ReferenceLine
            yAxisId="line"
            y={referenceLine.y}
            stroke="#F59E0B"
            strokeDasharray="6 4"
            label={{
              value: referenceLine.label || `目标 ${referenceLine.y}`,
              position: 'insideTopRight',
              fill: '#B45309',
              fontSize: 11,
            }}
          />
        ) : null}
        {bars.map((bar) => (
          <Bar
            key={bar.dataKey}
            yAxisId="count"
            dataKey={bar.dataKey}
            name={bar.name}
            fill={bar.fill}
            maxBarSize={28}
            radius={[2, 2, 0, 0]}
          />
        ))}
        {line ? (
          <Line
            yAxisId="line"
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.stroke}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
