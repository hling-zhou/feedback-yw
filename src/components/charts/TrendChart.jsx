import {
  Area,
  AreaChart,
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

/**
 * 把 YYYY-MM / YYYY-MM-DD / 时间戳解析为毫秒。无法解析返回 NaN。
 * @param {unknown} value
 */
export function parseChartXToTs(value) {
  if (value == null || value === '') return Number.NaN
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00`)
  if (/^\d{4}-\d{2}$/.test(s)) return Date.parse(`${s}-01T00:00:00`)
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN
}

function formatTsTick(ts) {
  if (!Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function formatTsLabel(ts) {
  if (!Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * @param {Object} props
 * @param {Record<string, unknown>[]} props.data
 * @param {{ dataKey: string; name: string; stroke: string; fill?: string }[]} [props.areas]
 * @param {'area' | 'line'} [props.variant]
 * @param {boolean} [props.stacked] 仅 area 模式有效
 * @param {number} [props.height]
 * @param {boolean} [props.allowDecimals]
 * @param {'category' | 'time'} [props.xType]
 *        time：X 轴按日历时间，参考线可落在月内某天（工单量仍按月点）
 * @param {{ y?: number; x?: string | number; label?: string; stroke?: string; strokeDasharray?: string } | null} [props.referenceLine]
 *        y=水平基准线；x=X 轴某值处的垂直线（月份或 YYYY-MM-DD）
 * @param {{ x?: string | number; label?: string; stroke?: string; strokeDasharray?: string }[]} [props.referenceLines]
 *        多条垂直参考线（如同一问题上多个举措的实施日）
 */
export default function TrendChart({
  data,
  areas,
  variant = 'area',
  stacked = false,
  height = 220,
  allowDecimals = false,
  xType = 'category',
  referenceLine = null,
  referenceLines = null,
  tooltipFormatter = null,
  tooltipLabelFormatter = null,
}) {
  if (!data?.length) {
    return <EmptyChart message="暂无趋势数据" height={height} />
  }

  const series = areas?.length
    ? areas
    : [{ dataKey: 'count', name: '反馈数', stroke: '#4F46E5', fill: 'url(#trendFill)' }]

  const timeScale = xType === 'time'
  const chartData = timeScale
    ? data.map((row) => ({ ...row, ts: parseChartXToTs(row.ts ?? row.date) }))
    : data

  const resolveRefX = (x) => (timeScale ? parseChartXToTs(x) : x)
  const refXs = []
  if (referenceLine?.x != null && String(referenceLine.x) !== '') refXs.push(resolveRefX(referenceLine.x))
  if (Array.isArray(referenceLines)) {
    for (const r of referenceLines) {
      if (r?.x != null && String(r.x) !== '') refXs.push(resolveRefX(r.x))
    }
  }
  const timeDomain = (() => {
    if (!timeScale) return null
    const values = [
      ...chartData.map((row) => Number(row.ts)),
      ...refXs.map((x) => Number(x)),
    ].filter(Number.isFinite)
    if (!values.length) return ['auto', 'auto']
    const min = Math.min(...values)
    const max = Math.max(...values)
    if (min === max) return [min - 15 * 86400000, max + 15 * 86400000]
    return [min, max]
  })()

  const refs = []
  if (referenceLine && Number.isFinite(referenceLine.y)) {
    refs.push(
      <ReferenceLine
        key="ref-y"
        y={referenceLine.y}
        stroke={referenceLine.stroke || '#F59E0B'}
        strokeDasharray={referenceLine.strokeDasharray || '6 4'}
        label={{
          value: referenceLine.label || `基准 ${referenceLine.y}`,
          position: 'insideTopRight',
          fill: '#B45309',
          fontSize: 11,
        }}
      />,
    )
  }
  if (referenceLine && referenceLine.x != null && String(referenceLine.x) !== '') {
    const x = resolveRefX(referenceLine.x)
    if (!timeScale || Number.isFinite(x)) {
      refs.push(
        <ReferenceLine
          key="ref-x"
          x={timeScale ? x : String(referenceLine.x)}
          stroke={referenceLine.stroke || '#F59E0B'}
          strokeDasharray={referenceLine.strokeDasharray || '6 4'}
          label={{
            value: referenceLine.label || String(referenceLine.x),
            position: 'insideTopRight',
            fill: '#B45309',
            fontSize: 11,
          }}
        />,
      )
    }
  }
  if (Array.isArray(referenceLines)) {
    referenceLines.forEach((r, idx) => {
      if (!r || r.x == null || String(r.x) === '') return
      const x = resolveRefX(r.x)
      if (timeScale && !Number.isFinite(x)) return
      refs.push(
        <ReferenceLine
          key={`ref-x-${idx}-${r.x}`}
          x={timeScale ? x : String(r.x)}
          stroke={r.stroke || '#F59E0B'}
          strokeDasharray={r.strokeDasharray || '6 4'}
          label={{
            value: r.label || String(r.x),
            position: 'insideTopRight',
            fill: '#B45309',
            fontSize: 11,
          }}
        />,
      )
    })
  }
  const ref = refs.length ? refs : null
  const xAxis = timeScale ? (
    <XAxis
      dataKey="ts"
      type="number"
      scale="time"
      domain={timeDomain || ['auto', 'auto']}
      tickFormatter={formatTsTick}
      tick={{ fontSize: 11, fill: '#6B7280' }}
    />
  ) : (
    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
  )
  const resolvedLabelFormatter =
    tooltipLabelFormatter || (timeScale ? (label) => formatTsLabel(Number(label)) : undefined)

  if (variant === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          {xAxis}
          <YAxis allowDecimals={allowDecimals} tick={{ fontSize: 11, fill: '#6B7280' }} />
          <ChartTooltip formatter={tooltipFormatter || undefined} labelFormatter={resolvedLabelFormatter} />
          <Legend wrapperStyle={{ fontSize: 12, lineHeight: '18px' }} />
          {ref}
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
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: stacked ? 4 : 0 }}>
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
        {xAxis}
        <YAxis allowDecimals={allowDecimals} tick={{ fontSize: 11, fill: '#6B7280' }} />
        <ChartTooltip formatter={tooltipFormatter || undefined} labelFormatter={resolvedLabelFormatter} />
        <Legend wrapperStyle={{ fontSize: 12, lineHeight: '18px' }} />
        {ref}
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
