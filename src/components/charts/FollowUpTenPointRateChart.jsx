import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import ChartTooltip from './ChartTooltip.jsx'
import { TEN_POINT_SATISFACTION_BASELINE } from '../../lib/followUpSatisfactionAnalytics.js'

/**
 * 10 分满意率月度趋势：多产品折线 + 88% 参考线。
 *
 * @param {Object} props
 * @param {Record<string, unknown>[]} props.data
 * @param {{ dataKey: string; name: string; stroke: string }[]} props.lines
 */
export default function FollowUpTenPointRateChart({ data, lines }) {
  const baselinePct = Math.round(TEN_POINT_SATISFACTION_BASELINE * 1000) / 10

  if (!data?.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-ink-400">
        暂无趋势数据
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: '#6B7280' }}
        />
        <ChartTooltip
          formatter={(value, name) => [
            value != null ? `${value}%` : '—',
            name,
          ]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine
          y={baselinePct}
          stroke="#94A3B8"
          strokeDasharray="6 4"
          label={{
            value: `${baselinePct}% 基线`,
            position: 'insideTopRight',
            fill: '#64748B',
            fontSize: 11,
          }}
        />
        {(lines || []).map((line) => (
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
