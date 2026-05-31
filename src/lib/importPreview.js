/**
 * 导入向导轻量预览（避免在列映射阶段反复跑完整打标流水线）
 */
import { buildTaggingTextFromFields } from './taggingText.js'

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
 * 打标语料样例（导入预览步骤，默认 3 条）
 * @param {Record<string, string>[]} rows
 * @param {Object} [options]
 * @param {DataSourceType} [options.dataSourceType]
 * @param {AppSettings | null | undefined} [options.settings]
 * @param {number} [options.limit]
 */
export function buildTaggingPreviewRows(rows, options = {}) {
  const { limit = 3 } = options
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

    const taggingText = buildTaggingTextFromFields({
      handlingText: r.handlingText,
      rawText: r.rawText,
    })

    return {
      id: `tagging-preview-${i}`,
      ticketId: r.ticketId?.trim() || `样例 ${i + 1}`,
      sourceHint: sourceHint || '—',
      taggingText: taggingText?.trim().slice(0, 200) || '—',
    }
  })
}

/** @deprecated 使用 buildTaggingPreviewRows */
export function buildQuotePreviewRows(rows, options) {
  return buildTaggingPreviewRows(rows, options).map((row) => ({
    ...row,
    modeLabel: '打标语料',
    customerQuote: row.taggingText,
  }))
}
