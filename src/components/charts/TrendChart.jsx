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
import { Tooltip } from 'antd'
import ChartTooltip from './ChartTooltip.jsx'

/**
 * 竖线状态色（S1 方案 11-25 拍板）：角标与竖线按当月举措构成着色——
 * done 全部完成(绿) / mixed 混合(橙) / pending 全未完成(灰) / overdue 含逾期(红)。
 */
const REF_TONE_COLORS = {
  done: '#16A34A',
  mixed: '#F59E0B',
  pending: '#6B7280',
  overdue: '#DC2626',
}

/** tone 缺省（旧调用方/无状态投影）回退既有橙色形态 */
function resolveRefToneColor(tone, fallback = '#F59E0B') {
  return REF_TONE_COLORS[tone] ?? fallback
}

/**
 * tooltip 分条渲染（11-26 真机反馈）：领域层 tooltip 是 `${month} 实施 N 项：\n明细…` 的换行串，
 * 纯文本 title 会被 HTML 折叠成一段——这里拆成标题行 + 逐条明细（先例 PostUseStoryView 多行 Tooltip）。
 * @param {string | undefined} tooltip
 * @param {number} badge
 * @returns {import('react').ReactNode}
 */
function renderRefTooltip(tooltip, badge) {
  const text = String(tooltip ?? '').trim()
  if (!text) return `${badge} 项举措`
  const [head, ...lines] = text.split('\n')
  if (!lines.length || !lines.some(Boolean)) return head || `${badge} 项举措`
  return (
    <div>
      <div className="mb-1 font-medium">{head}</div>
      <div className="flex flex-col gap-0.5">
        {lines.filter(Boolean).map((line, i) => (
          <div key={i} className="whitespace-pre-line break-words">{line}</div>
        ))}
      </div>
    </div>
  )
}

/**
 * 竖线顶部数量角标（问题压降图同月多举措合并后使用，2026-11-25 重叠治理；
 * 11-25 晚两轮真机反馈修复：①角标画在 plot 顶上方会被 SVG 边界裁掉 → 改画 plot 内侧顶部；
 * ②原生 <title> hover 是浏览器默认样式体验差 → 换系统内统一 antd Tooltip 气泡
 * （先例 CompositeFilter.jsx / DefinitionSelectOption.jsx 同款）；
 * ③角标/竖线按状态构成着色（done 绿/mixed 橙/pending 灰/overdue 红）；
 * ④tooltip 分条渲染（11-26 真机反馈：一整段无分行 → 标题行+逐条明细）。
 * recharts ReferenceLine label content 拿到的 props.viewBox 含线两端点 (x1,y1)(x2,y2)：
 * y1 = plot 顶部 y 坐标，角标贴其内侧往下画，永不越出 SVG 可视区。
 * @param {{ viewBox?: { x?: number; y?: number; height?: number }; badge?: number; tooltip?: string; tone?: string }} props
 */
function RefLineBadge(props) {
  const { viewBox, badge, tooltip, tone } = props
  if (!viewBox || !Number.isFinite(viewBox.x) || badge == null) return null
  const x = viewBox.x
  const y = (viewBox.y ?? 0) + 2
  const text = String(badge)
  const w = Math.max(18, 10 + text.length * 7)
  const color = resolveRefToneColor(tone)
  return (
    <g transform={`translate(${x - w / 2}, ${y})`}>
      <Tooltip
        title={renderRefTooltip(tooltip, badge)}
        mouseEnterDelay={0.15}
        styles={{ root: { maxWidth: 360 } }}
      >
        {/* 角标本体 + 透明命中区：hover 角标/竖线即出 antd 气泡 */}
        <g>
          <rect x={0} y={0} width={w} height={16} rx={8} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={1} />
          <text x={w / 2} y={11.5} textAnchor="middle" fontSize={10} fill={tone === 'done' ? '#15803D' : tone === 'overdue' ? '#B91C1C' : tone === 'pending' ? '#4B5563' : '#B45309'}>{text}</text>
          <rect x={0} y={16} width={w} height={(viewBox.height ?? 0)} fill="transparent" />
        </g>
      </Tooltip>
    </g>
  )
}

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
 * @param {{ dataKey: string; name: string; stroke: string; fill?: string; yAxisId?: string; orientation?: 'left' | 'right'; domain?: [number, number] }[]} [props.areas]
 * @param {'area' | 'line'} [props.variant]
 * @param {boolean} [props.stacked] 仅 area 模式有效
 * @param {number} [props.height]
 * @param {boolean} [props.allowDecimals]
 * @param {[number, number] | null} [props.domain]
 * @param {'category' | 'time'} [props.xType]
 *        time：X 轴按日历时间，参考线可落在月内某天（工单量仍按月点）
 * @param {{ y?: number; x?: string | number; label?: string; stroke?: string; strokeDasharray?: string; yAxisId?: string; position?: string } | Array<{ y?: number; x?: string | number; label?: string; stroke?: string; strokeDasharray?: string; yAxisId?: string; position?: string }> | null} [props.referenceLine]
 *        y=水平基准线；可传数组画多条；x=X 轴某值处的垂直线（月份或 YYYY-MM-DD）
 * @param {{ y?: number; x?: string | number; label?: string; stroke?: string; strokeDasharray?: string; yAxisId?: string; position?: string; badge?: number; tooltip?: string; tone?: 'done' | 'mixed' | 'pending' | 'overdue' }[]} [props.referenceLines]
 *        多条垂直参考线（如同一问题上多个举措的实施日）；badge 传数量时顶部渲染圆形角标替代文字标签，
 *        tooltip 传文本时角标 hover 显示 antd 气泡（当月举措明细）；tone 传状态构成时
 *        竖线/角标着色——done 全完成(绿) / mixed 混合(橙) / pending 全未完成(灰) / overdue 含逾期(红)
 * @param {((value: unknown, name: string) => unknown[]) | null} [props.tooltipFormatter] tooltip 数值格式化（V1 StatusOverviewChart 先例：[值, 名]）
 * @param {((label: unknown) => string) | null} [props.tooltipLabelFormatter] tooltip 轴标签格式化
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
  domain = null,
}) {
  if (!data?.length) {
    return <EmptyChart message="暂无趋势数据" height={height} />
  }

  const series = areas?.length
    ? areas
    : [{ dataKey: 'count', name: '反馈数', stroke: '#4F46E5', fill: 'url(#trendFill)' }]
  const axisIds = [...new Set(series.map((item) => item.yAxisId).filter(Boolean))]
  const dualAxis = axisIds.length > 1
  const yAxes = dualAxis
    ? axisIds.map((id, index) => {
      const sample = series.find((item) => item.yAxisId === id)
      return (
        <YAxis
          key={id}
          yAxisId={id}
          orientation={sample?.orientation || (index === 0 ? 'left' : 'right')}
          domain={sample?.domain}
          allowDataOverflow={Boolean(sample?.domain)}
          allowDecimals={allowDecimals}
          tick={{ fontSize: 11, fill: '#6B7280' }}
          tickFormatter={id === 'rate' ? (value) => `${value}%` : undefined}
        />
      )
    })
    : [
      <YAxis
        key="y"
        allowDecimals={allowDecimals}
        domain={domain || undefined}
        allowDataOverflow={Boolean(domain)}
        tick={{ fontSize: 11, fill: '#6B7280' }}
      />,
    ]
  const yRefs = Array.isArray(referenceLine) ? referenceLine : referenceLine ? [referenceLine] : []

  const timeScale = xType === 'time'
  const chartData = timeScale
    ? data.map((row) => ({ ...row, ts: parseChartXToTs(row.ts ?? row.date) }))
    : data
  // 有数量角标时给图顶部留内侧空间（角标 16px 高 + 2px 内边），避免压折线/被裁
  const topMargin = Array.isArray(referenceLines) && referenceLines.some((r) => r?.badge != null)
    ? 26
    : 8

  const resolveRefX = (x) => (timeScale ? parseChartXToTs(x) : x)
  const refXs = []
  for (const line of yRefs) {
    if (line?.x != null && String(line.x) !== '') refXs.push(resolveRefX(line.x))
  }
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
  yRefs.forEach((line, index) => {
    if (!line || !Number.isFinite(line.y)) return
    refs.push(
      <ReferenceLine
        key={`ref-y-${index}-${line.y}`}
        y={line.y}
        yAxisId={dualAxis ? line.yAxisId || axisIds[0] : undefined}
        stroke={line.stroke || '#F59E0B'}
        strokeDasharray={line.strokeDasharray || '6 4'}
        label={{
          value: line.label || `基准 ${line.y}`,
          position: line.position || (index === 0 ? 'insideTopLeft' : 'insideTopRight'),
          fill: line.stroke || '#B45309',
          fontSize: 11,
        }}
      />,
    )
  })
  const firstRef = yRefs[0] || null
  if (firstRef && firstRef.x != null && String(firstRef.x) !== '') {
    const x = resolveRefX(firstRef.x)
    if (!timeScale || Number.isFinite(x)) {
      refs.push(
        <ReferenceLine
          key="ref-x"
          x={timeScale ? x : String(firstRef.x)}
          stroke={firstRef.stroke || '#F59E0B'}
          strokeDasharray={firstRef.strokeDasharray || '6 4'}
          label={{
            value: firstRef.label || String(firstRef.x),
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
          stroke={r.tone ? resolveRefToneColor(r.tone, r.stroke || '#F59E0B') : (r.stroke || '#F59E0B')}
          strokeDasharray={r.strokeDasharray || '6 4'}
          label={
            r.badge != null
              ? { content: <RefLineBadge badge={r.badge} tooltip={r.tooltip} tone={r.tone} />, position: 'top' }
              : {
                value: r.label || String(r.x),
                position: 'insideTopRight',
                fill: '#B45309',
                fontSize: 11,
              }
          }
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
        <LineChart data={chartData} margin={{ top: topMargin, right: dualAxis ? 16 : 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          {xAxis}
          {yAxes}
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
              yAxisId={dualAxis ? line.yAxisId : undefined}
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
      <AreaChart data={chartData} margin={{ top: topMargin, right: dualAxis ? 16 : 8, left: 0, bottom: stacked ? 4 : 0 }}>
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
        {yAxes}
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
            yAxisId={dualAxis ? area.yAxisId : undefined}
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
