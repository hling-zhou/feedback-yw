/** 横向条形图：单条厚度（与情绪分布图一致） */
export const HORIZONTAL_BAR_MAX_SIZE = 28

/** Recharts Tooltip 悬停高亮（条形背景；折线图指示线见 index.css） */
export const CHART_TOOLTIP_CURSOR = {
  fill: '#E5E7EB',
}

/** Recharts Tooltip 面板默认样式 */
export const CHART_TOOLTIP_CONTENT_STYLE = {
  borderRadius: 8,
  fontSize: 12,
  border: '1px solid #E5E7EB',
}

/** 横向条形图：每条类目占用的行高（px） */
export const HORIZONTAL_BAR_ROW_HEIGHT = 40

/** 横向条形图：最小图表高度（px） */
export const HORIZONTAL_BAR_MIN_HEIGHT = 200

export function horizontalBarChartHeight(itemCount) {
  return Math.max(HORIZONTAL_BAR_MIN_HEIGHT, itemCount * HORIZONTAL_BAR_ROW_HEIGHT)
}

const BAR_CHART_LABEL_MARGIN_BASE = 36

/**
 * 按主数值位数预留右侧边距，避免 LabelList 被裁切。
 *
 * @param {unknown[]} data
 * @param {string} [dataKey]
 */
export function barChartRightMargin(data, dataKey = 'count') {
  let max = 0
  for (const row of data || []) {
    const v = Number(row?.[dataKey])
    if (Number.isFinite(v)) max = Math.max(max, v)
  }
  const digits = max > 0 ? String(Math.round(max)).length : 1
  return BAR_CHART_LABEL_MARGIN_BASE + Math.max(0, digits - 2) * 10
}

/**
 * 估算类目轴标签文本宽度（px），用于横向条形图 Y 轴。
 *
 * @param {string} text
 * @param {number} [fontSize]
 */
export function measureCategoryLabelWidth(text, fontSize = 11) {
  let w = 0
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0) ?? 0
    w += code > 0xff ? fontSize : fontSize * 0.58
  }
  return w
}

/**
 * @param {string[]} labels
 * @param {{ fontSize?: number; min?: number; max?: number; padding?: number }} [opts]
 */
export function categoryAxisWidth(labels, opts = {}) {
  const fontSize = opts.fontSize ?? 11
  const min = opts.min ?? 88
  const max = opts.max ?? 280
  const padding = opts.padding ?? 14
  let widest = 0
  for (const raw of labels || []) {
    widest = Math.max(widest, measureCategoryLabelWidth(raw, fontSize))
  }
  return Math.min(max, Math.max(min, Math.ceil(widest) + padding))
}

/**
 * 超出可用宽度时在末尾加省略号（tooltip 仍可展示 fullName）。
 *
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} [fontSize]
 */
export function ellipsizeCategoryLabel(text, maxWidth, fontSize = 11) {
  const raw = String(text ?? '')
  if (measureCategoryLabelWidth(raw, fontSize) <= maxWidth) return raw
  const ellipsis = '…'
  const ellipsisW = measureCategoryLabelWidth(ellipsis, fontSize)
  let out = ''
  for (const ch of raw) {
    const next = out + ch
    if (measureCategoryLabelWidth(next, fontSize) + ellipsisW > maxWidth) break
    out = next
  }
  return out ? `${out}${ellipsis}` : ellipsis
}

/**
 * @param {unknown[]} data
 * @param {{ dataKey?: string; labelKey?: string; fontSize?: number }} [opts]
 */
export function horizontalBarChartLayout(data, opts = {}) {
  const dataKey = opts.dataKey ?? 'count'
  const labelKey = opts.labelKey ?? 'name'
  const fontSize = opts.fontSize ?? 11
  const labels = (data || []).map(
    (row) => String(row?.[labelKey] ?? row?.fullName ?? ''),
  )
  const yAxisWidth = categoryAxisWidth(labels, { fontSize })
  const labelRoom = yAxisWidth - 14
  return {
    yAxisWidth,
    margin: {
      top: 4,
      right: barChartRightMargin(data, dataKey),
      left: 4,
      bottom: 4,
    },
    formatLabel: (text) => ellipsizeCategoryLabel(text, labelRoom, fontSize),
  }
}
