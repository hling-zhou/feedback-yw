import Papa from 'papaparse'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { recordSourceType } from '../snapshots/recordScope.js'
import {
  computeQuoteExtractionVersion,
  extractQuoteMetaForRecord,
  isQuoteExtractionStale,
} from './quoteExtraction.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('./storage.js').AppSettings} AppSettings */

/**
 * @param {FeedbackRecord[]} feedbacks
 * @param {AppSettings | null | undefined} settings
 * @param {{ staleOnly?: boolean; limit?: number }} [options]
 */
export function buildQuoteComparisonRows(feedbacks, settings, options = {}) {
  const { staleOnly = true, limit = 5000 } = options
  const currentVersion = computeQuoteExtractionVersion(settings)
  /** @type {FeedbackRecord[]} */
  let list = feedbacks

  if (staleOnly) {
    list = list.filter((fb) => isQuoteExtractionStale(fb, currentVersion))
  }

  return list.slice(0, limit).map((fb) => {
    const { customerQuote: proposed } = extractQuoteMetaForRecord(fb, settings)
    const stored = (fb.customerQuote || '').trim()
    const proposedTrim = (proposed || '').trim()
    return {
      工单号: fb.ticketId || '',
      数据来源: DATA_SOURCE_LABELS[recordSourceType(fb)] || recordSourceType(fb),
      数据月份: fb.importMonth || '',
      库内客户原话: stored,
      按当前规则原话: proposedTrim,
      是否变更: stored !== proposedTrim ? '是' : '否',
      库内规则版本: fb.quoteExtractionVersion || '',
      当前规则版本: currentVersion,
    }
  })
}

/**
 * @param {FeedbackRecord[]} feedbacks
 * @param {AppSettings | null | undefined} settings
 * @param {{ staleOnly?: boolean; filename?: string }} [options]
 * @returns {boolean} 是否已下载
 */
export function downloadQuoteComparisonCsv(feedbacks, settings, options = {}) {
  const rows = buildQuoteComparisonRows(feedbacks, settings, {
    staleOnly: options.staleOnly !== false,
  })
  if (!rows.length) return false

  const csv = Papa.unparse(rows)
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = options.filename || '客户原话对比.csv'
  a.click()
  URL.revokeObjectURL(url)
  return true
}
