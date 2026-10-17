import { resolvePreviousInsightPeriod, shiftYearMonth } from '../../domain/insightPeriod.js'
import { postUsePeriodMonths } from './periodScope.js'
import {
  POST_USE_CRITICAL_LOW_SCORE,
  computeExternalMixedMetrics,
  computeInternalExperienceMetrics,
  computeInternalSatisfactionMetrics,
} from './metrics.js'
import { buildYunwangScoreContext } from './scoreContext.js'
import { buildMonthlyReportPreviewModel } from './monthlyReportPreview.js'
import { postUseRecordsToScoredRows } from './storyModel.js'
import { filterVisitsByMonth, filterVisitsByMonths } from './visitRecords.js'
import { buildFocusScoreTrendChartModel } from './trendStore.js'
import {
  buildCustomerQuoteRegistry,
  pickFeaturedVoiceQuotes,
  pickIssueEvidenceTexts,
  summarizeQuotePolarity,
} from './customerQuotes.js'

export { buildYunwangScoreContext }
export const MAX_REPORT_ISSUES = 8
export const REPORT_SECTION_JUDGMENT = 'judgment'
export const REPORT_SECTION_PRODUCTS = 'products'
export const REPORT_SECTION_ISSUES = 'issues'
export const REPORT_SECTION_TODO = 'todo'
export const REPORT_SECTION_PREVIOUS_VISITS = 'previousVisits'
export const REPORT_SECTION_APPENDIX = 'appendix'

const GROWING_CHANGES = new Set(['新增', '增长'])

function groupQuotesByProduct(records) {
  const map = new Map()
  for (const item of buildCustomerQuoteRegistry(records)) {
    const key = item.productName || ''
    const list = map.get(key) || []
    list.push(item)
    map.set(key, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const scoreDelta = (a.score ?? 99) - (b.score ?? 99)
      if (scoreDelta !== 0) return scoreDelta
      return String(b.answeredAt || '').localeCompare(String(a.answeredAt || ''))
    })
  }
  return map
}

function findRecommendedAction(actionRows, productName) {
  return (actionRows || []).find((row) => row.productName === productName && (row.status === 'recommended' || row.action))
}

function draftActionText(actionRow) {
  if (!actionRow) return '建议明确责任人：客服回访、部门内溯源，或立项产品举措。'
  if (actionRow.action?.content) {
    return `继续推进举措「${actionRow.action.content}」，写清责任人与本月完成标准。`
  }
  return `建议就「${actionRow.title}」推动处理：写清谁、对什么产品、回访 / 溯源 / 产品举措。`
}

function attachEvidence({ product, change, quotesByProduct, records }) {
  const productName = product?.productName || change?.productName || ''
  const picked = pickIssueEvidenceTexts(quotesByProduct.get(productName) || [])
  const productRecords = (records || []).filter((record) => String(record.productName || record.product || '').trim() === productName)
  return {
    avgScore: product?.avgScore ?? null,
    sampleSize: product?.sampleSize ?? 0,
    nonTenCount: product?.nonTenCount ?? 0,
    visitEvidenceCount: product?.visitEvidenceCount ?? 0,
    changeLabel: change ? `${change.change}：${change.previousCount} → ${change.currentCount}` : '',
    changeIssue: change?.issue || '',
    quotes: picked.quotes,
    options: picked.options,
    positiveQuotes: picked.positiveQuotes || [],
    evidenceRecordIds: [
      ...(product?.evidenceIds || []),
      ...productRecords.map((record) => record.id).filter(Boolean),
    ].slice(0, 20),
  }
}

/**
 * 首次打开用故事模型结论拼总判断草稿，并点名下文问题条。
 * @param {Array<{ label: string, value: string, detail?: string }>} conclusions
 * @param {Array<{ productName?: string }>} issues
 * @param {{ positiveCount?: number, negativeCount?: number }} [voice]
 */
export function draftJudgmentFromConclusions(conclusions, issues = [], voice = null, visitNote = '') {
  const lines = (conclusions || []).map((item) => {
    const detail = item.detail ? `（${item.detail}）` : ''
    return `${item.label}：${item.value}${detail}`
  })
  if (voice && (voice.positiveCount || voice.negativeCount)) {
    lines.push(`客户声音：正反馈 ${voice.positiveCount || 0} 条，负反馈 ${voice.negativeCount || 0} 条。`)
  }
  const named = [...new Set((issues || []).map((issue) => issue.productName).filter(Boolean))]
  if (named.length) {
    lines.push(`下文将分别说明：${named.join('、')}。`)
  } else {
    lines.push('下文暂无需要单列的问题条，完整明细见附录。')
  }
  if (visitNote) lines.push(visitNote)
  return lines.join('\n')
}

/**
 * 本月客服部回访拼成只读句子。空片段整段省略。
 * @param {{
 *   customerName?: string
 *   feedback?: string
 *   visitResult?: string
 *   internalConclusion?: string
 *   remark?: string
 * }} input
 */
export function composeVisitEvidenceSentence(input = {}) {
  const name = String(input.customerName || '').trim() || '未标注客户'
  const feedback = String(input.feedback || '').trim()
  const visitResult = String(input.visitResult || '').trim()
  const internalConclusion = String(input.internalConclusion || '').trim()
  const remark = String(input.remark || '').trim()
  const parts = []
  if (feedback) parts.push(`反馈「${feedback}」`)
  if (visitResult) parts.push(`经客服部回访，核实为「${visitResult}」`)
  if (internalConclusion && remark) parts.push(`经产品组评估，「${internalConclusion}」：「${remark}」`)
  else if (internalConclusion) parts.push(`经产品组评估，「${internalConclusion}」`)
  else if (remark) parts.push(`经产品组评估，「${remark}」`)
  if (!parts.length) return `${name}已回访，记录待补。`
  return `${name}：${parts.join('，')}。`
}

/**
 * 从月报评分分布表汇总条带，不另写指标。
 * @param {Array<Record<string, number | string>>} scoreDistributionTable
 */
export function aggregateScoreBands(scoreDistributionTable) {
  const bands = { ten: 0, nine: 0, eight: 0, low: 0 }
  for (const row of scoreDistributionTable || []) {
    bands.ten += Number(row['10'] || row[10] || 0)
    bands.nine += Number(row['9'] || row[9] || 0)
    bands.eight += Number(row['8'] || row[8] || 0)
    for (const score of [7, 6, 5, 4, 3, 2, 1]) {
      bands.low += Number(row[String(score)] || row[score] || 0)
    }
  }
  return bands
}

function recordImportMonth(record) {
  return String(record?.importMonth || record?.createdAt || '').slice(0, 7)
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

function metricPeriodComparison(current, previous, kind, prefix = '较上月') {
  const missing = { label: `暂无${String(prefix).replace(/^较/, '')}对比`, tone: 'na' }
  const currentNum = Number(current)
  const previousNum = Number(previous)
  if (!Number.isFinite(currentNum) || previous == null || !Number.isFinite(previousNum)) return missing
  const delta = kind === 'score' || kind === 'rate' ? round2(currentNum - previousNum) : currentNum - previousNum
  if (delta === 0) return { label: `${prefix}持平`, tone: 'flat' }
  const higher = delta > 0
  const abs = String(Math.abs(delta))
  if (kind === 'lowCount') {
    return { label: higher ? `${prefix}多 ${abs}` : `${prefix}少 ${abs}`, tone: higher ? 'down' : 'up' }
  }
  if (kind === 'count') {
    return { label: higher ? `${prefix}多 ${abs}` : `${prefix}少 ${abs}`, tone: 'flat' }
  }
  if (kind === 'rate') {
    return {
      label: higher ? `${prefix}高 ${abs} 个百分点` : `${prefix}低 ${abs} 个百分点`,
      tone: higher ? 'up' : 'down',
    }
  }
  return { label: higher ? `${prefix}高 ${abs}` : `${prefix}低 ${abs}`, tone: higher ? 'up' : 'down' }
}

function indexByProductName(rows) {
  return new Map((rows || []).map((row) => [row.productName, row]))
}

function scoredRowsInMonths(allRecords, months) {
  const monthSet = new Set(months || [])
  if (!monthSet.size) return []
  return postUseRecordsToScoredRows(
    (allRecords || []).filter((record) => monthSet.has(recordImportMonth(record))),
  )
}

function previousProductMetrics(allRecords, months, productNames) {
  const byProduct = new Map()
  const prevRows = scoredRowsInMonths(allRecords, months)
  if (!prevRows.length) return byProduct
  const opts = productNames?.length ? { productNames } : {}
  const mixed = indexByProductName(computeExternalMixedMetrics(prevRows, opts).yunwang.byProduct)
  const experience = indexByProductName(computeInternalExperienceMetrics(prevRows, opts).byProduct)
  const satisfaction = indexByProductName(computeInternalSatisfactionMetrics(prevRows, opts).byProduct)
  for (const name of new Set([...mixed.keys(), ...experience.keys(), ...satisfaction.keys()])) {
    const mixedRow = mixed.get(name)
    const exp = experience.get(name)
    const sat = satisfaction.get(name)
    byProduct.set(name, {
      experienceScore: exp?.sampleSize ? exp.avgScore : null,
      satisfactionRate: sat?.sampleSize ? sat.rate : null,
      mixedAvg: mixedRow?.sampleSize ? mixedRow.avgScore : null,
      mixedSample: mixedRow?.sampleSize || null,
      lowScoreCount: mixedRow?.sampleSize
        ? (mixedRow.scores || []).filter((score) => Number(score) <= POST_USE_CRITICAL_LOW_SCORE).length
        : null,
    })
  }
  return byProduct
}

function previousYunwangMetrics(allRecords, months, productNames) {
  const previousMonths = months || []
  if (!previousMonths.length) return { previousMonth: null, previousAvg: null, previousSample: 0 }
  const prevRows = scoredRowsInMonths(allRecords, previousMonths)
  if (!prevRows.length) return { previousMonth: previousMonths[0], previousAvg: null, previousSample: 0 }
  const yunwang = computeExternalMixedMetrics(prevRows, { productNames }).yunwang
  return {
    previousMonth: previousMonths[0],
    previousAvg: yunwang.totalSample ? yunwang.avgScore : null,
    previousSample: yunwang.totalSample || 0,
  }
}

/**
 * @param {{ reportMonth: string, overview?: object, issues?: Array<{ key: string }> }} input
 */
export function computeReportDataFingerprint(input) {
  const overview = input?.overview || {}
  const issueKeys = (input?.issues || []).map((issue) => issue.key).join(',')
  return [
    input?.reportMonth || '',
    overview.totalSample ?? '',
    overview.avgScore ?? '',
    overview.belowNineCount ?? '',
    overview.companyAvg ?? '',
    input?.previousYunwangAvg ?? '',
    input?.callbackUnqualifiedCount ?? '',
    input?.quoteCount ?? '',
    input?.positiveCount ?? '',
    input?.negativeCount ?? '',
    issueKeys,
  ].join('|')
}

/**
 * @param {{
 *   storyModel: ReturnType<import('./storyModel.js').buildPostUseStoryModel>
 *   records: object[]
 * }} input
 */
export function buildHtmlReportIssues({ storyModel, records }) {
  const products = storyModel?.productOverview || []
  const changes = storyModel?.trendsAndChanges?.changes || []
  const actionRows = storyModel?.actionsAndRecovery?.rows || []
  const quotesByProduct = groupQuotesByProduct(records)
  const productByName = new Map(products.map((product) => [product.productName, product]))
  const growingChanges = changes.filter((change) => GROWING_CHANGES.has(change.change))
  const issues = []
  const overflow = []
  const seenProducts = new Set()

  const pushIssue = (draft) => {
    const bucket = issues.length < MAX_REPORT_ISSUES ? issues : overflow
    bucket.push(draft)
  }

  const makeIssue = ({ key, productName, kind, severity, conclusionDraft, extraChange }) => {
    const product = productByName.get(productName) || null
    const change = extraChange
      || growingChanges.find((item) => item.productName === productName)
      || null
    const actionRow = findRecommendedAction(actionRows, productName)
    return {
      key,
      kind,
      severity,
      productName,
      conclusionDraft,
      actionDraft: draftActionText(actionRow),
      evidence: attachEvidence({ product, change, quotesByProduct, records }),
    }
  }

  for (const product of products.filter((item) => item.stateCode === 'critical')) {
    seenProducts.add(product.productName)
    pushIssue(makeIssue({
      key: `product:${product.productName}`,
      productName: product.productName,
      kind: 'product',
      severity: 0,
      conclusionDraft: `${product.productName} 处于重点改善：${product.explanation}。本月需要管到具体现象与责任人。`,
    }))
  }
  for (const product of products.filter((item) => item.stateCode === 'watch')) {
    seenProducts.add(product.productName)
    pushIssue(makeIssue({
      key: `product:${product.productName}`,
      productName: product.productName,
      kind: 'product',
      severity: 1,
      conclusionDraft: `${product.productName} 处于持续观察：${product.explanation}。本月先看是否继续恶化。`,
    }))
  }
  for (const change of growingChanges) {
    if (seenProducts.has(change.productName)) continue
    seenProducts.add(change.productName)
    pushIssue(makeIssue({
      key: `change:${change.productName}:${change.issue}`,
      productName: change.productName,
      kind: 'change',
      severity: 2,
      extraChange: change,
      conclusionDraft: `${change.productName} 的「${change.issue}」本月${change.change}（${change.previousCount} → ${change.currentCount}），需要确认是否形成新风险。`,
    }))
  }
  for (const row of actionRows.filter((item) => item.status === 'recommended')) {
    if (seenProducts.has(row.productName)) continue
    seenProducts.add(row.productName)
    pushIssue(makeIssue({
      key: `action:${row.productName}:${row.title}`,
      productName: row.productName,
      kind: 'action',
      severity: 3,
      conclusionDraft: `${row.productName} 仍有待推动事项：${row.title}。`,
    }))
  }

  return { issues, overflow }
}

/**
 * @param {object} overlay
 * @param {{ issues: object[], judgmentDraft: string }} model
 */
export function applyHtmlReportOverlay(model, overlay) {
  const narratives = overlay?.narratives || {}
  const issueNarratives = narratives.issues || {}
  const issues = (model.issues || []).map((issue) => ({
    ...issue,
    conclusion: overlay
      ? (issueNarratives[issue.key]?.conclusion ?? issue.conclusionDraft)
      : issue.conclusionDraft,
    action: overlay
      ? (issueNarratives[issue.key]?.action ?? issue.actionDraft)
      : issue.actionDraft,
  }))
  const fingerprint = model.dataFingerprint
  const savedFingerprint = overlay?.dataFingerprint || ''
  return {
    ...model,
    issues,
    judgment: overlay ? (narratives.judgment ?? model.judgmentDraft) : model.judgmentDraft,
    todoNote: overlay ? (narratives.todoNote ?? '') : '',
    previousVisits: (model.previousVisits || []).map((row) => {
      const saved = narratives.visitSupplements?.[row.id]
      if (!overlay) return row
      return {
        ...row,
        visitResult: saved?.visitResult ?? row.visitResult,
        internalConclusion: saved?.internalConclusion ?? row.internalConclusion,
        remark: saved?.remark ?? row.remark,
      }
    }),
    hiddenSectionIds: overlay?.hiddenSectionIds || [],
    printAppendix: Boolean(overlay?.printAppendix),
    overlayUpdatedAt: overlay?.updatedAt || '',
    overlayUpdatedBy: overlay?.updatedBy || '',
    tablesRefreshed: Boolean(overlay && savedFingerprint && savedFingerprint !== fingerprint),
  }
}

function visitCustomerName(visit) {
  return String(visit?.customerName || visit?.userInfoDetail || visit?.userInfo || '').trim() || '未标注客户'
}

function visitResultText(visit) {
  return String(visit?.visitResult || visit?.visitFeedbackDetail || visit?.feedbackSummary || '').trim()
}

function visitAssessmentText(visit) {
  return String(visit?.internalConclusion || visit?.internalEvaluationDetail || '').trim()
}

function customerMatches(leftName, leftCode, rightName, rightCode) {
  const code = String(leftCode || '').trim()
  const otherCode = String(rightCode || '').trim()
  if (code && otherCode && code === otherCode) return true
  const name = String(leftName || '').trim()
  const otherName = String(rightName || '').trim()
  return Boolean(name && otherName && name !== '匿名客户' && (name === otherName || otherName.includes(name) || name.includes(otherName)))
}

function feedbackForVisit(visit, storyModel, records) {
  const productName = String(visit?.productName || '').trim()
  const customerName = visitCustomerName(visit)
  const customerCode = String(visit?.customerCode || '').trim()
  const highFreq = (storyModel?.drivers?.highFrequencyLowScoreReasons || []).find((row) => (
    row.productName === productName
    && String(row.customerNameText || '').split('；').some((name) => customerMatches(customerName, customerCode, name, ''))
  ))
  if (highFreq?.lowScoreFeedback) return highFreq.lowScoreFeedback
  const negative = (records || []).find((record) => {
    const score = Number(record.ratingScore)
    if (!Number.isFinite(score) || score >= 10) return false
    if (String(record.productName || record.product || '').trim() !== productName) return false
    return customerMatches(customerName, customerCode, record.customerName, record.customerCode)
  })
  if (negative) {
    const reason = Array.isArray(negative.feedbackReasonTexts) ? negative.feedbackReasonTexts.find(Boolean) : ''
    const text = String(reason || negative.commentText || negative.rawText || '').trim()
    if (text) return text
  }
  const recommendation = (storyModel?.callbackRecommendations || []).find((item) => (
    item.productName === productName
    && customerMatches(customerName, customerCode, item.customerName, item.customerCode)
  ))
  return String(recommendation?.recommendedReason || '').trim()
}

/**
 * @param {object[]} visits
 * @param {string} reportMonth
 * @param {string} productName
 * @param {object} storyModel
 * @param {object[]} records
 */
export function buildProductVisitNarratives(visits, reportMonth, productName, storyModel, records, periodMonths) {
  const months = periodMonths?.length ? periodMonths : [reportMonth]
  const rows = filterVisitsByMonths(visits, months)
    .filter((visit) => String(visit?.productName || '').trim() === productName)
  if (!rows.length) return ['本期该产品暂无客服部回访记录']
  return rows.map((visit, index) => {
    const sentence = composeVisitEvidenceSentence({
      customerName: visitCustomerName(visit),
      feedback: feedbackForVisit(visit, storyModel, records),
      visitResult: visitResultText(visit),
      internalConclusion: visitAssessmentText(visit),
      remark: String(visit?.remark || '').trim(),
    })
    return rows.length > 1 ? `${index + 1}. ${sentence}` : sentence
  })
}

export function buildProductScoreTrendWithCompany(trendSnap, productName, companyRows, endMonth = '') {
  const product = buildFocusScoreTrendChartModel(trendSnap || { scores: [] }, [productName], 'internal_experience')
  const byDate = new Map()
  for (const row of product.data || []) {
    byDate.set(row.date, { date: row.date, product: row[productName] ?? null, company: null })
  }
  for (const row of companyRows || []) {
    const date = String(row?.date || '')
    if (!/^\d{4}-\d{2}$/.test(date)) continue
    const current = byDate.get(date) || { date, product: null, company: null }
    current.company = row.company ?? null
    byDate.set(date, current)
  }
  const end = String(endMonth || '')
  return {
    data: [...byDate.keys()].sort().filter((date) => !end || date <= end).map((date) => byDate.get(date)),
    areas: [
      { dataKey: 'product', name: productName, stroke: '#2563EB' },
      { dataKey: 'company', name: '公司均分（三渠道）', stroke: '#D97706' },
    ],
  }
}

function buildProductCards({
  storyModel,
  issues,
  visits,
  reportMonth,
  periodMonths,
  previousMonths,
  comparisonPrefix,
  records,
  allRecords,
  productNames,
  trend,
  companyRows,
  endMonth,
}) {
  const previousByProduct = previousProductMetrics(allRecords, previousMonths, productNames)
  const yunwang = storyModel?.metrics?.external?.yunwang?.byProduct || []
  const experience = new Map((storyModel?.metrics?.internalExperience?.byProduct || []).map((row) => [row.productName, row]))
  const satisfaction = new Map((storyModel?.metrics?.satisfaction?.byProduct || []).map((row) => [row.productName, row]))
  const unqualified = new Set((storyModel?.metrics?.satisfaction?.notQualified || []).map((row) => row.productName))
  const issueByProduct = new Map()
  for (const issue of issues || []) {
    if (issue?.productName && !issueByProduct.has(issue.productName)) issueByProduct.set(issue.productName, issue)
  }
  return yunwang
    .filter((row) => Number(row.sampleSize) > 0)
    .map((row) => {
      const exp = experience.get(row.productName)
      const sat = satisfaction.get(row.productName)
      const prev = previousByProduct.get(row.productName) || {}
      const belowNine = Number(row.avgScore) < 9
      const callbackUnqualified = unqualified.has(row.productName)
      const experienceScore = exp?.sampleSize ? exp.avgScore : null
      const satisfactionRate = sat?.sampleSize ? sat.rate : null
      const lowScoreCount = (row.scores || []).filter((score) => Number(score) <= POST_USE_CRITICAL_LOW_SCORE).length
      return {
        productName: row.productName,
        experienceScore,
        satisfactionRate,
        mixedAvg: row.avgScore,
        mixedSample: row.sampleSize,
        lowScoreCount,
        comparisons: {
          experienceScore: metricPeriodComparison(experienceScore, prev.experienceScore ?? null, 'score', comparisonPrefix),
          satisfactionRate: metricPeriodComparison(satisfactionRate, prev.satisfactionRate ?? null, 'rate', comparisonPrefix),
          mixedAvg: metricPeriodComparison(row.avgScore, prev.mixedAvg ?? null, 'score', comparisonPrefix),
          mixedSample: metricPeriodComparison(row.sampleSize, prev.mixedSample ?? null, 'count', comparisonPrefix),
          lowScoreCount: metricPeriodComparison(lowScoreCount, prev.lowScoreCount ?? null, 'lowCount', comparisonPrefix),
        },
        belowNine,
        callbackUnqualified,
        priority: belowNine || callbackUnqualified ? 0 : 1,
        issue: issueByProduct.get(row.productName) || null,
        visitNarratives: buildProductVisitNarratives(visits, reportMonth, row.productName, storyModel, records, periodMonths),
        scoreTrend: buildProductScoreTrendWithCompany(trend, row.productName, companyRows, endMonth),
      }
    })
    .sort((a, b) => a.priority - b.priority || Number(a.mixedAvg) - Number(b.mixedAvg) || a.productName.localeCompare(b.productName, 'zh'))
}

export function buildPreviousVisitRows(visits, reportMonth) {
  const previousMonth = shiftYearMonth(reportMonth, -1)
  if (!previousMonth) return []
  return filterVisitsByMonth(visits, previousMonth).map((visit) => ({
    id: String(visit.id || `${visitCustomerName(visit)}-${visit.productName || ''}-${visitResultText(visit)}`),
    customerName: visitCustomerName(visit),
    productName: String(visit.productName || ''),
    visitResult: visitResultText(visit),
    internalConclusion: visitAssessmentText(visit),
    remark: String(visit.remark || '').trim(),
  }))
}

function reportFrame(reportMonth, reportPeriod) {
  const quarter = reportPeriod?.granularity === 'quarter'
  const periodMonths = quarter ? postUsePeriodMonths(reportPeriod) : [reportMonth]
  const previousPeriod = quarter ? resolvePreviousInsightPeriod(reportPeriod) : null
  const previousMonths = quarter
    ? postUsePeriodMonths(previousPeriod)
    : [shiftYearMonth(reportMonth, -1)].filter(Boolean)
  return {
    quarter,
    periodMonths,
    previousMonths,
    endMonth: periodMonths[periodMonths.length - 1] || reportMonth,
    comparisonPrefix: quarter ? '较上季度' : '较上月',
    showPreviousVisits: !quarter,
    title: quarter ? `用后即评季报（${reportPeriod.label || reportMonth}）` : '',
    copy: quarter
      ? {
          overviewTitle: '本季概述',
          overviewPlaceholder: '结合综合结论写清当季整体表现，不要改指标数字。',
          todoProposed: '本季提出',
          todoClosed: '本季关闭',
          todoLead: '读者离开前应能回答：这季先办哪 3 件事。',
          todoEmpty: '本季建议回访清单为空，完整客户明细见附录。',
          todoPlaceholder: '补充本季要办备注：先办哪 3 件事。',
          filenamePrefix: '用后即评季报',
        }
      : {
          overviewTitle: '本月概述',
          overviewPlaceholder: '结合综合结论写清当月整体表现，不要改指标数字。',
          todoProposed: '本月提出',
          todoClosed: '本月关闭',
          todoLead: '读者离开前应能回答：这月先办哪 3 件事。',
          todoEmpty: '本月建议回访清单为空，完整客户明细见附录。',
          todoPlaceholder: '补充本月要办备注：先办哪 3 件事。',
          filenamePrefix: '用后即评月报',
        },
  }
}

function callbackTodoHighlights(recommendations) {
  return (recommendations || []).slice(0, 3).map((item) => ({
    customerName: item.customerName || item.customerCode || '未标注客户',
    productName: item.productName || '',
    reason: item.recommendedReason || item.quoteSummary || '',
  }))
}

/**
 * @param {{
 *   reportMonth: string
 *   reportPeriod?: object
 *   storyModel: object
 *   records: object[]
 *   allRecords?: object[]
 *   visits?: object[]
 *   actionItems?: object[]
 *   reasons?: object[]
 *   quality?: object
 *   learnings?: object[]
 *   overlay?: object | null
 *   statusTrends?: object | null
 *   trend?: object | null
 * }} input
 */
export function buildHtmlMonthlyReportModel(input) {
  const {
    reportMonth,
    reportPeriod = null,
    storyModel,
    records = [],
    allRecords = [],
    visits = [],
    actionItems = [],
    reasons = [],
    quality = null,
    learnings = [],
    overlay = null,
    statusTrends = null,
    trend = null,
  } = input
  const frame = reportFrame(reportMonth, reportPeriod)
  const productNames = input.productNames?.length
    ? input.productNames
    : storyModel?.productOverview?.map((item) => item.productName) || []
  const preview = buildMonthlyReportPreviewModel({
    reportMonth: frame.endMonth,
    periodMonths: frame.periodMonths,
    scoredRows: storyModel?.scoredRows || [],
    productNames,
    visits,
    actionItems,
    reasons,
    insightBundle: storyModel?.insightBundle,
    quality,
    storyModel,
    learnings,
  })
  const { issues, overflow } = buildHtmlReportIssues({ storyModel, records })
  const quoteRegistry = buildCustomerQuoteRegistry(records)
  const voice = summarizeQuotePolarity(quoteRegistry)
  const featuredVoice = pickFeaturedVoiceQuotes(quoteRegistry)
  const scoreBands = aggregateScoreBands(preview.scoreDistributionTable)
  const currentVisits = filterVisitsByMonths(visits, frame.periodMonths)
  const visitNote = currentVisits.length
    ? `本期客服部回访 ${currentVisits.length} 条，见各产品问题与证据。`
    : '本期暂无客服部回访结果。'
  const judgmentDraft = draftJudgmentFromConclusions(storyModel?.conclusions || [], issues, voice, visitNote)
  const companyRows = statusTrends?.combined?.data || storyModel?.metrics?.statusTrends?.combined?.data || []
  const scopedRecords = allRecords.length ? allRecords : records
  const productCards = buildProductCards({
    storyModel,
    issues: [...issues, ...overflow],
    visits,
    reportMonth: frame.endMonth,
    periodMonths: frame.periodMonths,
    previousMonths: frame.previousMonths,
    comparisonPrefix: frame.comparisonPrefix,
    records,
    allRecords: scopedRecords,
    productNames,
    trend,
    companyRows,
    endMonth: frame.endMonth,
  })
  const previousVisits = frame.showPreviousVisits ? buildPreviousVisitRows(visits, reportMonth) : []
  const belowNineNames = (storyModel?.metrics?.external?.yunwang?.byProduct || [])
    .filter((row) => Number(row.avgScore) < 9)
    .map((row) => row.productName)
  const callbackUnqualifiedNames = (preview.satisfaction?.notQualified || []).map((row) => row.productName)
  const previous = previousYunwangMetrics(scopedRecords, frame.previousMonths, productNames)
  const scoreContext = buildYunwangScoreContext({
    avgScore: preview.overview?.avgScore,
    companyAvg: preview.overview?.companyAvg,
    companySample: preview.overview?.companySample,
    previousAvg: previous.previousAvg,
    previousSample: previous.previousSample,
    momPrefix: frame.comparisonPrefix,
  })
  const kpis = {
    productCount: preview.overview?.productCount ?? storyModel?.metrics?.external?.yunwang?.productCount ?? 0,
    avgScore: preview.overview?.avgScore ?? null,
    totalSample: preview.overview?.totalSample ?? 0,
    belowNineCount: preview.overview?.belowNineCount ?? 0,
    belowNineNames,
    callbackUnqualifiedCount: preview.satisfaction?.notQualified?.length ?? 0,
    callbackUnqualifiedNames,
    ...scoreContext,
    previousMonth: previous.previousMonth,
  }
  const dataFingerprint = computeReportDataFingerprint({
    reportMonth,
    overview: preview.overview,
    issues,
    quoteCount: quoteRegistry.length,
    callbackUnqualifiedCount: kpis.callbackUnqualifiedCount,
    previousYunwangAvg: kpis.previousAvg,
    positiveCount: voice.positiveCount,
    negativeCount: voice.negativeCount,
  })
  const base = {
    reportMonth,
    showPreviousVisits: frame.showPreviousVisits,
    copy: frame.copy,
    title: frame.title || preview.title,
    kpis,
    voice,
    featuredVoice,
    scoreBands,
    charts: {
      productScores: (preview.monthlyScoreTable || []).map((row) => ({
        productName: row.productName,
        avgScore: row.avgScore,
        sampleSize: row.sampleSize,
      })),
      reasons: preview.reasons || [],
      scoreTrend: storyModel?.trendsAndChanges?.scoreTrend || { data: [], areas: [] },
      satisfactionTrend: storyModel?.trendsAndChanges?.satisfactionTrend || { data: [], areas: [] },
      statusTrend: statusTrends?.combined || storyModel?.metrics?.statusTrends?.combined || { data: [], areas: [] },
    },
    productCards,
    previousVisits,
    preview,
    issues,
    overflow,
    quoteRegistry,
    judgmentDraft,
    dataFingerprint,
    todo: {
      proposedCount: preview.actionsProposed?.length || 0,
      closedCount: preview.actionsClosed?.length || 0,
      notRecoveredCount: preview.completedButNotRecovered?.length || 0,
      proposed: (preview.actionsProposed || []).slice(0, 5),
      closed: (preview.actionsClosed || []).slice(0, 5),
      notRecovered: preview.completedButNotRecovered || [],
      callbackCount: storyModel?.callbackRecommendations?.length || 0,
      callbackHighlights: callbackTodoHighlights(storyModel?.callbackRecommendations),
    },
  }
  return applyHtmlReportOverlay(base, overlay)
}
