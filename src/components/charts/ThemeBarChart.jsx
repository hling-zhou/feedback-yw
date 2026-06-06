import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import BarCountLabel from './BarCountLabel.jsx'
import CategoryAxisTick from './CategoryAxisTick.jsx'
import ChartTooltip from './ChartTooltip.jsx'
import {
  HORIZONTAL_BAR_MAX_SIZE,
  HORIZONTAL_BAR_MIN_HEIGHT,
  horizontalBarChartHeight,
  horizontalBarChartLayout,
} from './chartConstants.js'

/** @param {unknown} data */
function resolveBarRow(data) {
  if (!data || typeof data !== 'object') return null
  const row = /** @type {{ payload?: { fullName?: string; name?: string }; fullName?: string; name?: string }} */ (
    data
  )
  return row.payload ?? row
}

/** @param {unknown} data */
function resolveBarLabel(data) {
  const row = resolveBarRow(data)
  const label = row?.fullName ?? row?.name
  return typeof label === 'string' && label ? label : null
}

/** @typedef {{ top: number; left: number }} TooltipAnchor */

/**
 * @param {Object} props
 * @param {{ fullName: string; count: number; negativePct: number }} props.row
 * @param {TooltipAnchor} props.anchor
 * @param {string} props.href
 * @param {boolean} [props.showNegativePct]
 * @param {() => void} props.onEnter
 * @param {() => void} props.onLeave
 * @param {(href: string) => void} props.onNavigate
 */
function BarChartDrillDownOverlay({
  row,
  anchor,
  href,
  showNegativePct = true,
  onEnter,
  onLeave,
  onNavigate,
}) {
  return (
    <div
      className="absolute z-30 min-w-[11rem] max-w-[22rem] -translate-y-1/2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs shadow-md"
      style={{ top: anchor.top, left: anchor.left }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="font-medium leading-snug text-ink-800 [overflow-wrap:anywhere] [word-break:normal]">
        {row.fullName}
      </div>
      <div className="mt-1 whitespace-nowrap text-ink-500">
        {row.count} 条
        {showNegativePct ? ` (负面 ${row.negativePct}%)` : ''}
      </div>
      <button
        type="button"
        className="mt-2 block text-left text-brand-600 hover:text-brand-700 hover:underline"
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onNavigate(href)
        }}
      >
        在反馈库查看
      </button>
    </div>
  )
}

export default function ThemeBarChart({
  data,
  onBarClick,
  activeLabel,
  buildFeedbacksHref,
  showNegativePct = true,
}) {
  const navigate = useNavigate()
  const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const hideTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))
  const [hoveredBar, setHoveredBar] = useState(
    /** @type {null | { row: { fullName: string; count: number; negativePct: number }; anchor: TooltipAnchor; href: string }} */ (
      null
    ),
  )

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimerRef.current = setTimeout(() => setHoveredBar(null), 200)
  }, [cancelHide])

  useEffect(() => () => cancelHide(), [cancelHide])

  const chartData = useMemo(
    () =>
      (data || []).slice(0, 10).map((t) => ({
        name: t.label,
        fullName: t.label,
        count: t.count,
        negativePct: t.count ? Math.round((t.negative / t.count) * 100) : 0,
      })),
    [data],
  )

  const layout = useMemo(
    () => horizontalBarChartLayout(chartData),
    [chartData],
  )

  const axisData = useMemo(
    () =>
      chartData.map((row) => ({
        ...row,
        name: layout.formatLabel(row.name),
      })),
    [chartData, layout],
  )

  const handleBarMouseEnter = useCallback(
    (data, _index, event) => {
      if (!buildFeedbacksHref) return
      const row = resolveBarRow(data)
      const fullName = row?.fullName ?? row?.name
      if (!fullName) return
      const href = buildFeedbacksHref(fullName)
      if (!href) return

      cancelHide()
      const target = event?.target
      const container = containerRef.current
      if (!(target instanceof Element) || !container) {
        setHoveredBar({
          row: { fullName, count: row?.count ?? 0, negativePct: row?.negativePct ?? 0 },
          anchor: { top: 0, left: 0 },
          href,
        })
        return
      }

      const barRect = target.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      setHoveredBar({
        row: { fullName, count: row?.count ?? 0, negativePct: row?.negativePct ?? 0 },
        anchor: {
          top: barRect.top - containerRect.top + barRect.height / 2,
          left: barRect.right - containerRect.left + 8,
        },
        href,
      })
    },
    [buildFeedbacksHref, cancelHide],
  )

  const handleBarClick = useCallback(
    (label) => {
      const href = buildFeedbacksHref?.(label)
      if (href) {
        navigate(href)
        return
      }
      onBarClick?.(label)
    },
    [buildFeedbacksHref, navigate, onBarClick],
  )

  const handleChartClick = useCallback(
    (state) => {
      const label = resolveBarLabel(state?.activePayload?.[0]?.payload ?? state?.activePayload?.[0])
      if (label) handleBarClick(label)
    },
    [handleBarClick],
  )

  if (!chartData.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-ink-400"
        style={{ height: HORIZONTAL_BAR_MIN_HEIGHT }}
      >
        暂无数据
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      {hoveredBar ? (
        <BarChartDrillDownOverlay
          row={hoveredBar.row}
          anchor={hoveredBar.anchor}
          href={hoveredBar.href}
          showNegativePct={showNegativePct}
          onEnter={cancelHide}
          onLeave={scheduleHide}
          onNavigate={navigate}
        />
      ) : null}

      <ResponsiveContainer width="100%" height={horizontalBarChartHeight(chartData.length)}>
        <BarChart
          data={axisData}
          layout="vertical"
          margin={layout.margin}
          onClick={onBarClick || buildFeedbacksHref ? handleChartClick : undefined}
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
          {buildFeedbacksHref ? (
            <Tooltip active={false} cursor={false} />
          ) : (
            <ChartTooltip
              formatter={(value, _name, props) => [
                showNegativePct
                  ? `${value} 条 (负面 ${props.payload.negativePct}%)`
                  : `${value} 条`,
                props.payload.fullName,
              ]}
              contentStyle={{ maxWidth: 352, whiteSpace: 'normal', wordBreak: 'normal' }}
            />
          )}
          <Bar
            dataKey="count"
            fill="#6366F1"
            radius={[0, 4, 4, 0]}
            maxBarSize={HORIZONTAL_BAR_MAX_SIZE}
            cursor={onBarClick || buildFeedbacksHref ? 'pointer' : 'default'}
            onMouseEnter={buildFeedbacksHref ? handleBarMouseEnter : undefined}
            onMouseLeave={buildFeedbacksHref ? scheduleHide : undefined}
          >
            {axisData.map((entry) => (
              <Cell
                key={entry.fullName}
                fill={activeLabel === entry.fullName ? '#4338CA' : '#6366F1'}
              />
            ))}
            <BarCountLabel />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
