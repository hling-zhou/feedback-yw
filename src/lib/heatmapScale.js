/** @typedef {[number, number, number]} HeatRgb */

/** 体验断点热力色板（RGB） */
export const HEAT_RGB = /** @type {const} */ ({
  urgentNegative: /** @type {HeatRgb} */ ([239, 68, 68]),
  metricNegative: /** @type {HeatRgb} */ ([249, 115, 22]),
  urgent: /** @type {HeatRgb} */ ([245, 158, 11]),
  total: /** @type {HeatRgb} */ ([99, 102, 241]),
  strong_negative: /** @type {HeatRgb} */ ([220, 38, 38]),
  negative: /** @type {HeatRgb} */ ([239, 68, 68]),
  mild_negative: /** @type {HeatRgb} */ ([249, 115, 22]),
  neutral_inquiry: /** @type {HeatRgb} */ ([148, 163, 184]),
  neutral_pending: /** @type {HeatRgb} */ ([148, 163, 184]),
  positive: /** @type {HeatRgb} */ ([34, 197, 94]),
})

/**
 * @param {unknown} row
 * @param {string | string[]} dataIndex
 */
export function getRowFieldValue(row, dataIndex) {
  if (Array.isArray(dataIndex)) {
    return dataIndex.reduce((acc, key) => acc?.[key], row)
  }
  return row?.[dataIndex]
}

/**
 * 列内 max（计数型指标下限为 0）。
 *
 * @param {unknown[]} rows
 * @param {string | string[]} dataIndex
 */
export function columnStats(rows, dataIndex) {
  let max = 0
  for (const row of rows || []) {
    const value = Number(getRowFieldValue(row, dataIndex))
    if (Number.isFinite(value)) max = Math.max(max, value)
  }
  return { min: 0, max }
}

/**
 * @param {number | null | undefined} value
 * @param {{ max: number; rgb: HeatRgb; alphaMin?: number; alphaMax?: number }} options
 * @returns {string | undefined}
 */
export function heatBackground(value, { max, rgb, alphaMin = 0.08, alphaMax = 0.55 }) {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0 || max <= 0) return undefined
  const intensity = count / max
  const alpha = alphaMin + intensity * (alphaMax - alphaMin)
  const [r, g, b] = rgb
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
}

/**
 * @param {HeatRgb} rgb
 * @param {{ alphaMin?: number; alphaMax?: number }} [options]
 */
export function heatLegendGradient(rgb, options = {}) {
  const alphaMin = options.alphaMin ?? 0.08
  const alphaMax = options.alphaMax ?? 0.55
  const [r, g, b] = rgb
  return `linear-gradient(to right, rgba(${r}, ${g}, ${b}, ${alphaMin}), rgba(${r}, ${g}, ${b}, ${alphaMax}))`
}

/**
 * @param {number | null | undefined} value
 * @param {number} max
 */
export function heatColumnPercentLabel(value, max) {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0 || max <= 0) return null
  return Math.round((count / max) * 100)
}
