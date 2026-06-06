import { heatBackground, heatColumnPercentLabel, heatLegendGradient } from '../lib/heatmapScale.js'

/**
 * 表格单元格热力背景（列内独立归一化）。
 *
 * @param {Object} props
 * @param {number | null | undefined} props.value
 * @param {number} props.max
 * @param {import('../lib/heatmapScale.js').HeatRgb} props.rgb
 * @param {number} [props.alphaMin]
 * @param {number} [props.alphaMax]
 * @param {boolean} [props.enabled]
 * @param {boolean} [props.showTooltip]
 * @param {import('react').ReactNode} [props.children]
 * @param {string} [props.className]
 */
export default function HeatmapTableCell({
  value,
  max,
  rgb,
  alphaMin,
  alphaMax,
  enabled = true,
  showTooltip = true,
  children,
  className = '',
}) {
  const count = Number(value)
  const hasValue = Number.isFinite(count) && count > 0
  const backgroundColor =
    enabled && hasValue
      ? heatBackground(count, { max, rgb, alphaMin, alphaMax })
      : undefined

  const percent = showTooltip && enabled ? heatColumnPercentLabel(count, max) : null
  const title =
    showTooltip && enabled && hasValue && percent != null
      ? `${count} 条 · 本列最高值的 ${percent}%`
      : undefined

  return (
    <div
      className={`-mx-2 min-h-[1.75rem] px-2 py-1 ${className}`.trim()}
      style={backgroundColor ? { backgroundColor } : undefined}
      title={title}
    >
      {children ?? (hasValue ? count : '—')}
    </div>
  )
}

/**
 * @param {Object} props
 * @param {import('../lib/heatmapScale.js').HeatRgb} props.rgb
 * @param {string} [props.label]
 */
export function HeatmapLegend({ rgb, label = '热力图例' }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-ink-400">
      <span>{label}</span>
      <span
        className="inline-block h-2 w-20 rounded"
        style={{ background: heatLegendGradient(rgb) }}
        aria-hidden
      />
      <span>低 → 高（各列独立归一化）</span>
    </div>
  )
}
