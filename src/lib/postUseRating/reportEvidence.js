import { classifyFeedbackPolarity, extractValidCustomerTexts } from './customerQuotes.js'
import { normalizeEvidenceText } from './evidence.js'
import { matchAllReasonTaxonomy } from './reasonTaxonomy.js'

function stableEvidenceId(parts) {
  const value = JSON.stringify(parts)
  let a = 2166136261
  let b = 0x9e3779b9
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    a = Math.imul(a ^ code, 16777619)
    b = Math.imul(b + code, 2246822519)
  }
  return `e:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`
}

export function reportProductName(record) {
  return String(record?.product || record?.productName || '').trim()
}

export function reportMonth(record) {
  return String(record?.importMonth || record?.createdAt || '').slice(0, 7)
}

export function reportCustomerMatches(left, right) {
  const leftCode = String(left?.customerCode || '').trim()
  const rightCode = String(right?.customerCode || '').trim()
  if (leftCode && rightCode) return leftCode === rightCode
  const leftName = String(left?.customerName || '').trim()
  const rightName = String(right?.customerName || right?.groupName || right?.userInfoDetail || '').trim()
  return Boolean(leftName && rightName && leftName !== '匿名客户' && leftName === rightName)
}

/** Only explicit no-problem wording is eligible for automatic exclusion. */
export function isExplicitNoProblemVisit(visit) {
  const result = normalizeEvidenceText(visit?.visitResult || visit?.visitFeedbackDetail)
  return /^(?:(?:经省代表回访|经回访|客户|省代表|经核实|回访)(?:核实|确认)?[，,:：]?\s*)?(?:无问题|没有问题|未发现问题|未复现问题|不存在问题)(?:[。；;，,\s]|$)/.test(result)
}

function sourceTexts(record) {
  const primary = extractValidCustomerTexts(record)
  const channel = String(record?.channel || record?.sourceSubType || '').trim()
  if (!['console', 'web_survey', 'option', 'web_option'].includes(channel)) return primary
  // The general quote registry chooses reason columns before commentText. Reports require both.
  const comment = extractValidCustomerTexts({
    ...record,
    feedbackReasonTexts: [],
    feedbackReasonPrimary: '',
    feedbackReasonSecondary: '',
    feedbackReasonTertiary: '',
  })
  const seen = new Set(primary.map((row) => `${row.kind}\0${row.text}`))
  return [...primary, ...comment.filter((row) => !seen.has(`${row.kind}\0${row.text}`))]
}

/** One feedback piece may contain several known issue labels; each label gets its own occurrence. */
export function buildReportIssueOccurrences(records) {
  const out = []
  for (const record of records || []) {
    const productName = reportProductName(record)
    const recordId = String(record?.id || record?.ratingId || '').trim()
    if (!productName) continue
    for (const item of sourceTexts(record)) {
      if (classifyFeedbackPolarity(item) !== 'negative') continue
      const text = normalizeEvidenceText(item.text)
      if (!text) continue
      const matches = matchAllReasonTaxonomy(text, item.channel).map((row) => row.label)
      const issues = matches.length ? matches : [text]
      const pieceId = stableEvidenceId([recordId, item.kind, text])
      for (const issueName of issues) {
        out.push({
          id: stableEvidenceId([pieceId, issueName]),
          pieceId,
          recordId,
          productName,
          customerCode: String(record?.customerCode || '').trim(),
          customerName: String(record?.customerName || '').trim(),
          month: reportMonth(record),
          score: item.score,
          channel: item.channel,
          kind: item.kind,
          text,
          issueName,
          multiIssueText: issues.length > 1,
        })
      }
    }
  }
  return out
}

export function visitSourceFingerprint(visit) {
  return JSON.stringify([
    String(visit?.id || ''), reportProductName(visit),
    String(visit?.customerCode || ''), String(visit?.customerName || ''),
    normalizeEvidenceText(visit?.userFeedbackText),
    normalizeEvidenceText(visit?.visitResult || visit?.visitFeedbackDetail),
  ])
}

export function traceSourceFingerprint(trace) {
  return JSON.stringify([
    String(trace?.id || ''), reportProductName(trace),
    String(trace?.customerCode || ''), String(trace?.customerName || ''),
    normalizeEvidenceText(trace?.customerFeedback),
  ])
}

function validSource(issue, source) {
  const months = String(source?.importMonth || source?.visitMonth || '').split('、').map((month) => month.trim())
  return source
    && reportProductName(source) === issue.productName
    && reportCustomerMatches(issue, source)
    && months.includes(issue.month)
}

/** The persisted decision has no effect if its source record was deleted or materially changed. */
export function resolveReportIssues(occurrences, visits = [], traces = [], links = []) {
  const visitById = new Map((visits || []).map((row) => [String(row?.id || ''), row]))
  const traceById = new Map((traces || []).map((row) => [String(row?.id || ''), row]))
  const linksByIssue = new Map()
  for (const link of links || []) {
    const list = linksByIssue.get(link.issueId) || []
    list.push(link)
    linksByIssue.set(link.issueId, list)
  }
  return (occurrences || []).map((issue) => {
    const validLinks = (linksByIssue.get(issue.id) || []).filter((link) => {
      const source = link.sourceType === 'visit'
        ? visitById.get(link.sourceId)
        : link.sourceType === 'trace' ? traceById.get(link.sourceId) : null
      if (!validSource(issue, source)) return false
      return link.sourceFingerprint === (link.sourceType === 'visit'
        ? visitSourceFingerprint(source) : traceSourceFingerprint(source))
    })
    const linkedVisitIds = validLinks.filter((row) => row.sourceType === 'visit').map((row) => row.sourceId)
    const linkedTraceIds = validLinks.filter((row) => row.sourceType === 'trace').map((row) => row.sourceId)
    const exactVisits = issue.multiIssueText || validLinks.some((row) => row.sourceType === 'visit')
      ? []
      : (visits || []).filter((visit) => (
        validSource(issue, visit)
        && normalizeEvidenceText(visit?.userFeedbackText) === issue.text
        && isExplicitNoProblemVisit(visit)
      ))
    const autoVisit = exactVisits.length === 1 ? exactVisits[0] : null
    const exactTraces = issue.multiIssueText || validLinks.some((row) => row.sourceType === 'trace')
      ? []
      : (traces || []).filter((trace) => (
        validSource(issue, trace)
        && normalizeEvidenceText(trace?.customerFeedback) === issue.text
      ))
    const autoTrace = exactTraces.length === 1 ? exactTraces[0] : null
    const excluded = validLinks.some((row) => row.sourceType === 'visit' && row.verdict === 'no_issue') || Boolean(autoVisit)
    return {
      ...issue,
      status: excluded ? 'excluded_no_issue' : 'open',
      resolutionSource: excluded ? (autoVisit && !linkedVisitIds.length ? 'exact_visit' : 'manual_visit') : '',
      linkedVisitIds: autoVisit ? [...new Set([...linkedVisitIds, String(autoVisit.id)])] : linkedVisitIds,
      linkedTraceIds: autoTrace ? [...new Set([...linkedTraceIds, String(autoTrace.id)])] : linkedTraceIds,
      staleLinkCount: (linksByIssue.get(issue.id) || []).length - validLinks.length,
    }
  })
}

function themeRows(issues) {
  const map = new Map()
  for (const issue of issues || []) {
    const key = `${issue.productName}\0${issue.issueName}`
    const row = map.get(key) || {
      productName: issue.productName, issue: issue.issueName,
      rawCount: 0, excludedCount: 0, activeCount: 0, lowestScore: null, evidenceIds: [],
    }
    row.rawCount += 1
    if (issue.status === 'excluded_no_issue') row.excludedCount += 1
    else row.activeCount += 1
    if (Number.isFinite(issue.score)) row.lowestScore = row.lowestScore == null ? issue.score : Math.min(row.lowestScore, issue.score)
    if (issue.recordId) row.evidenceIds.push(issue.recordId)
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.activeCount - a.activeCount || (a.lowestScore ?? 99) - (b.lowestScore ?? 99) || b.rawCount - a.rawCount)
}

export function buildReportProductEvidence(issues, productName) {
  const rows = (issues || []).filter((row) => row.productName === productName)
  const pieces = new Map()
  for (const issue of rows) {
    const entry = pieces.get(issue.pieceId) || {
      pieceId: issue.pieceId, text: issue.text, score: issue.score,
      recordId: issue.recordId, customerName: issue.customerName, customerCode: issue.customerCode,
      issueIds: [], excludedIssueCount: 0,
    }
    entry.issueIds.push(issue.id)
    if (issue.status === 'excluded_no_issue') entry.excludedIssueCount += 1
    pieces.set(issue.pieceId, entry)
  }
  const quoteMap = new Map()
  for (const piece of pieces.values()) {
    const key = piece.text.replace(/\s+/g, ' ').trim()
    const group = quoteMap.get(key) || { text: piece.text, count: 0, lowestScore: null, excludedCount: 0, recordIds: [] }
    group.count += 1
    if (piece.excludedIssueCount === piece.issueIds.length) group.excludedCount += 1
    if (piece.recordId) group.recordIds.push(piece.recordId)
    if (Number.isFinite(piece.score)) group.lowestScore = group.lowestScore == null ? piece.score : Math.min(group.lowestScore, piece.score)
    quoteMap.set(key, group)
  }
  const quotes = [...quoteMap.values()].sort((a, b) => (a.lowestScore ?? 99) - (b.lowestScore ?? 99) || b.count - a.count)
  const highFrequency = [...quoteMap.values()].sort((a, b) => b.count - a.count || (a.lowestScore ?? 99) - (b.lowestScore ?? 99))[0]
  const highlights = [...new Map([quotes[0], highFrequency].filter(Boolean).map((row) => [row.text, row])).values()]
  return {
    issues: rows,
    pieces: [...pieces.values()],
    themes: themeRows(rows),
    quotes,
    highlights,
    rawPieceCount: pieces.size,
    rawRecordCount: new Set([...pieces.values()].map((row) => row.recordId).filter(Boolean)).size,
    excludedIssueCount: rows.filter((row) => row.status === 'excluded_no_issue').length,
    activeIssueCount: rows.filter((row) => row.status !== 'excluded_no_issue').length,
  }
}

/** Every theme is retained; this draft is also the safe fallback when LLM is unavailable. */
export function draftReportNegativeDetail(evidence) {
  const count = Number(evidence?.rawPieceCount) || 0
  if (!count) return '本期未检出该产品的有效负反馈。'
  const themes = (evidence?.themes || []).map((row) => {
    const status = row.activeCount === 0
      ? `，均已由省代表回访确认无问题并排除`
      : row.excludedCount ? `，其中 ${row.excludedCount} 次已排除` : ''
    const low = row.lowestScore == null ? '' : `，最低 ${row.lowestScore} 分`
    return `「${row.issue}」原始 ${row.rawCount} 次${low}${status}`
  })
  const highlights = (evidence?.highlights || []).map((row) => (
    `「${row.text}」（原话 ${row.count} 次${row.lowestScore == null ? '' : `，最低 ${row.lowestScore} 分`}${row.excludedCount ? `，已排除 ${row.excludedCount} 次` : ''}）`
  ))
  return [
    `本期收集 ${count} 条有效负反馈片段，涉及 ${evidence?.rawRecordCount || 0} 条评分记录；原始评分与原话次数保留。`,
    `问题综合：${themes.join('；')}。`,
    highlights.length ? `优先关注低分和高频原话：${highlights.join('；')}。` : '',
  ].filter(Boolean).join('\n')
}

export function buildReportThemeRows(issues) {
  return themeRows(issues)
}

/** Report-only comparison: the exact current month/quarter against its adjacent predecessor. */
export function buildReportPeriodIssueChanges(issues, currentMonths, previousMonths, previousHasRecords = true) {
  if (!previousHasRecords) return []
  const currentSet = new Set(currentMonths || [])
  const previousSet = new Set(previousMonths || [])
  const bucket = (months) => {
    const map = new Map()
    for (const issue of issues || []) {
      if (issue.status === 'excluded_no_issue' || !months.has(issue.month)) continue
      const key = `${issue.productName}\0${issue.issueName}`
      const row = map.get(key) || { productName: issue.productName, issue: issue.issueName, count: 0, evidenceIds: [] }
      row.count += 1
      if (issue.recordId) row.evidenceIds.push(issue.recordId)
      map.set(key, row)
    }
    return map
  }
  const current = bucket(currentSet)
  const previous = bucket(previousSet)
  return [...new Set([...current.keys(), ...previous.keys()])].map((key) => {
    const now = current.get(key)
    const prev = previous.get(key)
    const currentCount = now?.count || 0
    const previousCount = prev?.count || 0
    let change = '持续'
    if (!previousCount && currentCount) change = '新增'
    else if (previousCount && !currentCount) change = '消失'
    else if (currentCount > previousCount) change = '增长'
    else if (currentCount < previousCount) change = '缓解'
    return {
      productName: (now || prev).productName,
      issue: (now || prev).issue,
      currentCount, previousCount, change,
      currentMonth: [...currentSet].at(-1) || '',
      previousMonth: [...previousSet].at(-1) || '',
      evidenceIds: [...(now?.evidenceIds || []), ...(prev?.evidenceIds || [])],
    }
  }).sort((a, b) => {
    const order = { 新增: 0, 增长: 1, 持续: 2, 缓解: 3, 消失: 4 }
    return order[a.change] - order[b.change] || b.currentCount - a.currentCount
  })
}
