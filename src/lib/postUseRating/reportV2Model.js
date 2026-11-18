import { buildCustomerQuoteRegistry, isPraiseQuote } from './customerQuotes.js'
import { buildReportIssueOccurrences, resolveReportIssues } from './reportEvidence.js'
import { isSubstantiveFeedbackReason, isValidCustomerText, REASON_TAXONOMY_EXCLUDE } from './reasonTaxonomy.js'
import { postUsePeriodMonths } from './periodScope.js'
import { computeInternalSatisfactionMetrics } from './metrics.js'
import { postUseRecordsToScoredRows } from './scoredRows.js'
import { buildCustomerInsights } from './insights.js'
import { visitEvaluationState } from './visitRecords.js'
import { normalizePostUseJiraStatus } from '../../domain/postUseJira.js'
import { maskCustomerName, maskPhoneInText } from '../customerMask.js'

const SCORE_BASELINE = 9
const REPORT_PRODUCT_ALIASES = new Map([['共享带宽', '弹性公网IP']])

/** A selected option is not customer praise, even if its text is “满意”. */
export function isReportV2PraiseQuote(quote) {
  if (!quote || quote.channel === 'option' || quote.kind === 'option') return false
  // The 2026-10 prototype registers the courteous 10-point reply “需订购其他服务，谢谢！” as praise.
  return isPraiseQuote(quote)
    || (quote.polarity === 'positive' && Number(quote.score) === 10 && /谢谢/.test(String(quote.text || '')))
}

export function reportV2QuoteCategory(quote) {
  if (quote?.score == null && /^(?:业务)?使用完毕(?:无后续使用需求)?$/.test(String(quote.text || '').trim())) return '中性备注'
  if (quote?.score == null && !isSubstantiveFeedbackReason(String(quote.text || '').trim())) return '中性备注'
  if (quote?.kind === 'option') return Number(quote.score) === 10 ? '反馈选项' : '负反馈'
  if (isReportV2PraiseQuote(quote)) return '正反馈'
  if (quote?.score == null && /^(?:已|已经|现已|目前已)/.test(String(quote.text || ''))
    && !/不|无|未|缺|故障|问题|慢|差|失败|投诉/.test(String(quote.text || ''))) return '中性备注'
  return quote?.polarity === 'positive' ? '中性备注' : '负反馈'
}

function productOf(record) {
  const name = String(record?.product || record?.productName || '').trim()
  return REPORT_PRODUCT_ALIASES.get(name) || name
}

function sourceProductOf(record) {
  return String(record?.sourceProductName || record?.evidence?.productName || '').trim()
}

function monthOf(record) {
  return String(record?.importMonth || '').slice(0, 7)
}

function scoreOf(record) {
  const value = Number(record?.ratingScore)
  return record?.ratingScore == null || !Number.isFinite(value) ? null : value
}

function isScored(record) {
  return record?.dataSourceType === 'post_use_rating'
    && record?.channel !== 'option'
    && record?.sourceSubType !== 'web_option'
    && scoreOf(record) != null
}

function average(rows) {
  if (!rows.length) return null
  return Math.round(rows.reduce((sum, row) => sum + Number(row.score ?? scoreOf(row) ?? 0), 0) / rows.length * 100) / 100
}

function round(value) {
  return Math.round(value * 100) / 100
}

function distinct(items) {
  return [...new Set(items.filter(Boolean))]
}

function v2QuoteKind(item, source) {
  if (item.channel !== 'option') return item.kind
  if (Number(item.score) === 10) return 'option'
  const comment = String(source?.commentText || '').trim()
  return comment && comment.includes(String(item.text || '')) ? 'quote' : 'option'
}

function reportQuotes(records) {
  const sourceById = new Map(records.map((record) => [String(record.id || ''), record]))
  return buildCustomerQuoteRegistry(records).map((quote) => {
    const source = sourceById.get(quote.recordId)
    return {
      ...quote,
      kind: v2QuoteKind(quote, source),
      productName: productOf(source),
      importMonth: monthOf(source),
      sourceProductName: sourceProductOf(source),
    }
  })
}

function previousMonths(months, kind) {
  const first = months[0]
  if (!first) return []
  const [year, month] = first.split('-').map(Number)
  const count = kind === 'quarter' ? 3 : 1
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - count + index, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

function monthRange(endMonth, count) {
  if (!/^\d{4}-\d{2}$/.test(endMonth)) return []
  const [year, month] = endMonth.split('-').map(Number)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

function scoreDistribution(rows) {
  const distribution = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(10 - index), 0]))
  for (const row of rows) {
    const score = Math.round(Number(row.score ?? scoreOf(row)))
    if (Number.isInteger(score) && score >= 1 && score <= 10) distribution[String(score)] += 1
  }
  return distribution
}

function callbackRate(rows) {
  const callback = rows.filter((row) => row.channel === 'callback' || row.sourceSubType === 'satisfaction_callback')
  return callback.length ? round(callback.filter((row) => Number(row.score ?? scoreOf(row)) === 10).length / callback.length * 100) : null
}

function trendFromRecords(rows, months, productName = '') {
  return months.map((month) => {
    const selected = rows.filter((row) => monthOf(row) === month && (!productName || productOf(row) === productName))
    return { month, value: average(selected), sample: selected.length }
  })
}

function productTrend(allRows, months, productName, productScores) {
  const remote = new Map()
  for (const row of productScores || []) {
    const sample = Number(row.sampleSize) || 0
    const score = Number(row.avgScore)
    if (productOf(row) !== productName || sample <= 0 || !Number.isFinite(score)) continue
    const prev = remote.get(row.date) || { total: 0, sample: 0 }
    remote.set(row.date, { total: prev.total + score * sample, sample: prev.sample + sample })
  }
  const byMonth = new Map([...remote].map(([month, row]) => [month, {
    month, value: round(row.total / row.sample), sample: row.sample,
  }]))
  for (const row of trendFromRecords(allRows, months, productName)) {
    if (row.sample) byMonth.set(row.month, row)
  }
  return months.map((month) => byMonth.get(month) || { month, value: null, sample: 0 })
}

function lifecycle(monthCounts, months) {
  const counts = months.map((month) => monthCounts[month] || 0)
  const active = counts.filter(Boolean).length
  if (!active) return ''
  if (active === months.length) return '贯穿全季'
  // 单月事件优先于已收敛（11-18 对照季报原型拍板）：仅 1 个月出现（含非末月）判单月；
  // 已收敛保留给"多个月出现后末月消失"的主题（原型 MOP 退订链路 0/3/0 → 单月事件（8月））
  if (active === 1) return `单月（${Number(months[counts.findIndex(Boolean)].slice(5))}月）`
  if (counts.at(-1) === 0 && counts.slice(0, -1).some(Boolean)) return '已收敛（末月无）'
  const max = Math.max(...counts)
  const peak = counts.indexOf(max)
  if (max >= 2 * (counts.reduce((sum, value) => sum + value, 0) - max)) {
    return `${Number(months[peak].slice(5))}月集中爆发`
  }
  return ''
}

/** 部门低分原因汇总行底色层级（11-18 拍板）：最低分 ≤5 红底优先，NEW 用徽章+橙底表达；与组件层 reasonRowClass 同源。 */
export function reportV2ReasonToneRank(row) {
  if (row.type === 'ten-option') return 2
  if (row.lowestScore != null && row.lowestScore <= 5) return 0
  if (row.isNew) return 1
  return 2
}

/**
 * 归并后主题行的生命周期判定（11-18 对齐原型改造）：输入按记录去重的月度计数，
 * 与单主题 lifecycle() 同规则；导出供组件层归并行共用，禁止再造副本。
 */
export function reportV2GroupedLifecycle(monthCounts, months) {
  return lifecycle(monthCounts, months)
}

/**
 * 归并后的问题主题标签（11-18 部门低分原因汇总对齐原型改造，单一真源）：
 * 分产品"问题主题分布"表与概述"部门低分原因汇总"表共用，禁止两处各写一套。
 * ten-option 组内合成时按命中行名归并（购买时参数/配置选择错误、价格/操作复杂等）。
 * 低分组映射（11-18 晚用户重新分类拍板）：
 *   购买参数/配置选择错误 ← 配置规格、购买参数/配置选择错误；
 *   操作与帮助文档 ← 任务操作流程、界面布局、帮助说明、内容/帮助、缺乏操作指引、帮助文档；
 *   安全类 ← 网络安全；
 *   功能缺失/不完善 ← 原功能组 + 多线BGP。
 * 未命中正则的标签走 LLM 语义归类（groupLabelOverrides 注入，见 buildTodoCandidates 同款管线）；无覆盖时按原文自成一档。
 */
export function reportV2ThemeGroupLabel(text, type, productName, groupLabelOverrides = null) {
  const value = String(text || '').trim()
  const overrides = groupLabelOverrides && typeof groupLabelOverrides === 'object' ? groupLabelOverrides : {}
  if (Object.prototype.hasOwnProperty.call(overrides, value)) return overrides[value]
  if (type === 'ten-option') {
    if (/购买时参数|配置选择错误/.test(value)) return '购买时参数/配置选择错误'
    if (/产品价格|价格没有优势|操作过于复杂|服务不好用/.test(value)) return '价格无优势 / 操作过于复杂'
    if (/不满足业务部署/.test(value)) return '不满足业务部署要求'
    return value
  }
  if (/功能有缺失|功能缺失.?不完善|无法绑定|不能绑定|多线BGP/.test(value)) return '功能缺失/不完善'
  if (/MOP.*退订|KCS.*退订|关联退订失败/.test(value)) return 'MOP 退订链路'
  if (/IP地区|IP 地区|地域.*IP|福建厦门.*北京/.test(value)) return 'IP 地域匹配'
  if (/配置规格|购买参数|配置选择错误/.test(value)) return '购买参数/配置选择错误'
  if (/任务操作流程|界面布局|帮助说明|内容\/帮助|缺乏操作指引|帮助文档/.test(value)) return '操作与帮助文档'
  if (/网络安全/.test(value)) return '安全类'
  if (productName === '弹性公网IP' && /共享带宽|双栈带宽|批量.*退|IP不能.*退/.test(value)) return '共享带宽能力限制'
  return value
}

/** LLM 语义归类的封闭组清单（11-18 拍板 strictLabels 只选不造）：正则组的并集，LLM 只能归入这些组 */
export const REPORT_V2_THEME_GROUPS = [
  '功能缺失/不完善', 'MOP 退订链路', 'IP 地域匹配', '购买参数/配置选择错误',
  '操作与帮助文档', '安全类', '共享带宽能力限制',
]

/**
 * 未命中正则归并的低分标签收集（11-18 LLM 语义归类输入）：
 * 报告文案生成时交给 LLM 按封闭组清单归类（strictLabels 只选不造）；
 * 语义归类结果经 overlay.narratives.themeGroupLabels 注入 reportV2ThemeGroupLabel。
 */
export function reportV2UngroupedThemeLabels(themes, groupLabelOverrides = {}) {
  const labels = new Set()
  for (const row of themes || []) {
    if (row.type !== 'low') continue
    const label = reportV2ThemeGroupLabel(row.theme, 'low', row.productName, groupLabelOverrides)
    if (label !== row.theme) continue
    if (labels.has(row.theme)) continue
    labels.add(row.theme)
  }
  return [...labels]
}

function themeRows(records, allRecords, visits, traces, links, months, earlierMonths, kind) {
  const relevant = new Set([...months, ...earlierMonths])
  const issues = resolveReportIssues(
    buildReportIssueOccurrences(allRecords.filter((record) => relevant.has(monthOf(record)))),
    visits, traces, links,
  )
  const sourceById = new Map(allRecords.map((record) => [String(record.id || ''), record]))
  const current = new Set(months)
  const previous = new Set(earlierMonths)
  const grouped = new Map()
  const previousCounts = new Map()
  for (const issue of issues) {
    if (issue.status === 'excluded_no_issue' || REASON_TAXONOMY_EXCLUDE.has(issue.issueName)) continue
    const score = issue.score == null ? null : Number(issue.score)
    const issueKind = v2QuoteKind(issue, sourceById.get(issue.recordId))
    const isTenOption = issueKind === 'option' && score === 10
    const isLow = score != null && Number.isFinite(score) && score >= 1 && score < 10
      && (issueKind === 'option' || reportV2QuoteCategory({ ...issue, kind: issueKind }) === '负反馈')
      && isSubstantiveFeedbackReason(issue.issueName)
    if (!isTenOption && !isLow) continue
    const productName = REPORT_PRODUCT_ALIASES.get(issue.productName) || issue.productName
    const key = `${productName}\0${isTenOption ? 'ten-option' : 'low'}\0${issue.issueName}`
    if (previous.has(issue.month)) {
      const ids = previousCounts.get(key) || new Set()
      ids.add(issue.recordId)
      previousCounts.set(key, ids)
    }
    if (!current.has(issue.month)) continue
    const row = grouped.get(key) || {
      key, productName, theme: issue.issueName, type: isTenOption ? 'ten-option' : 'low',
      lowestScore: null, recordIds: new Set(), pieceIds: new Set(), customerKeys: new Set(),
      monthRecordIds: new Map(), occurrences: [],
    }
    row.recordIds.add(issue.recordId)
    row.pieceIds.add(issue.pieceId)
    row.customerKeys.add(issue.customerCode || issue.customerName || issue.recordId)
    const monthSet = row.monthRecordIds.get(issue.month) || new Set()
    monthSet.add(issue.recordId)
    row.monthRecordIds.set(issue.month, monthSet)
    row.lowestScore = row.lowestScore == null ? score : Math.min(row.lowestScore, score)
    row.occurrences.push({ ...issue, kind: issueKind })
    grouped.set(key, row)
  }
  return [...grouped.values()].map((row) => {
    const monthCounts = Object.fromEntries(months.map((month) => [month, row.monthRecordIds.get(month)?.size || 0]))
    const life = kind === 'quarter' ? lifecycle(monthCounts, months) : ''
    const previousCount = previousCounts.get(row.key)?.size || 0
    const linkedVisitIds = distinct(row.occurrences.flatMap((item) => item.linkedVisitIds || []))
    const linkedVisits = visits.filter((visit) => linkedVisitIds.includes(String(visit.id)))
    const dissatisfied = linkedVisits.some((visit) =>
      /不满|未解决|仍有问题|需要优化/.test(String(visit.visitResult || visit.visitFeedbackDetail || '')))
    const nonActionable = (linkedVisits.length > 0 && linkedVisits.every((visit) => ['无法回访', '已清退'].includes(visitCategory(visit))))
      || row.occurrences.every((item) => /测试账号|测试用户/.test(String(item.customerName || '')))
    const consecutive = kind === 'month' && previousCount > 0
    let priority = 'P2'
    if (row.type === 'low' && (dissatisfied || (row.lowestScore <= 5 && isSubstantiveFeedbackReason(row.theme)) || consecutive)) priority = 'P0'
    else if (row.type === 'low' && row.lowestScore <= 8) priority = 'P1'
    if (kind === 'quarter') {
      if (life.startsWith('已收敛')) priority = 'P2'
      else if (life === '贯穿全季' && row.lowestScore <= 5) priority = 'P0'
      else if (life.includes('集中爆发') && row.lowestScore <= 5) priority = 'P0'
    }
    if (nonActionable) priority = 'P2'
    return {
      key: row.key, productName: row.productName, theme: row.theme, type: row.type,
      count: row.recordIds.size, segmentCount: row.pieceIds.size, customerCount: row.customerKeys.size,
      lowestScore: row.lowestScore, monthCounts,
      monthRecordIds: Object.fromEntries(months.map((month) => [month, [...(row.monthRecordIds.get(month) || [])]])),
      lifecycle: life, priority,
      isNew: previousCount === 0, previousCount, dissatisfied, nonActionable,
      recordIds: [...row.recordIds], customerKeys: [...row.customerKeys],
      linkedTraceIds: distinct(row.occurrences.flatMap((item) => item.linkedTraceIds || [])),
      linkedVisitIds,
      quotes: distinct(row.occurrences.filter((item) => item.kind === 'quote').map((item) => item.text)).slice(0, 3),
      // 11-18 晚信息密度改造：最低分处的典型客户原话（渲染层"典型：「…」· N 分"行）。
      // console 渠道的 occurrence 文本恒等于主题名本身（reason 列聚合键），无信息增量，
      // 故只取该主题最低分记录的 commentText（客户自由原话列，不进 occurrences）；
      // 原话自成一档的行行名已是全文原话，无需典型行（渲染层省略）。
      lowestQuotes: distinct([...row.recordIds]
        .map((recordId) => sourceById.get(String(recordId)))
        .filter((record) => record && Number(record.ratingScore ?? record.score) === row.lowestScore)
        .map((record) => String(record.commentText || record.rawComment || '').trim())
        .filter((text) => isValidCustomerText(text)))
        .sort((a, b) => b.length - a.length).slice(0, 2),
    }
  }).sort((a, b) => ({ P0: 0, P1: 1, P2: 2 }[a.priority] - { P0: 0, P1: 1, P2: 2 }[b.priority])
    || a.lowestScore - b.lowestScore || b.count - a.count || a.theme.localeCompare(b.theme, 'zh'))
}

function visitCategory(visit) {
  const text = [visit.visitResult, visit.internalConclusion, visit.internalEvaluationDetail].filter(Boolean).join(' ')
  if (/清退/.test(text)) return '已清退'
  if (/无法回访|联系不上|未接通/.test(text)) return '无法回访'
  if (/专项优化|需要优化|待优化/.test(text)) return '专项优化'
  if (/无实际不满|无问题|无需优改|无需优化/.test(text)) return '无需优改'
  return '待核实'
}

function previousVisitRows(visits, reportKey) {
  const previousMonth = previousMonths([reportKey], 'month')[0]
  return visits.filter((visit) => (visit.importMonth || visit.visitMonth) === previousMonth)
    .map((visit) => {
      const customerName = String(visit.customerName || visit.userInfoDetail || visit.userInfo || '').trim() || '未标注客户'
      const visitResult = String(visit.visitResult || visit.visitFeedbackDetail || visit.feedbackSummary || '').trim()
      return {
        id: String(visit.id || `${customerName}-${productOf(visit)}-${visitResult}`),
        customerName,
        productName: productOf(visit),
        visitResult,
        internalConclusion: String(visit.internalConclusion || visit.internalEvaluationDetail || '').trim(),
        remark: String(visit.remark || '').trim(),
        category: visitCategory(visit),
      }
    })
}

/**
 * V2 待办候选收集（11-18 需求）：三路来源，只收本周期未完结项。
 * 口径拍板：①产品部溯源（本周期 importMonth，状态≠已处理，旧枚举归一）；
 * ②省代表回访（本周期月份，评估状态≠已评估，谓词走 visitEvaluationState 共享层）；
 * ③用后即评举措（source=post_use，firstProposedAt ∈ 周期，状态仅待评估/进行中）。
 * 更早周期遗留的未完结项不收（历史进展由报告链接行引导至平台查看）。
 * 客户姓名脱敏（与 V2 文档层 mask 同形：首字符+****+尾字符）——LLM 输入与兜底文案共用。
 */
function todoCandidateFacts(candidate) {
  const facts = []
  // 11-18 口径：候选事实文本同时供 LLM 输入与兜底文案渲染，统一手机号打码（姓名已由 customerMaskedName 脱敏）
  const customer = candidate.customerMaskedName ? `客户 ${candidate.customerMaskedName}` : ''
  if (candidate.sourceKind === 'trace') {
    if (customer) facts.push(`${customer}反馈「${maskPhoneInText(String(candidate.customerFeedback || '')).slice(0, 60)}」`)
    if (candidate.progress) facts.push(`回溯进展：${maskPhoneInText(String(candidate.progress)).slice(0, 80)}`)
    if (!candidate.progress && candidate.recommendedReason) facts.push(`建议回溯：${maskPhoneInText(String(candidate.recommendedReason)).slice(0, 80)}`)
    // 跨源合并（11-18）：同客户回访待办并入后，一行同时呈现回溯与回访评估两件事
    if (candidate.mergedVisit) {
      const visitText = maskPhoneInText(String(candidate.mergedVisit.visitResult || '')).slice(0, 80)
      if (visitText) facts.push(`省代表回访：${visitText}`)
      if (candidate.mergedVisit.evaluationState === '评估中') facts.push('回访内部评估已暂存，待提交完结')
    }
  } else if (candidate.sourceKind === 'visit') {
    if (customer) facts.push(`${customer}的回访记录：${maskPhoneInText(String(candidate.visitResult || '')).slice(0, 80)}`)
    if (candidate.evaluationState === '评估中') facts.push('内部评估已暂存，待提交完结')
  } else if (candidate.sourceKind === 'action') {
    if (candidate.actionContent) facts.push(`举措内容：${maskPhoneInText(String(candidate.actionContent)).slice(0, 100)}`)
    if (candidate.actionStatus === '待评估') facts.push('举措待评估推进')
  }
  return facts
}

function todoFallbackContent(candidate) {
  const facts = todoCandidateFacts(candidate)
  const lead = candidate.sourceKind === 'trace'
    ? (candidate.mergedVisit ? '跟进回溯闭环并完成回访评估' : '跟进产品部回溯闭环')
    : candidate.sourceKind === 'visit' ? '完成省代表回访评估'
      : '推进举措落地'
  return facts.length ? `${lead}：${facts.join('；')}` : lead
}

function buildTodoCandidates({ months, visits = [], traces = [], actionItems = [] }) {
  const monthSet = new Set(months)
  const inPeriod = (monthText) => String(monthText || '').split('、').map((m) => m.trim()).filter(Boolean).some((m) => monthSet.has(m))
  // 候选 id 兜底键：无 id 的行用 月份:客户键:产品 拼；空段一律空串（11-18 修复：禁止 "undefined" 字面量进 id）
  const fallbackKeyOf = (monthText, customerCode, customerName, productName) =>
    [monthText, String(customerCode || '').trim() || String(customerName || '').trim(), productName]
      .map((part) => String(part || '').trim()).join(':')
  // 跨源合并客户键（11-18 拍板）：customerCode 优先，空则 customerName（原始值比对），都空不参与匹配
  const mergeCustomerKeyOf = (record) => {
    const code = String(record?.customerCode || '').trim()
    if (code) return `code:${code}`
    const name = String(record?.customerName || '').trim()
    return name ? `name:${name}` : ''
  }
  const candidates = []
  for (const trace of traces) {
    if (!inPeriod(trace.importMonth)) continue
    if (normalizePostUseJiraStatus(trace.status) === '已处理') continue
    const productName = String(trace.product || trace.productName || '').trim()
    const customerMaskedName = maskCustomerName(trace.customerName)
    const candidate = {
      id: `todo-trace:${String(trace.id || fallbackKeyOf(trace.importMonth, trace.customerCode, trace.customerName, productName))}`,
      sourceKind: 'trace', productName,
      mergeCustomerKey: mergeCustomerKeyOf(trace),
      customerMaskedName,
      customerFeedback: String(trace.customerFeedback || '').trim(),
      recommendedReason: String(trace.recommendedReason || '').trim(),
      progress: String(trace.progress || '').trim(),
      owner: String(trace.assigneeName || '').trim(),
      team: '',
      status: normalizePostUseJiraStatus(trace.status),
    }
    candidates.push({ ...candidate, facts: todoCandidateFacts(candidate), fallbackContent: todoFallbackContent(candidate) })
  }
  for (const visit of visits) {
    if (!inPeriod(visit.importMonth || visit.visitMonth)) continue
    const state = visitEvaluationState(visit)
    if (state === '已评估') continue
    const productName = String(visit.product || visit.productName || '').trim()
    const customerMaskedName = maskCustomerName(visit.customerName)
    const candidate = {
      id: `todo-visit:${String(visit.id || fallbackKeyOf(visit.importMonth || visit.visitMonth, visit.customerCode, visit.customerName, productName))}`,
      sourceKind: 'visit', productName,
      mergeCustomerKey: mergeCustomerKeyOf(visit),
      customerMaskedName,
      visitResult: String(visit.visitResult || visit.visitFeedbackDetail || visit.feedbackSummary || '').trim(),
      evaluationState: state,
      owner: String(visit.assigneeName || '').trim(),
      team: '',
      status: state,
    }
    // 跨源合并（11-18 拍板）：同客户同产品的回访待办并入对应溯源待办，一行呈现"回溯+回访评估"两件事。
    // 合并后不删 trace 行的独立语义——facts/fallback 由 mergedVisit 驱动重算；owner 取溯源经办人优先。
    const mergeTarget = candidate.mergeCustomerKey
      && candidates.find((row) => row.sourceKind === 'trace' && row.mergeCustomerKey === candidate.mergeCustomerKey && row.productName === productName)
    if (mergeTarget) {
      const merged = {
        ...mergeTarget,
        mergedVisit: { id: candidate.id, visitResult: candidate.visitResult, evaluationState: candidate.evaluationState, owner: candidate.owner },
        owner: mergeTarget.owner || candidate.owner,
        status: mergeTarget.status === '待处理' ? '待处理' : mergeTarget.status,
      }
      merged.facts = todoCandidateFacts(merged)
      merged.fallbackContent = todoFallbackContent(merged)
      candidates.splice(candidates.indexOf(mergeTarget), 1, merged)
      continue
    }
    candidates.push({ ...candidate, facts: todoCandidateFacts(candidate), fallbackContent: todoFallbackContent(candidate) })
  }
  for (const action of actionItems) {
    if (action.source !== 'post_use') continue
    if (!['pending_evaluation', 'in_progress'].includes(action.status)) continue
    if (!inPeriod(action.firstProposedAt?.slice(0, 7))) continue
    const productName = String(action.product || action.productName || '').trim()
    const candidate = {
      id: `todo-action:${String(action.id || '')}`,
      sourceKind: 'action', productName,
      customerMaskedName: '',
      actionContent: String(action.content || '').trim(),
      actionStatus: action.status === 'in_progress' ? '进行中' : '待评估',
      owner: '', team: '',
      status: action.status === 'in_progress' ? '进行中' : '待评估',
    }
    candidates.push({ ...candidate, facts: todoCandidateFacts(candidate), fallbackContent: todoFallbackContent(candidate) })
  }
  return candidates
}

function focusActionType(row, trace, visit) {
  if (row.dissatisfied || (visit && /不满|未解决|仍有问题|还没改/.test(String(visit.visitResult || visit.visitFeedbackDetail || '')))) return '回访跟进'
  if (/故障|不通|稳定性|网络质量|卡单|缺陷/.test(`${row.theme} ${trace?.recommendedReason || ''}`)) return '缺陷修复'
  if (/功能|能力|接口|API|配置|批量|指标|诉求|界面|布局|体验|操作/.test(row.theme)) return '诉求闭环'
  if (/回访/.test(String(trace?.recommendedReason || ''))) return '回访跟进'
  return '回访跟进'
}

function focusFacts(row, trace, visit, months, kind, visitInferred = false, backgroundTrace = null) {
  const facts = []
  // 11-18 口径：LLM 输入侧自由文本统一手机号打码（姓名脱敏已有 maskCustomerName，此处补电话维度）
  const visitText = maskPhoneInText(String(visit?.visitResult || visit?.visitFeedbackDetail || '').trim())
  if (visitText) facts.push(`${visitInferred ? '同客户省代表回访' : '省代表回访'}：「${visitText.slice(0, 100)}」`)
  const traceText = maskPhoneInText(String(trace?.recommendedReason || trace?.progress || '').trim())
  if (traceText) facts.push(`产品部溯源：${traceText.slice(0, 140)}`)
  const backgroundText = maskPhoneInText(String(backgroundTrace?.recommendedReason || backgroundTrace?.progress || '').trim())
  if (!traceText && backgroundText) facts.push(`产品部溯源背景：${backgroundText.slice(0, 140)}`)
  if (!visitText && row.quotes[0]) facts.push(`客户原话：「${maskPhoneInText(row.quotes[0]).slice(0, 100)}」`)
  if (kind === 'quarter') facts.push(`月度分布：${months.map((month) => `${Number(month.slice(5))}月 ${row.monthCounts[month] || 0} 条`).join('、')}`)
  else if (row.previousCount) facts.push(`上期 ${row.previousCount} 条，本期 ${row.count} 条`)
  return facts.join('；') || `本期关联 ${row.count} 条评分记录，最低 ${row.lowestScore} 分。`
}

function inferVisitForTheme(row, themes, visits) {
  const candidates = visits.filter((visit) => {
    const customer = String(visit.customerCode || visit.customerName || '').trim()
    const visitMonths = String(visit.importMonth || visit.visitMonth || '').split('、').map((month) => month.trim())
    if (!customer || productOf(visit) !== row.productName || !row.customerKeys.includes(customer)
      || !visitMonths.some((month) => row.monthCounts[month] > 0)) return false
    const relatedRecords = distinct(themes.filter((theme) => theme.productName === row.productName
      && theme.customerKeys.includes(customer)
      && visitMonths.some((month) => theme.monthCounts[month] > 0)).flatMap((theme) => theme.recordIds))
    return relatedRecords.length === 1 && row.recordIds.includes(relatedRecords[0])
  })
  return candidates.length === 1 ? candidates[0] : null
}

function actionRows(themes, traces, visits, actions, months, kind) {
  return themes.filter((row) => row.type === 'low').map((row) => {
    const linkedTraceIds = new Set(row.linkedTraceIds || [])
    const matchingTraces = traces.filter((item) => linkedTraceIds.has(String(item.id)))
    const traceOwners = distinct(matchingTraces.map((item) => String(item.assigneeName || '').trim()))
    const trace = matchingTraces.length === 1 ? matchingTraces[0] : null
    const periodTraces = traces.filter((item) => productOf(item) === row.productName
      && String(item.importMonth || '').split('、').some((month) => months.includes(month.trim())))
    const backgroundTrace = !trace && periodTraces.length === 1 ? periodTraces[0] : null
    const linkedVisitIds = new Set(row.linkedVisitIds || [])
    const matchingVisits = visits.filter((item) => linkedVisitIds.has(String(item.id)))
    const directVisit = matchingVisits.length === 1 ? matchingVisits[0] : null
    const visit = directVisit || inferVisitForTheme(row, themes, visits)
    const visitInferred = Boolean(visit && !directVisit)
    const customerDissatisfied = row.dissatisfied || Boolean(visit && /不满|未解决|仍有问题|还没改/.test(String(visit.visitResult || visit.visitFeedbackDetail || '')))
    const recordIds = new Set(row.recordIds)
    const action = actions.find((item) => productOf(item) === row.productName
      && item.linkedDataSources?.includes('post_use_rating')
      && item.evidenceRecordIds?.some((id) => recordIds.has(String(id))))
    const verb = row.nonActionable ? '无法回访，无需跟进'
      : row.priority === 'P2' ? '纳入常规运营关注，下期仅观察计数变化，不单独推动'
      : row.lifecycle.startsWith('已收敛') ? '下季度验证问题是否持续收敛'
        : trace?.recommendedReason || action?.content
          || (row.lifecycle === '贯穿全季' ? `治理「${row.theme}」的根因并复核效果`
            : row.lifecycle.includes('集中爆发') ? `定位「${row.theme}」集中月份的事件并明确治理时点`
              : row.lifecycle.startsWith('单月') ? `回访核实「${row.theme}」并观察是否再现`
                : `核查「${row.theme}」并明确处理结论`)
    const actionType = focusActionType(row, trace || backgroundTrace, visit)
    const severity = `${row.count} 条，最低 ${row.lowestScore} 分`
    const title = customerDissatisfied
      ? `${row.productName}「${row.theme}」客户回访明确不满，需跟进回应`
      : kind === 'quarter' && row.lifecycle
        ? `${row.productName}「${row.theme}」${row.lifecycle}（${severity}），需${actionType === '缺陷修复' ? '定位并修复' : '回应诉求'}`
        : `${row.productName}「${row.theme}」${row.previousCount ? '连续两期出现，' : ''}本期 ${severity}，需${actionType === '缺陷修复' ? '定位修复' : '明确处理结论'}`
    return {
      id: row.key, productName: row.productName, theme: row.theme, priority: row.priority,
      lifecycle: row.lifecycle, text: String(verb).trim(), actionType, title,
      detail: focusFacts(row, trace, visit, months, kind, visitInferred, backgroundTrace),
      customerDissatisfied,
      isNew: row.isNew, previousCount: row.previousCount, lowestScore: row.lowestScore,
      owner: traceOwners.length === 1 ? traceOwners[0] : '',
      team: String(action?.team || '').trim(), status: String(action?.status || trace?.status || '待处理'),
      check: row.priority === 'P2' ? '下期观察同类反馈计数' : '复核客户反馈及后续评分',
      sourceRecordCount: row.count, recordIds: row.recordIds,
    }
  })
}

function selectFocus(actions, kind, products) {
  const belowNine = new Set(products.filter((row) => row.belowNine).map((row) => row.name))
  const rank = (row) => {
    if (row.customerDissatisfied) return 0
    if (kind === 'quarter' && row.lifecycle?.includes('集中爆发')) return 1
    if (kind === 'quarter' && row.lifecycle === '贯穿全季') return 2
    if (kind === 'month' && row.previousCount) return 1
    return 3
  }
  const ordered = actions.filter((row) => row.priority === 'P0')
    .sort((a, b) => rank(a) - rank(b)
      || Number(belowNine.has(b.productName)) - Number(belowNine.has(a.productName))
      || b.sourceRecordCount - a.sourceRecordCount)
  const selected = []
  const selectedProducts = new Set()
  for (const row of ordered) {
    if (selectedProducts.has(row.productName)) continue
    selected.push(row)
    selectedProducts.add(row.productName)
    if (selected.length === 3) return selected
  }
  for (const row of ordered) {
    if (selected.some((item) => item.id === row.id)) continue
    selected.push(row)
    if (selected.length === 3) break
  }
  return selected
}

function capActionsByProduct(actions, focus) {
  const focusIds = new Set(focus.map((row) => row.id))
  const grouped = new Map()
  for (const action of actions) {
    const list = grouped.get(action.productName) || []
    list.push(action)
    grouped.set(action.productName, list)
  }
  const result = []
  for (const [productName, rows] of grouped) {
    if (rows.length <= 5) {
      result.push(...rows)
      continue
    }
    const keep = rows.filter((row) => focusIds.has(row.id))
    for (const row of rows) {
      if (keep.length >= 4) break
      if (!focusIds.has(row.id)) keep.push(row)
    }
    const keptIds = new Set(keep.map((row) => row.id))
    const rest = rows.filter((row) => !keptIds.has(row.id))
    const priority = rest.find((row) => row.priority === 'P0') ? 'P0'
      : rest.find((row) => row.priority === 'P1') ? 'P1' : 'P2'
    const recordIds = distinct(rest.flatMap((row) => row.recordIds || []))
    const themes = distinct(rest.map((row) => row.theme))
    const owners = distinct(rest.map((row) => row.owner))
    const teams = distinct(rest.map((row) => row.team))
    const text = priority === 'P2'
      ? '纳入常规运营关注，下期仅观察计数变化，不单独推动'
      : `合并核查「${themes.slice(0, 2).join('」「')}」等 ${themes.length} 类问题，逐项明确处理结论`
    let hash = 2166136261
    for (const char of rest.map((row) => row.id).join('|')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    const merged = {
      id: `merged:${productName}:${(hash >>> 0).toString(36)}`,
      productName, theme: `其他 ${themes.length} 类问题`, priority,
      text, owner: owners.length === 1 ? owners[0] : '',
      team: teams.length === 1 ? teams[0] : '',
      status: '待处理', check: priority === 'P2' ? '下期观察同类反馈计数' : '逐项复核客户反馈及后续评分',
      sourceRecordCount: recordIds.length, recordIds,
      mergedThemeCount: themes.length,
    }
    result.push(...[...keep, merged].sort((a, b) => ({ P0: 0, P1: 1, P2: 2 }[a.priority] - { P0: 0, P1: 1, P2: 2 }[b.priority])))
  }
  return result
}

function dataFingerprint(model) {
  const facts = JSON.stringify([
    model.reportKey, model.kpis, model.products.map((row) => [
      row.name, row.sample, row.avg, row.distribution,
      row.sourceSpecRecords.map((source) => [source.recordId, source.sourceProductName]),
    ]),
    model.themes.map((row) => [row.key, row.count, row.lowestScore, row.monthCounts]),
    model.positiveCount,
    model.actions.map((row) => [row.id, row.text, row.title, row.detail, row.owner, row.status]),
    model.previousVisits.map((row) => [row.id, row.visitResult, row.internalConclusion]),
  ])
  let hash = 2166136261
  for (let index = 0; index < facts.length; index += 1) hash = Math.imul(hash ^ facts.charCodeAt(index), 16777619)
  return `v2:${(hash >>> 0).toString(36)}`
}

/** Build one factual model for online display, offline HTML and print. */
export function buildPostUseReportV2Model({ reportKey, reportKind, reportPeriod, records = [], companyRecords = [], allRecords = [], allCompanyRecords = [], visits = [], traces = [], issueLinks = [], actionItems = [], statusTrends = null, overlay = null }) {
  const kind = reportKind === 'quarter' ? 'quarter' : 'month'
  const months = postUsePeriodMonths(reportPeriod)
  const monthSet = new Set(months)
  const previous = previousMonths(months, kind)
  const currentScored = records.filter(isScored)
  const companyScored = companyRecords.filter(isScored)
  const historyScored = allRecords.filter(isScored)
  const companyHistory = allCompanyRecords.filter(isScored)
  const groups = new Map()
  for (const row of currentScored) {
    const name = productOf(row)
    const list = groups.get(name) || []
    list.push(row)
    groups.set(name, list)
  }
  const recordsByProduct = new Map()
  for (const row of records) {
    const name = productOf(row)
    const list = recordsByProduct.get(name) || []
    list.push(row)
    recordsByProduct.set(name, list)
  }
  const sourceSpecsByProduct = new Map()
  for (const row of records) {
    const name = productOf(row)
    const sourceProductName = sourceProductOf(row)
    if (!sourceProductName || sourceProductName === name) continue
    const list = sourceSpecsByProduct.get(name) || []
    list.push({
      recordId: String(row.id || ''),
      sourceProductName,
      importMonth: monthOf(row),
      score: isScored(row) ? scoreOf(row) : null,
      channel: row.channel || '',
      answeredAt: row.createdAt || '',
      customerName: row.customerName || '',
      customerCode: row.customerCode || '',
      countedInScore: isScored(row),
    })
    sourceSpecsByProduct.set(name, list)
  }
  const themes = themeRows(currentScored, allRecords, visits, traces, issueLinks, months, previous, kind)
  const reportVisits = visits.filter((row) => monthSet.has(row.importMonth || row.visitMonth))
  const productNames = [...groups.keys()]
  const productTrendMonths = monthRange(months.at(-1) || '', kind === 'quarter' ? 14 : 5)
  const overviewTrendMonths = monthRange(months.at(-1) || '', 6)
  const products = productNames.map((name) => {
    const rows = groups.get(name) || []
    const scores = rows.map((row) => Number(scoreOf(row)))
    const productThemes = themes.filter((row) => row.productName === name)
    const previousRows = historyScored.filter((row) => previous.includes(monthOf(row)) && productOf(row) === name)
    const quotes = reportQuotes(recordsByProduct.get(name) || [])
    const positive = quotes.filter(isReportV2PraiseQuote)
    const neutralCount = quotes.filter((quote) => reportV2QuoteCategory(quote) === '中性备注').length
    const sourceSpecRecords = sourceSpecsByProduct.get(name) || []
    const sample = rows.length
    const avg = average(rows)
    const hasQuote = productThemes.some((row) => row.quotes.length)
    const smallQuarterSample = kind === 'quarter' && sample < 5 && !hasQuote
    const belowNine = avg != null && avg < SCORE_BASELINE && !smallQuarterSample
    const status = belowNine || productThemes.some((row) => row.priority === 'P0') ? '重点改善' : '持续观察'
    return {
      name, sample, avg, previousSample: previousRows.length, previousAvg: average(previousRows),
      previousLowThree: previousRows.filter((row) => scoreOf(row) <= 3).length,
      nonTen: scores.filter((score) => score !== 10).length,
      lowThree: scores.filter((score) => score <= 3).length,
      distribution: scoreDistribution(rows),
      callbackRate: callbackRate(rows),
      belowNine, smallQuarterSample, status, themes: productThemes,
      monthly: productTrend(historyScored, months, name, statusTrends?.productScores),
      trend: productTrend(historyScored, productTrendMonths, name, statusTrends?.productScores),
      nonTenMonths: distinct(rows.filter((row) => scoreOf(row) !== 10).map(monthOf)),
      lowThreeMonths: distinct(rows.filter((row) => scoreOf(row) <= 3).map(monthOf)),
      callbackMonths: distinct(rows.filter((row) => row.channel === 'callback' || row.sourceSubType === 'satisfaction_callback').map(monthOf)),
      quotes, positive: positive.slice(0, 3), positiveCount: positive.length, neutralCount,
      sourceSpecRecords,
      visits: reportVisits.filter((row) => productOf(row) === name),
      traces: traces.filter((row) => productOf(row) === name && String(row.importMonth || '').split('、').some((month) => monthSet.has(month.trim()))),
    }
  }).sort((a, b) => Number(b.belowNine) - Number(a.belowNine)
    || Number(b.status === '重点改善') - Number(a.status === '重点改善')
    || b.sample - a.sample || a.name.localeCompare(b.name, 'zh'))
  const rawActions = actionRows(themes, traces, visits, actionItems, months, kind)
  const focus = selectFocus(rawActions, kind, products)
  const allActions = capActionsByProduct(rawActions, focus)
  const todoCandidates = buildTodoCandidates({ months, visits, traces, actionItems })
  // LLM 语义归类覆盖表（11-18 拍板）：overlay.narratives.themeGroupLabels 由"生成报告文案"管线写入，
  // 未命中正则的标签 → LLM 归入封闭组；旧快照无该字段时回退纯正则（groupLabelOverrides 为空对象）
  const groupLabelOverrides = overlay?.narratives?.themeGroupLabels && typeof overlay.narratives.themeGroupLabels === 'object'
    ? overlay.narratives.themeGroupLabels : {}
  const registry = reportQuotes(records)
  const positiveRegistry = registry.filter(isReportV2PraiseQuote)
  const reasonsMap = new Map()
  for (const row of themes) {
    // 部门表 10 分选项类合成一行；低分组按共享归并标签聚合（11-18 对齐原型）
    const key = row.type === 'ten-option' ? 'ten-option' : reportV2ThemeGroupLabel(row.theme, 'low', row.productName, groupLabelOverrides)
    const entry = reasonsMap.get(key) || {
      name: row.type === 'ten-option' ? '10 分反馈选项类' : key,
      type: row.type, count: 0, segmentCount: 0, lowestScore: null,
      recordIds: new Set(), productCounts: new Map(), monthRecordIds: new Map(),
      memberThemes: new Map(), themeKeys: new Map(),
      newRecordIds: new Set(), priorRecordIds: new Set(),
    }
    for (const recordId of row.recordIds) {
      entry.recordIds.add(recordId)
      if (row.isNew) entry.newRecordIds.add(recordId)
      else entry.priorRecordIds.add(recordId)
      const month = Object.keys(row.monthRecordIds || {}).find((m) => (row.monthRecordIds[m] || []).includes(recordId))
      const monthSet = entry.monthRecordIds.get(month) || new Set()
      monthSet.add(recordId)
      entry.monthRecordIds.set(month, monthSet)
    }
    entry.count = entry.recordIds.size
    entry.segmentCount += row.segmentCount || 0
    entry.lowestScore = entry.lowestScore == null ? row.lowestScore : Math.min(entry.lowestScore, row.lowestScore)
    entry.productCounts.set(row.productName, (entry.productCounts.get(row.productName) || 0) + row.count)
    const members = entry.memberThemes.get(row.theme) || { count: 0, lowestScore: null, quotes: [] }
    members.count += row.count
    members.lowestScore = members.lowestScore == null ? row.lowestScore : Math.min(members.lowestScore, row.lowestScore)
    // 成员级典型原话（11-18 信息密度改造）：来自最低分记录，渲染层选主导成员的原话展示
    members.quotes = distinct([...(members.quotes || []), ...(row.lowestQuotes || [])])
    entry.memberThemes.set(row.theme, members)
    entry.themeKeys.set(row.theme, row.key)
    reasonsMap.set(key, entry)
  }
  const reasons = [...reasonsMap.values()].map((row) => {
    // 组级 NEW 语义（11-18 拍板）：组内全部成员记录均来自本期新增（上期 0→N）才打 NEW
    const isNew = row.recordIds.size > 0 && row.newRecordIds.size === row.recordIds.size
    const previousCount = row.recordIds.size - row.newRecordIds.size
    const monthCounts = Object.fromEntries(months.map((month) => [month, row.monthRecordIds.get(month)?.size || 0]))
    return {
      name: row.name, type: row.type, count: row.count, segmentCount: row.segmentCount,
      lowestScore: row.lowestScore, isNew, previousCount,
      products: [...row.productCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh')),
      memberThemes: [...row.memberThemes.entries()].map(([theme, meta]) => ({ theme, ...meta })).sort((a, b) => b.count - a.count),
      monthCounts,
      lifecycle: kind === 'quarter' ? lifecycle(monthCounts, months) : '',
    }
  }).sort((a, b) => Number(a.type === 'ten-option') - Number(b.type === 'ten-option')
    // 排序拍板（11-18）：10 分选项殿后，其余按 底色层级（≤5 红 → NEW 橙 → 默认）→ 最低分升序 → 条数降序
    || reportV2ReasonToneRank(a) - reportV2ReasonToneRank(b)
    || a.lowestScore - b.lowestScore || b.count - a.count)
  const avg = average(currentScored)
  const companyAvg = average(companyScored)
  const previousAvg = average(historyScored.filter((row) => previous.includes(monthOf(row))))
  const publishedStatus = new Map((statusTrends?.combined?.data || []).map((row) => [row.date, row]))
  const departmentTrend = overviewTrendMonths.map((month) => {
    const row = publishedStatus.get(month)
    return { month, value: row?.department ?? trendFromRecords(historyScored, [month])[0]?.value ?? null }
  })
  const companyTrend = overviewTrendMonths.map((month) => {
    const row = publishedStatus.get(month)
    return { month, value: row?.company ?? trendFromRecords(companyHistory, [month])[0]?.value ?? null }
  })
  const satisfactionMonths = overviewTrendMonths.map((month) => {
    const selected = historyScored.filter((row) => monthOf(row) === month)
    const rate = publishedStatus.get(month)?.departmentRate ?? callbackRate(selected)
    return { month, value: rate }
  })
  const quarterMonthlyTrend = months.map((month) => departmentTrend.find((row) => row.month === month)
    || { month, value: trendFromRecords(historyScored, [month])[0]?.value ?? null })
  const quarterLow = quarterMonthlyTrend.filter((row) => row.value != null)
    .sort((a, b) => a.value - b.value)[0] || null
  const quarterChange = kind === 'quarter'
    ? (() => {
      const important = themes.find((row) => row.lifecycle.includes('集中爆发'))
        || themes.find((row) => row.lifecycle === '贯穿全季')
        || themes.find((row) => row.lifecycle.startsWith('已收敛'))
      if (important) return `${important.productName}「${important.theme}」在${important.lifecycle}，${important.priority === 'P0' ? '需优先核查。' : '建议持续观察。'}`
      return quarterLow ? `${Number(quarterLow.month.slice(5))}月部门均分最低，为 ${quarterLow.value} 分；季末均分 ${quarterMonthlyTrend.at(-1)?.value ?? '—'} 分。` : '本季无可比较的评分月份。'
    })()
    : ''
  const model = {
    version: 'v2', reportKey, kind, months, previousMonths: previous,
    title: kind === 'quarter' ? `用后即评季报（${reportPeriod?.label || reportKey}）` : `用后即评月报（${reportKey.replace('-', '.')}）`,
    kpis: {
      avg, companyAvg, previousAvg,
      experienceAvg: average(currentScored.filter((row) => row.channel === 'sms' || row.channel === 'console')),
      totalSample: currentScored.length,
      companySample: companyScored.length,
      productCount: products.length,
      belowNineCount: products.filter((row) => row.belowNine).length,
      belowNineNames: products.filter((row) => row.belowNine).map((row) => row.name),
      callbackUnqualifiedCount: computeInternalSatisfactionMetrics(
        postUseRecordsToScoredRows(currentScored.map((row) => ({ ...row, productName: productOf(row) }))),
        { productNames: productNames },
      ).notQualified.length,
    },
    products, themes, reasons, actions: allActions, focus,
    themeGroupLabels: groupLabelOverrides,
    // 11-18 LLM 语义归类输入：未命中正则的低分标签清单（已命中覆盖表的标签不再送 LLM）
    ungroupedThemes: reportV2UngroupedThemeLabels(themes, groupLabelOverrides),
    departmentTrend,
    companyTrend,
    satisfactionTrend: satisfactionMonths,
    quarterMonthlyTrend,
    quarterChange,
    positiveCount: positiveRegistry.length,
    quoteRegistry: registry,
    lowScoreRecordCount: distinct(themes.filter((row) => row.type === 'low' && row.lowestScore <= 5).flatMap((row) => row.recordIds)).length,
    previousVisits: kind === 'month' ? previousVisitRows(visits, reportKey) : [],
    customers: buildCustomerInsights(
      currentScored.map((row) => ({ ...row, productName: productOf(row) })),
      reportVisits.filter((visit) => productNames.includes(productOf(visit)))
        .map((visit) => ({ ...visit, productName: productOf(visit) })),
    ),
    todoRows: Array.isArray(overlay?.narratives?.todoItems) ? overlay.narratives.todoItems : [],
    todoNote: overlay?.narratives?.todoNote || '',
    todoCandidates,
    todoCandidateCounts: {
      trace: todoCandidates.filter((row) => row.sourceKind === 'trace').length,
      visit: todoCandidates.filter((row) => row.sourceKind === 'visit').length,
      action: todoCandidates.filter((row) => row.sourceKind === 'action').length,
      mergedVisit: todoCandidates.filter((row) => row.sourceKind === 'trace' && row.mergedVisit).length,
    },
    recommendedFeedbackCount: distinct(themes.flatMap((row) => row.priority === 'P0' || row.priority === 'P1' ? row.recordIds : [])).length,
    judgment: overlay?.narratives?.judgment || '',
    hiddenSectionIds: overlay?.hiddenSectionIds || [],
  }
  model.dataFingerprint = dataFingerprint(model)
  model.validation = validatePostUseReportV2(model)
  return model
}

/** Export-blocking checks; readers never see their internal diagnostics. */
export function validatePostUseReportV2(model, actionOverrides = {}) {
  const errors = []
  const productSample = model.products.reduce((sum, product) => sum + product.sample, 0)
  if (productSample !== model.kpis.totalSample) errors.push(`样本量不一致：概述 ${model.kpis.totalSample}、产品合计 ${productSample}`)
  if (model.products.length !== model.kpis.productCount) errors.push(`产品数不一致：概述 ${model.kpis.productCount}、产品列表 ${model.products.length}`)
  if (distinct(model.products.map((product) => product.name)).length !== model.products.length) errors.push('产品列表存在重复产品')
  for (const product of model.products) {
    if (model.actions.filter((row) => row.productName === product.name).length > 5) errors.push(`${product.name} 建议举措超过 5 条`)
  }
  if (model.focus.some((row) => !model.actions.some((action) => action.id === row.id))) errors.push('关注清单与分产品举措不一致')
  const positive = model.products.reduce((sum, product) => sum + product.positiveCount, 0)
  if (positive !== model.positiveCount) errors.push(`正反馈计数不一致：概述 ${model.positiveCount}、产品合计 ${positive}`)
  const registeredPositive = model.quoteRegistry.filter(isReportV2PraiseQuote).length
  if (registeredPositive !== model.positiveCount) errors.push(`正反馈计数不一致：概述 ${model.positiveCount}、附录登记 ${registeredPositive}`)
  for (const product of model.products) {
    const distribution = Object.values(product.distribution).reduce((sum, value) => sum + value, 0)
    if (distribution !== product.sample) errors.push(`${product.name} 评分分布与样本量不一致`)
    if (model.kind === 'quarter') {
      const monthly = product.monthly.reduce((sum, row) => sum + row.sample, 0)
      if (monthly !== product.sample) errors.push(`${product.name} 月度分解与季度累计不一致`)
      const weighted = product.monthly.reduce((sum, row) => sum + (row.value ?? 0) * row.sample, 0)
      if (product.sample && Math.abs(weighted / product.sample - product.avg) > 0.02) {
        errors.push(`${product.name} 月度均分与季度均分不一致`)
      }
    }
  }
  for (const focus of model.focus) {
    const actionText = String(actionOverrides[focus.id]?.text ?? focus.text ?? '').trim()
    if (!actionText) errors.push(`${focus.productName}「${focus.theme}」缺少举措`)
    if (!String(actionOverrides[focus.id]?.title ?? focus.title ?? '').trim()) errors.push(`${focus.productName}「${focus.theme}」缺少关注结论`)
    if (!String(actionOverrides[focus.id]?.detail ?? focus.detail ?? '').trim()) errors.push(`${focus.productName}「${focus.theme}」缺少补充事实`)
    const owner = String(actionOverrides[focus.id]?.owner ?? focus.owner ?? '').trim()
    if (!owner) errors.push(`${focus.productName}「${focus.theme}」缺少责任人`)
  }
  return errors
}
