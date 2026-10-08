import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import ChartTooltip from './ChartTooltip.jsx'

/**
 * 分类计数柱状图。类目较多时倾斜标签。
 *
 * @param {Object} props
 * @param {{ name: string, count: number, sharePct?: number }[]} props.data
 * @param {number} [props.height]
 */
export default function CategoryCountBarChart({ data, height = 260 }) {
  if (!data?.length) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-400" style={{ height }}>
        暂无分布数据
      </div>
    )
  }

  const tilt = data.length > 4

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: tilt ? 24 : 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
        <XAxis
          dataKey="name"
          interval={0}
          tick={{ fontSize: 11, fill: '#6B7280' }}
          angle={tilt ? -24 : 0}
          textAnchor={tilt ? 'end' : 'middle'}
          height={tilt ? 56 : 32}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} width={36} />
        <ChartTooltip
          formatter={(value, _name, item) => {
            const share = item?.payload?.sharePct
            const countText = `${value ?? 0}`
            return [share == null ? countText : `${countText}（${share}%）`, '工单量']
          }}
        />
        <Bar dataKey="count" name="工单量" fill="#4F46E5" maxBarSize={36} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
