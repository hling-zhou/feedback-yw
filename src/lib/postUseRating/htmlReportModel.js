import { shiftYearMonth } from '../../domain/insightPeriod.js'
import { computeExternalMixedMetrics } from './metrics.js'
import { buildMonthlyReportPreviewModel } from './monthlyReportPreview.js'
import { postUseRecordsToScoredRows } from './storyModel.js'
import {
  buildCustomerQuoteRegistry,
  pickFeaturedVoiceQuotes,
  pickIssueEvidenceTexts,
  summarizeQuotePolarity,
} from './customerQuotes.js'

export const MAX_REPORT_ISSUES = 8
export const REPORT_SECTION_JUDGMENT = 'judgment'
export const REPORT_SECTION_ISSUES = 'issues'
export const REPORT_SECTION_TODO = 'todo'
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
export function draftJudgmentFromConclusions(conclusions, issues = [], voice = null) {
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
  return lines.join('\n')
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

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

function recordImportMonth(record) {
  return String(record?.importMonth || record?.createdAt || '').slice(0, 7)
}

function formatAbsDelta(delta) {
  return String(Math.abs(round2(delta)))
}

function toneFromDelta(delta) {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

/**
 * 云网均分相对公司均分、相对上月。均分与对比均用对外混算口径，不另写指标。
 * @param {{
 *   avgScore?: number | null
 *   companyAvg?: number | null
 *   companySample?: number
 *   previousAvg?: number | null
 *   previousSample?: number
 * }} input
 */
export function buildYunwangScoreContext(input = {}) {
  const current = Number(input.avgScore)
  const hasCurrent = Number.isFinite(current)

  let companyDelta = null
  let vsCompanyLabel = '暂无公司均分对比'
  let vsCompanyTone = 'na'
  const companyAvg = Number(input.companyAvg)
  if (hasCurrent && Number(input.companySample) > 0 && Number.isFinite(companyAvg)) {
    companyDelta = round2(current - companyAvg)
    vsCompanyTone = toneFromDelta(companyDelta)
    vsCompanyLabel = companyDelta === 0
      ? '与公司均分持平'
      : companyDelta > 0
        ? `高于公司均分 ${formatAbsDelta(companyDelta)}`
        : `低于公司均分 ${formatAbsDelta(companyDelta)}`
  }

  let momDelta = null
  let momLabel = '暂无上月对比'
  let momTone = 'na'
  const previousAvg = Number(input.previousAvg)
  if (hasCurrent && Number(input.previousSample) > 0 && Number.isFinite(previousAvg)) {
    momDelta = round2(current - previousAvg)
    momTone = toneFromDelta(momDelta)
    momLabel = momDelta === 0
      ? '较上月持平'
      : momDelta > 0
        ? `较上月高 ${formatAbsDelta(momDelta)}`
        : `较上月低 ${formatAbsDelta(momDelta)}`
  }

  return {
    companyAvg: Number(input.companySample) > 0 && Number.isFinite(companyAvg) ? companyAvg : null,
    companyDelta,
    vsCompanyLabel,
    vsCompanyTone,
    previousAvg: Number(input.previousSample) > 0 && Number.isFinite(previousAvg) ? previousAvg : null,
    previousSample: Number(input.previousSample) || 0,
    momDelta,
    momLabel,
    momTone,
  }
}

function previousYunwangMetrics(allRecords, reportMonth, productNames) {
  const previousMonth = shiftYearMonth(reportMonth, -1)
  if (!previousMonth) return { previousMonth: null, previousAvg: null, previousSample: 0 }
  const prevRows = postUseRecordsToScoredRows(
    (allRecords || []).filter((record) => recordImportMonth(record) === previousMonth),
  )
  if (!prevRows.length) return { previousMonth, previousAvg: null, previousSample: 0 }
  const yunwang = computeExternalMixedMetrics(prevRows, { productNames }).yunwang
  return {
    previousMonth,
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
    hiddenSectionIds: overlay?.hiddenSectionIds || [],
    printAppendix: Boolean(overlay?.printAppendix),
    overlayUpdatedAt: overlay?.updatedAt || '',
    overlayUpdatedBy: overlay?.updatedBy || '',
    tablesRefreshed: Boolean(overlay && savedFingerprint && savedFingerprint !== fingerprint),
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
 *   storyModel: object
 *   records: object[]
 *   allRecords?: object[]
 *   visits?: object[]
 *   actionItems?: object[]
 *   reasons?: object[]
 *   quality?: object
 *   learnings?: object[]
 *   overlay?: object | null
 * }} input
 */
export function buildHtmlMonthlyReportModel(input) {
  const {
    reportMonth,
    storyModel,
    records = [],
    allRecords = [],
    visits = [],
    actionItems = [],
    reasons = [],
    quality = null,
    learnings = [],
    overlay = null,
  } = input
  const productNames = input.productNames?.length
    ? input.productNames
    : storyModel?.productOverview?.map((item) => item.productName) || []
  const preview = buildMonthlyReportPreviewModel({
    reportMonth,
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
  const judgmentDraft = draftJudgmentFromConclusions(storyModel?.conclusions || [], issues, voice)
  const previous = previousYunwangMetrics(allRecords.length ? allRecords : records, reportMonth, productNames)
  const scoreContext = buildYunwangScoreContext({
    avgScore: preview.overview?.avgScore,
    companyAvg: preview.overview?.companyAvg,
    companySample: preview.overview?.companySample,
    previousAvg: previous.previousAvg,
    previousSample: previous.previousSample,
  })
  const kpis = {
    avgScore: preview.overview?.avgScore ?? null,
    totalSample: preview.overview?.totalSample ?? 0,
    belowNineCount: preview.overview?.belowNineCount ?? 0,
    callbackUnqualifiedCount: preview.satisfaction?.notQualified?.length ?? 0,
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
    title: preview.title,
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
    },
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
