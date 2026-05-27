/**
 * 导入向导轻量预览（避免在列映射阶段反复跑完整打标流水线）
 */
import {
  QUOTE_EXTRACTION_MODE_LABELS,
  computeQuoteExtractionVersion,
  extractQuoteWithMeta,
} from './quoteExtraction.js'

/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */
/** @typedef {import('./storage.js').AppSettings} AppSettings */

/**
 * @param {Record<string, string>[]} rows
 */
export function buildLightPreviewRows(rows) {
  return rows.slice(0, 8).map((r, i) => ({
    id: `preview-${i}`,
    ticketId: r.ticketId || '—',
    customerQuote: (r.handlingText || r.rawText || r.commentText || r.openText || '').slice(0, 120),
    product: r.product || r.productSpec || '—',
    createdAt: r.createdAt || '—',
  }))
}

/**
 * @param {Record<string, string>} row
 */
export function rowHasQuoteSourceText(row) {
  return Boolean(
    (row.rawText || row.handlingText || row.commentText || row.openText || row.body || '').trim(),
  )
}

/**
 * 从映射结果中选取有条目的行作为样例池（最多扫描 scanLimit 行）
 * @param {Record<string, string>[]} rows
 * @param {number} [limit]
 * @param {number} [scanLimit]
 */
export function pickRowsForQuotePreview(rows, limit = 3, scanLimit = 80) {
  /** @type {Record<string, string>[]} */
  const picked = []
  for (const r of rows.slice(0, scanLimit)) {
    if (!rowHasQuoteSourceText(r)) continue
    picked.push(r)
    if (picked.length >= limit) break
  }
  return picked
}

/**
 * 客户原话抽取样例（导入预览步骤，默认 3 条）
 * @param {Record<string, string>[]} rows
 * @param {Object} options
 * @param {DataSourceType} options.dataSourceType
 * @param {AppSettings | null | undefined} [options.settings]
 * @param {number} [options.limit]
 */
export function buildQuotePreviewRows(rows, options) {
  const { dataSourceType, settings = null, limit = 3 } = options
  const version = computeQuoteExtractionVersion(settings)
  const sample = pickRowsForQuotePreview(rows, limit)

  return sample.map((r, i) => {
    const sourceHint = (
      r.rawText ||
      r.handlingText ||
      r.commentText ||
      r.openText ||
      r.body ||
      ''
    )
      .trim()
      .slice(0, 100)

    const { customerQuote, mode } = extractQuoteWithMeta(
      {
        rawText: r.rawText,
        handlingText: r.handlingText,
        commentText: r.commentText,
        openText: r.openText,
      },
      {
        dataSourceType,
        settings,
        quoteExtractionVersion: version,
      },
    )

    return {
      id: `quote-preview-${i}`,
      ticketId: r.ticketId?.trim() || `样例 ${i + 1}`,
      sourceHint: sourceHint || '—',
      modeLabel: QUOTE_EXTRACTION_MODE_LABELS[mode] || mode,
      customerQuote: customerQuote || '—',
      quoteExtractionVersion: version,
    }
  })
}
