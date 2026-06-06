import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import ChartTooltip from './ChartTooltip.jsx'

/**
 * @param {Object} props
 * @param {Record<string, unknown>[]} props.data
 * @param {{ dataKey: string; name: string; stroke: string; fill?: string }[]} [props.areas]
 * @param {'area' | 'line'} [props.variant]
 * @param {boolean} [props.stacked] 仅 area 模式有效
 * @param {number} [props.height]
 */
export default function TrendChart({
  data,
  areas,
  variant = 'area',
  stacked = false,
  height = 220,
}) {
  if (!data?.length) {
    return <EmptyChart message="暂无趋势数据" height={height} />
  }

  const series = areas?.length
    ? areas
    : [{ dataKey: 'count', name: '反馈数', stroke: '#4F46E5', fill: 'url(#trendFill)' }]

  if (variant === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
          <ChartTooltip />
          <Legend wrapperStyle={{ fontSize: 12, lineHeight: '18px' }} />
          {series.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name}
              stroke={line.stroke}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: stacked ? 4 : 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366F1" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="trendNegativeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EF4444" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#EF4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
        <ChartTooltip />
        <Legend wrapperStyle={{ fontSize: 12, lineHeight: '18px' }} />
        {series.map((area) => (
          <Area
            key={area.dataKey}
            type="monotone"
            dataKey={area.dataKey}
            name={area.name}
            stroke={area.stroke}
            fill={stacked ? area.stroke : area.fill || area.stroke}
            fillOpacity={stacked ? 0.72 : 1}
            stackId={stacked ? 'stack' : undefined}
            strokeWidth={stacked ? 1 : 2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

function EmptyChart({ message, height = 220 }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-ink-400"
      style={{ height }}
    >
      {message}
    </div>
  )
}
