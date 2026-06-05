import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Typography } from 'antd'
import ChartTooltip from './ChartTooltip.jsx'
import BarCountLabel from './BarCountLabel.jsx'

/**
 * 非 10 分 · 得分分布（1–9 分，≤5 标红），按产品分块展示。
 *
 * @param {Object} props
 * @param {import('../../lib/followUpSatisfactionAnalytics.js').FollowUpScoreDistributionRow[]} props.rows
 */
export default function FollowUpScoreDistributionChart({ rows }) {
  if (!rows?.length) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-ink-400">
        暂无非 10 分回访数据
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {rows.map((row) => {
        const chartData = Array.from({ length: 9 }, (_, i) => {
          const score = String(i + 1)
          return {
            score,
            count: row.scores[score] || 0,
            low: i + 1 <= 5,
          }
        })

        return (
          <div key={row.productKey}>
            <div className="mb-1 flex flex-wrap items-baseline gap-2">
              <Typography.Text strong>{row.productName}</Typography.Text>
              <Typography.Text type="secondary" className="text-xs">
                非 10 分 {row.nonTenTotal} 条
                {row.lowScoreCount > 0 ? ` · ≤5 分 ${row.lowScoreCount} 条` : ''}
              </Typography.Text>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="score" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                <ChartTooltip formatter={(value) => [`${value} 条`, '条数']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={36}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.score}
                      fill={entry.low ? '#EF4444' : '#6366F1'}
                    />
                  ))}
                  <BarCountLabel />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      })}
    </div>
  )
}
