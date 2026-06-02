import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from 'recharts'
import ChartTooltip from './ChartTooltip.jsx'

export default function TrendChart({ data, areas }) {
  if (!data?.length) {
    return <EmptyChart message="暂无趋势数据" />
  }

  const series = areas?.length
    ? areas
    : [{ dataKey: 'count', name: '反馈数', stroke: '#4F46E5', fill: 'url(#trendFill)' }]

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((area) => (
          <Area
            key={area.dataKey}
            type="monotone"
            dataKey={area.dataKey}
            name={area.name}
            stroke={area.stroke}
            fill={area.fill}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

function EmptyChart({ message }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-ink-400">{message}</div>
  )
}
