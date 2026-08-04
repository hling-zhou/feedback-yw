/** 移动云工单流水号：20220802092823X703918924 */
const MOBILE_TICKET_ID_LABELED =
  /(?:工单流水号|投诉工单流水号|流水号)[：:\s]*([0-9A-Za-z]{12,})/i

const MOBILE_TICKET_ID_BARE = /\b(20\d{10,}[A-Z][0-9A-Za-z]{6,})\b/

/**
 * @param {string} [id]
 */
export function normalizeTicketId(id) {
  if (id === null || id === undefined) return undefined
  let s = String(id).trim()
  if (!s) return undefined

  if (/^\d+\.?\d*[eE][+]?\d+$/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n) && Math.floor(n) === n) {
      s = n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
    }
  }

  if (/^\d+\.0+$/.test(s)) {
    s = s.replace(/\.0+$/, '')
  }

  return s
}

/**
 * 简易演示 CSV 中的假工单号（TK-2024-001）
 * @param {string} [id]
 */
export function isLegacyDemoTicketId(id) {
  return /^TK-\d{4}-\d{2,}$/i.test(String(id || '').trim())
}

/**
 * 从处理意见/受理内容中解析移动云工单流水号
 * @param {...(string | undefined)} texts
 */
export function extractMobileTicketId(...texts) {
  for (const t of texts) {
    if (!t) continue
    const labeled = t.match(MOBILE_TICKET_ID_LABELED)
    if (labeled?.[1]) return normalizeTicketId(labeled[1])
    const bare = t.match(MOBILE_TICKET_ID_BARE)
    if (bare?.[1]) return normalizeTicketId(bare[1])
  }
  return undefined
}

/**
 * @param {string} [value]
 */
export function normalizeCreatedAt(value) {
  if (!value) return undefined
  const s = String(value).trim()
  if (!s) return undefined
  if (/^\d+\.?\d*[eE][+]?\d+$/.test(s)) return s
  const d = new Date(s)
  if (!Number.isNaN(d.getTime()) && /^\d{4}[-/]\d{1,2}/.test(s)) {
    if (s.includes(':')) {
      return s.replace(/\//g, '-').slice(0, 19)
    }
    return s.replace(/\//g, '-').slice(0, 10)
  }
  return s
}

/**
 * 修复单条反馈的工单号/时间（用于已入库数据）
 * @param {import('./types.js').FeedbackRecord} fb
 */
export function repairFeedbackMetadata(fb) {
  let ticketId = normalizeTicketId(fb.ticketId)
  if (!ticketId || isLegacyDemoTicketId(ticketId)) {
    ticketId =
      extractMobileTicketId(fb.handlingText, fb.rawText, fb.customerQuote) || ticketId
  }
  return {
    ...fb,
    ticketId: ticketId || fb.ticketId,
    createdAt: normalizeCreatedAt(fb.createdAt) || fb.createdAt,
  }
}
