import { isTicketSource } from '../lib/importUtils.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * 从投诉/咨询工单号前缀提取工单实际日期（YYYYMMDD…）。
 * 例：20260511192237X557699887 → 2026-05-11
 *
 * @param {string | null | undefined} ticketId
 * @returns {string | null} YYYY-MM-DD
 */
export function extractTicketActualDate(ticketId) {
  const raw = String(ticketId ?? '').trim()
  if (!raw) return null

  const match = raw.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return `${match[1]}-${match[2]}-${match[3]}`
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null} YYYY-MM-DD
 */
export function parseTicketDateFilterParam(raw) {
  const text = String(raw ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return extractTicketActualDate(text.replace(/-/g, '')) ? text : null
}

/**
 * @param {FeedbackRecord} record
 * @param {{ from?: string | null; to?: string | null }} range YYYY-MM-DD
 */
export function matchesTicketActualDateRange(record, range = {}) {
  const from = range.from?.trim() || null
  const to = range.to?.trim() || null
  if (!from && !to) return true

  const type = record.dataSourceType || 'complaint_ticket'
  if (!isTicketSource(type)) return false

  const ticketDate = extractTicketActualDate(record.ticketId)
  if (!ticketDate) return false
  if (from && ticketDate < from) return false
  if (to && ticketDate > to) return false
  return true
}
