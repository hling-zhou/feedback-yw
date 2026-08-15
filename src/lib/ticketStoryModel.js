import { countByField, journeyTree } from './productAnalytics.js'
import { getTaxonomy } from './productTaxonomy.js'
import { isNegativeSentiment, getUrgencyLevel } from './sentiment.js'
import { getFollowUpScore } from '../domain/followUpSatisfaction.js'
import { getComplaintCauseL1Display, isCustomerExperienceComplaint } from '../domain/complaintCause.js'
import {
  listMonthsInclusive,
  normalizeInsightPeriod,
  normalizeYearMonth,
  resolvePreviousInsightPeriod,
  shiftYearMonth,
} from '../domain/insightPeriod.js'
import {
  computeMonthlyWanTou,
  countCustomerExperienceComplaintsInMonth,
  evaluateWanTouTarget,
  getOrderCountForMonth,
  resolveCatalogKeyFromProductName,
} from './wanTouRatio.js'
import { getWanTouTargetForYear } from '../storage/wanTouTargetStore.js'
import { ACTION_ITEM_STATUS_LABELS } from '../domain/actionItem.js'
import {
  buildRecommendationInsightIds,
  isFallbackReferenceRecommendation,
  isFormalPainClusterRecommendation,
  isHighRiskSingletonRecommendation,
  isOverviewFusedClusterRecommendation,
} from './planningRecommendations.js'
import { buildImpactFocusSummaryRule } from './ticketImpactFocus.js'

export const TICKET_STORY_SMALL_SAMPLE_N = 5
export const JOURNEY_EMPTY_HINT = '用户旅程按单产品生命周期查看，请选择一个产品。'
export const JOURNEY_SOURCE_FILTERS = /** @type {const} */ ({
  all: 'all',
  complaint: 'complaint',
  consultation: 'consultation',
})
const UNCLASSIFIED = new Set(['', '未分类', '未识别环节', '未识别子环节'])
const CHANGE_RANK = { 新增: 0, 增长: 1, 持续: 2, 缓解: 3, 消失: 4 }
const TICKET_COUNT_SUFFIX_RE = /（\d+ 条工单[^）]*）$/

const pct = (value, total) => total ? Math.round((value / total) * 1000) / 10 : 0
const productOf = (record) => String(record.product || record.productSpec || '未标注产品').trim()
const monthOf = (record) => String(record.importMonth || record.createdAt || '').slice(0, 7)
const painOf = (record) => String(record.painPoint || record.problemSummary || '').trim()

/**
 * 问题变化列标题：按洞察周期粒度。
 * @param {import('../domain/enums.js').PeriodGranularity | string | undefined} granularity
 */
export function periodComparisonColumnLabels(granularity) {
  if (granularity === 'month') return { previous: '上月', current: '本月' }
  if (granularity === 'quarter') return { previous: '上一季度', current: '本季度' }
  if (granularity === 'year') return { previous: '上一年', current: '本年' }
  return { previous: '上期', current: '本期' }
}

/**
 * @param {import('../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 * @returns {string[]}
 */
export function monthsForInsightPeriod(period) {
  if (!period) return []
  const normalized = normalizeInsightPeriod(period)
  const start = normalizeYearMonth(normalized.startDate?.slice(0, 7) || normalized.customFromMonth)
  const end = normalizeYearMonth(normalized.endDate?.slice(0, 7) || normalized.customToMonth)
  if (!start || !end) return []
  return listMonthsInclusive(start, end)
}

function uniqueTicketIds(records) {
  const seen = new Set()
  const ticketIds = []
  for (const record of records || []) {
    const ticketId = String(record?.ticketId || '').trim()
    if (!ticketId || seen.has(ticketId)) continue
    seen.add(ticketId)
    ticketIds.push(ticketId)
  }
  return ticketIds
}

function topValue(records, field, fallback = '—') {
  return countByField(records, field)[0]?.name || fallback
}

function journeyL1Of(record) {
  const value = String(record?.journeyL1 || '').trim()
  return !value || UNCLASSIFIED.has(value) ? '未识别环节' : value
}

function journeyL2Of(record) {
  const value = String(record?.journeyL2 || '').trim()
  return !value || UNCLASSIFIED.has(value) ? '未识别子环节' : value
}

function recordsInMonths(records, months) {
  const monthSet = new Set((months || []).filter(Boolean))
  if (!monthSet.size) return []
  return (records || []).filter((item) => monthSet.has(monthOf(item)))
}

/**
 * @param {number} previousCount
 * @param {number} currentCount
 * @param {boolean} hasPreviousPeriod
 * @returns {'新增' | '增长' | '持续' | '缓解' | '消失' | null}
 */
export function classifyJourneyChange(previousCount, currentCount, hasPreviousPeriod) {
  if (!hasPreviousPeriod) return null
  if (!previousCount && currentCount) return '新增'
  if (previousCount && !currentCount) return '消失'
  if (currentCount > previousCount) return '增长'
  if (currentCount < previousCount) return '缓解'
  if (!previousCount && !currentCount) return null
  return '持续'
}

/**
 * 簇级痛点展示：代表痛点，去掉洞察句里重复的工单数量后缀。
 * @param {{ summary?: string; text?: string; generationMeta?: { representativePain?: string } }} recommendation
 */
export function clusterPainLabel(recommendation) {
  const representative = String(recommendation?.generationMeta?.representativePain || '').trim()
  const summary = String(recommendation?.summary || recommendation?.text || '').trim()
  const raw = representative || summary
  return raw.replace(TICKET_COUNT_SUFFIX_RE, '').trim() || '未命名问题'
}

/**
 * 簇内客户请求代表值：按频次，并列时取更长文本。禁止用「第一条证据工单」顶替。
 * @param {import('./types.js').FeedbackRecord[]} records
 */
export function pickRepresentativeCustomerRequest(records) {
  const counts = new Map()
  for (const record of records || []) {
    const text = String(record?.customerRequest || '').trim()
    if (!text || text === '—') continue
    counts.set(text, (counts.get(text) || 0) + 1)
  }
  if (!counts.size) return '—'
  let best = ''
  let bestCount = 0
  for (const [text, count] of counts) {
    if (count > bestCount || (count === bestCount && text.length > best.length)) {
      best = text
      bestCount = count
    }
  }
  return best
}

function topCountedEntries(map, limit = 1) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'zh'))
    .slice(0, limit)
}

function recordSourceKind(record) {
  const type = record?.dataSourceType || 'complaint_ticket'
  if (type === 'consultation_ticket') return 'consultation'
  if (type === 'complaint_ticket') return 'complaint'
  return 'other'
}

/**
 * @param {string} [selectedProduct]
 */
export function isJourneyProductSelected(selectedProduct) {
  const name = String(selectedProduct || '').trim()
  return Boolean(name) && name !== '全部产品'
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {'all' | 'complaint' | 'consultation'} sourceFilter
 */
export function filterRecordsByJourneySource(records, sourceFilter = 'all') {
  const rows = records || []
  if (sourceFilter === 'complaint') {
    return rows.filter((record) => recordSourceKind(record) === 'complaint')
  }
  if (sourceFilter === 'consultation') {
    return rows.filter((record) => recordSourceKind(record) === 'consultation')
  }
  return rows.filter((record) => {
    const kind = recordSourceKind(record)
    return kind === 'complaint' || kind === 'consultation'
  })
}

function emptyStageStats() {
  return {
    count: 0,
    complaintCount: 0,
    consultationCount: 0,
    negativeCount: 0,
    recordIds: [],
    ticketIds: [],
    l2: new Map(),
    problemTypes: new Map(),
    pains: new Map(),
  }
}

function collectJourneyStageStats(records) {
  /** @type {Map<string, ReturnType<typeof emptyStageStats>>} */
  const map = new Map()
  for (const record of records || []) {
    const l1 = journeyL1Of(record)
    const entry = map.get(l1) || emptyStageStats()
    entry.count += 1
    if (recordSourceKind(record) === 'consultation') entry.consultationCount += 1
    else entry.complaintCount += 1
    if (isNegativeSentiment(record.sentiment)) entry.negativeCount += 1
    if (record.id) entry.recordIds.push(record.id)
    if (record.ticketId) entry.ticketIds.push(record.ticketId)
    const l2 = journeyL2Of(record)
    const child = entry.l2.get(l2) || { count: 0, ticketIds: [] }
    child.count += 1
    if (record.ticketId) child.ticketIds.push(record.ticketId)
    entry.l2.set(l2, child)
    const problemType = String(record.problemType || '未分类').trim() || '未分类'
    entry.problemTypes.set(problemType, (entry.problemTypes.get(problemType) || 0) + 1)
    const pain = painOf(record)
    if (pain) entry.pains.set(pain, (entry.pains.get(pain) || 0) + 1)
    map.set(l1, entry)
  }
  return map
}

function listLifecycleJourneyL1(productName) {
  if (!productName) return []
  return (getTaxonomy(productName)?.journeys || [])
    .map((item) => ({
      label: String(item.label || '').trim(),
      description: String(item.description || '').trim(),
    }))
    .filter((item) => item.label)
}

function displayCountForFilter(entry, sourceFilter) {
  if (!entry) return 0
  if (sourceFilter === 'complaint') return entry.complaintCount || 0
  if (sourceFilter === 'consultation') return entry.consultationCount || 0
  return entry.count || 0
}

/**
 * 按一级用户旅程建站点。未选产品时 layout=empty，不画跨产品图；changeRows 仍按 L1 汇总供结论使用。
 */
export function buildJourneyStages({
  currentRecords = [],
  previousRecords = [],
  hasPreviousPeriod = false,
  selectedProduct = '',
  sourceFilter = 'all',
} = {}) {
  const filteredCurrent = filterRecordsByJourneySource(currentRecords, sourceFilter)
  const filteredPrevious = hasPreviousPeriod
    ? filterRecordsByJourneySource(previousRecords, sourceFilter)
    : []
  const currentStats = collectJourneyStageStats(filteredCurrent)
  const previousStats = collectJourneyStageStats(filteredPrevious)
  const lifecycle = listLifecycleJourneyL1(selectedProduct)
  const descriptionByLabel = new Map(lifecycle.map((item) => [item.label, item.description]))
  const productSelected = isJourneyProductSelected(selectedProduct)
  const layout = productSelected ? 'lifecycle' : 'empty'
  const observed = new Set([...currentStats.keys(), ...previousStats.keys()])
  const ordered = []
  const seen = new Set()
  for (const item of lifecycle) {
    if (seen.has(item.label)) continue
    seen.add(item.label)
    ordered.push(item.label)
  }
  const extras = [...observed].filter((label) => !seen.has(label))
  extras.sort((a, b) => {
    if (a === '未识别环节') return 1
    if (b === '未识别环节') return -1
    return displayCountForFilter(currentStats.get(b), sourceFilter) - displayCountForFilter(currentStats.get(a), sourceFilter)
      || a.localeCompare(b, 'zh')
  })
  ordered.push(...extras)

  const total = filteredCurrent.length
  const stages = ordered.map((journeyL1) => {
    const now = currentStats.get(journeyL1)
    const before = previousStats.get(journeyL1)
    const currentCount = displayCountForFilter(now, sourceFilter)
    const previousCount = displayCountForFilter(before, sourceFilter)
    const change = classifyJourneyChange(previousCount, currentCount, hasPreviousPeriod)
    const l2Keys = new Set([...(now?.l2.keys() || []), ...(before?.l2.keys() || [])])
    const children = [...l2Keys].map((l2) => {
      const childNow = now?.l2.get(l2)
      const childBefore = before?.l2.get(l2)
      const childCurrent = childNow?.count || 0
      const childPrevious = childBefore?.count || 0
      return {
        l2,
        count: childCurrent,
        previousCount: childPrevious,
        change: classifyJourneyChange(childPrevious, childCurrent, hasPreviousPeriod),
        ticketIds: [...new Set(childNow?.ticketIds || [])],
      }
    }).sort((a, b) => b.count - a.count || a.l2.localeCompare(b.l2, 'zh'))
    const topL2 = children.find((child) => child.count > 0 && child.l2 !== '未识别子环节')?.l2 || ''
    const topPain = topCountedEntries(now?.pains || new Map(), 1)[0]?.[0] || ''
    const actionLabel = topL2 || topPain || ''
    const complaintCount = now?.complaintCount || 0
    const consultationCount = now?.consultationCount || 0
    const negativeCount = now?.negativeCount || 0
    return {
      key: journeyL1,
      journeyL1,
      count: currentCount,
      sharePct: pct(currentCount, total),
      previousCount,
      currentCount,
      delta: hasPreviousPeriod ? currentCount - previousCount : null,
      change,
      headline: actionLabel || '—',
      actionLabel,
      description: descriptionByLabel.get(journeyL1) || '',
      children,
      topProblemTypes: topCountedEntries(now?.problemTypes || new Map(), 2).map(([name, count]) => ({ name, count })),
      ticketIds: [...new Set(now?.ticketIds || [])],
      previousTicketIds: [...new Set(before?.ticketIds || [])],
      recordIds: now?.recordIds || [],
      complaintCount,
      consultationCount,
      negativeCount,
      negativePct: pct(negativeCount, currentCount),
      empty: currentCount === 0 && previousCount === 0,
      fromTaxonomy: descriptionByLabel.has(journeyL1),
      isFrictionPeak: false,
    }
  })

  let peakCount = 0
  for (const stage of stages) {
    if (stage.currentCount > peakCount) peakCount = stage.currentCount
  }
  const peakKeys = []
  for (const stage of stages) {
    stage.isFrictionPeak = peakCount > 0 && stage.currentCount === peakCount
    if (stage.isFrictionPeak) peakKeys.push(stage.key)
  }

  const changeRows = stages
    .filter((stage) => !stage.empty && stage.change)
    .sort((a, b) => (CHANGE_RANK[a.change] ?? 9) - (CHANGE_RANK[b.change] ?? 9) || b.currentCount - a.currentCount)
    .map((stage) => ({
      key: stage.key,
      journey: stage.journeyL1,
      journeyL1: stage.journeyL1,
      currentCount: stage.currentCount,
      previousCount: stage.previousCount,
      change: stage.change,
      ticketIds: [...new Set([...(stage.ticketIds || []), ...(stage.previousTicketIds || [])])],
    }))

  const highlights = changeRows
    .filter((row) => row.change !== '持续')
    .slice(0, 3)
    .map((row) => ({
      key: row.key,
      journeyL1: row.journeyL1,
      change: row.change,
      previousCount: row.previousCount,
      currentCount: row.currentCount,
      text: `${row.journeyL1} ${row.previousCount}→${row.currentCount}，${row.change}`,
    }))

  return {
    stages: productSelected ? stages : [],
    layout,
    changeRows,
    highlights: productSelected ? highlights : [],
    peakKeys: productSelected ? peakKeys : [],
    sourceFilter,
  }
}

/**
 * 综合概述总图语料：客户体验类投诉 + 咨询全量。
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 * @param {import('../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 */
export function collectOverviewJourneyRecords(feedbacks, period) {
  if (!period) return []
  const months = monthsForInsightPeriod(period)
  if (!months.length) return []
  const inPeriod = (feedbacks || []).filter((record) => months.includes(monthOf(record)))
  return inPeriod.filter((record) => {
    const kind = recordSourceKind(record)
    if (kind === 'consultation') return true
    if (kind === 'complaint') return isCustomerExperienceComplaint(record)
    return false
  })
}

function consultationOpportunity(record) {
  const text = `${record.requestScene || ''} ${record.problemType || ''} ${painOf(record)} ${record.customerRequest || ''}`
  if (/文档|说明|指引|教程|自助|帮助/.test(text)) return '文档自助'
  if (/流程|操作|配置|开通|申请|步骤/.test(text)) return '流程简化'
  if (/功能|能力|支持|缺少|无法/.test(text)) return '产品能力补足'
  return '信息透明'
}

function buildWanTou(records, trendRecords, months, productName, orderVolumes, wanTouTargets, baselineYear) {
  const productKey = resolveCatalogKeyFromProductName(productName)
  const trend = months.map((month) => {
    const complaints = productKey ? countCustomerExperienceComplaintsInMonth(trendRecords, month, productName) : 0
    const orders = productKey ? getOrderCountForMonth(orderVolumes, productKey, month) : null
    return { date: month, complaints, orders, ratio: computeMonthlyWanTou(complaints, orders) }
  })
  const latest = [...trend].reverse().find((row) => row.ratio != null) || null
  const target = productKey ? getWanTouTargetForYear(wanTouTargets, productKey, baselineYear)?.customerExperienceWanTouTarget : null
  return {
    productKey,
    trend,
    latest,
    evaluation: evaluateWanTouTarget({ ratio: latest?.ratio, target, orders: latest?.orders, complaints: latest?.complaints || 0 }),
  }
}

function recommendationRows(recommendations, records, actions, sourceType) {
  const recordById = new Map(records.map((record) => [record.id, record]))
  return (recommendations || []).map((recommendation) => {
    const evidenceIds = recommendation.evidenceRecordIds || []
    const evidence = evidenceIds.map((id) => recordById.get(id)).filter(Boolean)
    const insightIds = buildRecommendationInsightIds(recommendation, sourceType)
    const insightId = insightIds[0] || `ticket:${sourceType}:${recommendation.id}`
    const action = actions.find((item) => insightIds.some((id) => item.linkedInsightIds?.includes(id))
      || item.evidenceRecordIds?.some((id) => evidenceIds.includes(id)))
    const scores = recommendation.sections?.painClusterScores || {}
    return {
      id: recommendation.id,
      stableKey: recommendation.stableKey || '',
      insightId,
      insightIds,
      product: recommendation.scope?.product || productOf(evidence[0] || {}),
      pain: clusterPainLabel(recommendation),
      customerRequest: pickRepresentativeCustomerRequest(evidence),
      ticketCount: scores.ticketCount ?? recommendation.evidenceBundle?.ticketCount ?? evidence.length,
      sharePct: scores.sharePct ?? recommendation.evidenceBundle?.sharePct ?? 0,
      severity: scores.maxSeverity ?? '—',
      emotion: scores.p90Emotion ?? '—',
      priorityScore: scores.priorityScore ?? recommendation.generationMeta?.score ?? '—',
      priority: recommendation.priority || 'low',
      basis: recommendation.generationMeta?.selectedReason || '按痛点聚类的覆盖广度与业务危害度计算',
      breadthScore: scores.breadthScore ?? '—',
      signalType: recommendation.signalType || '',
      isFormalCluster: isFormalPainClusterRecommendation(recommendation),
      isFallbackReference: isFallbackReferenceRecommendation(recommendation),
      isHighRiskSingleton: isHighRiskSingletonRecommendation(recommendation),
      isOverviewFusedCluster: isOverviewFusedClusterRecommendation(recommendation),
      evidenceIds,
      evidenceTicketIds: uniqueTicketIds(evidence),
      evidence,
      action,
      actionStatus: action ? ACTION_ITEM_STATUS_LABELS[action.status] || action.status : '待创建',
    }
  })
}

function qualityModel(records, snapshot) {
  const anomalies = []
  for (const record of records) {
    const missing = []
    if (UNCLASSIFIED.has(String(record.requestScene || '').trim())) missing.push('请求场景')
    if (UNCLASSIFIED.has(String(record.problemType || '').trim())) missing.push('问题类型')
    if (UNCLASSIFIED.has(String(record.journeyL1 || '').trim())) missing.push('用户旅程')
    if (!painOf(record)) missing.push('需求痛点')
    if (missing.length) anomalies.push({ id: record.id, ticketId: record.ticketId, product: productOf(record), detail: `缺少${missing.join('、')}` })
  }
  return {
    status: snapshot?.status === 'stale' ? '快照已过期' : anomalies.length ? '存在需关注项' : '数据质量正常',
    warningCount: anomalies.length + (snapshot?.status === 'stale' ? 1 : 0),
    generatedAt: snapshot?.generatedAt || '',
    pipelineVersion: snapshot?.pipelineVersion || '—',
    tagLibraryVersion: snapshot?.tagLibraryVersion || '—',
    clusteringVersion: snapshot?.aggregates?.painPointClustering?.clusteringVersion || '—',
    counts: {
      missingRequestScene: records.filter((r) => UNCLASSIFIED.has(String(r.requestScene || '').trim())).length,
      missingProblemType: records.filter((r) => UNCLASSIFIED.has(String(r.problemType || '').trim())).length,
      missingJourney: records.filter((r) => UNCLASSIFIED.has(String(r.journeyL1 || '').trim())).length,
      missingPain: records.filter((r) => !painOf(r)).length,
    },
    anomalies,
  }
}

export function ticketQualityAnomaliesToCsv(quality) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [
    ['记录ID', '工单号', '产品', '异常'],
    ...(quality?.anomalies || []).map((row) => [row.id, row.ticketId, row.product, row.detail]),
  ].map((row) => row.map(escape).join(',')).join('\n')
}

/** Build the single presentation model for complaint and consultation workbench tabs. */
export function buildTicketStoryModel(input) {
  const {
    sourceType,
    sourceLabel,
    periodLabel,
    period = null,
    records = [],
    trendRecords = [],
    comparisonRecords = null,
    trendMonths = [],
    snapshot = null,
    recommendations = [],
    actions = [],
    orderVolumes = [],
    wanTouTargets = [],
    baselineYear = new Date().getFullYear(),
    selectedProduct = '',
    periodEndMonth = '',
    driversEmptyState = null,
  } = input
  const complaint = sourceType === 'complaint_ticket'
  const normalizedPeriod = period ? normalizeInsightPeriod(period) : null
  const granularity = normalizedPeriod?.granularity
  const comparisonLabels = periodComparisonColumnLabels(granularity)
  const currentPeriodMonths = monthsForInsightPeriod(normalizedPeriod)
  const previousPeriod = resolvePreviousInsightPeriod(normalizedPeriod)
  const previousPeriodMonths = monthsForInsightPeriod(previousPeriod)
  const changeSourceRecords = comparisonRecords || trendRecords
  const total = records.length
  const negativeRecords = records.filter((record) => isNegativeSentiment(record.sentiment))
  const urgentRecords = records.filter((record) => getUrgencyLevel(record) === 'high')
  const followUpRecords = records.filter((record) => getFollowUpScore(record) != null)
  const tenPoint = followUpRecords.filter((record) => getFollowUpScore(record) === 10).length
  const unresolvedRecords = followUpRecords.filter((record) => record.followUpSatisfaction?.problemResolved === 'unresolved')
  const scopedActions = selectedProduct ? actions.filter((action) => action.productName === selectedProduct) : actions
  const actionRows = recommendationRows(recommendations, records, scopedActions, sourceType)
  const hasPreviousPeriod = previousPeriodMonths.length > 0 && currentPeriodMonths.length > 0
  const previousPeriodRecords = hasPreviousPeriod ? recordsInMonths(changeSourceRecords, previousPeriodMonths) : []
  const journeyModel = buildJourneyStages({
    currentRecords: records,
    previousRecords: previousPeriodRecords,
    hasPreviousPeriod,
    selectedProduct,
    sourceFilter: sourceType === 'consultation_ticket' ? 'consultation' : 'complaint',
  })
  const endMonth = normalizeYearMonth(periodEndMonth) || currentPeriodMonths.at(-1) || trendMonths.at(-1) || ''
  const momPreviousMonth = endMonth ? shiftYearMonth(endMonth, -1) : ''
  const volumeTrend = trendMonths.map((month) => {
    const rows = trendRecords.filter((record) => monthOf(record) === month)
    const negative = rows.filter((record) => isNegativeSentiment(record.sentiment)).length
    return { date: month, count: rows.length, negative, negativePct: pct(negative, rows.length) }
  })
  const productGroups = new Map()
  for (const record of records) {
    const product = productOf(record)
    const group = productGroups.get(product) || []
    group.push(record)
    productGroups.set(product, group)
  }
  const repeatedRecords = new Set()
  const repeatGroups = new Map()
  for (const record of records) {
    const key = `${productOf(record)}\u0000${record.problemType || '未分类'}\u0000${record.journeyL1 || '未识别环节'}\u0000${painOf(record).slice(0, 40)}`
    const group = repeatGroups.get(key) || []
    group.push(record)
    repeatGroups.set(key, group)
  }
  for (const group of repeatGroups.values()) if (group.length > 1) group.forEach((record) => repeatedRecords.add(record.id))
  const selfServiceRecords = records.filter((record) => /操作指导|信息查询|文档|自助|帮助|说明/.test(`${record.requestScene || ''} ${record.problemType || ''} ${painOf(record)}`))
  const productOverview = [...productGroups.entries()].map(([product, rows]) => {
    const productRecommendations = actionRows.filter((row) => row.product === product)
    const currentCount = endMonth
      ? changeSourceRecords.filter((record) => productOf(record) === product && monthOf(record) === endMonth).length
      : 0
    const previousCount = momPreviousMonth
      ? changeSourceRecords.filter((record) => productOf(record) === product && monthOf(record) === momPreviousMonth).length
      : 0
    const rowFollowUps = rows.filter((record) => getFollowUpScore(record) != null)
    const productWanTou = complaint
      ? buildWanTou(rows, trendRecords.filter((record) => productOf(record) === product), trendMonths, product, orderVolumes, wanTouTargets, baselineYear)
      : null
    return {
      product,
      count: rows.length,
      sharePct: pct(rows.length, total),
      delta: momPreviousMonth ? currentCount - previousCount : null,
      negativeCount: rows.filter((record) => isNegativeSentiment(record.sentiment)).length,
      negativePct: pct(rows.filter((record) => isNegativeSentiment(record.sentiment)).length, rows.length),
      primaryProblem: productRecommendations[0]?.pain || topValue(rows, 'problemType'),
      primaryJourney: topValue(rows, 'journeyL1'),
      followUpEvidence: rowFollowUps.length,
      actionStatus: productRecommendations.find((row) => row.action)?.actionStatus || '待创建',
      wanTouRatio: productWanTou?.latest?.ratio ?? null,
      wanTouTargetMet: productWanTou?.evaluation?.met ?? null,
      smallSample: rows.length < TICKET_STORY_SMALL_SAMPLE_N,
    }
  }).sort((a, b) => b.count - a.count)
  const selectedWanTou = complaint && selectedProduct
    ? buildWanTou(records, trendRecords, trendMonths, selectedProduct, orderVolumes, wanTouTargets, baselineYear)
    : { productKey: null, trend: [], latest: null, evaluation: { hasTarget: false, met: null, target: null } }
  const drivers = {
    requestScenes: countByField(records, 'requestScene'),
    journeyTree: journeyTree(records),
    problemTypes: countByField(records, 'problemType'),
    journeyLayout: journeyModel.layout,
    journeyStages: journeyModel.stages,
    journeyChangeHighlights: journeyModel.highlights,
    journeySourceFilter: journeyModel.sourceFilter,
    complaintCauses: complaint ? [...records.reduce((map, record) => {
      const value = getComplaintCauseL1Display(record) || '未分类'
      map.set(value, (map.get(value) || 0) + 1)
      return map
    }, new Map()).entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) : [],
    clusters: actionRows.filter((row) => row.isFormalCluster || row.isHighRiskSingleton || row.isOverviewFusedCluster),
    fallbackReferences: actionRows.filter((row) => row.isFallbackReference),
    emptyState: driversEmptyState,
    opportunities: complaint ? [] : [...records.reduce((map, record) => {
      const category = consultationOpportunity(record)
      map.set(category, (map.get(category) || 0) + 1)
      return map
    }, new Map()).entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  }
  const quality = qualityModel(records, snapshot)
  const highValueRecords = records.filter((record) => /金牌|银牌/.test(String(record.customerTier || '')))
  const impactRecords = [...new Map([...unresolvedRecords, ...urgentRecords, ...negativeRecords, ...highValueRecords].map((record) => [record.id, record])).values()]
  const snapshotImpactFocus = selectedProduct
    ? snapshot?.aggregates?.impactFocusSummaries?.byProduct?.[selectedProduct]
    : snapshot?.aggregates?.impactFocusSummaries?.all
  const localImpactFocus = !snapshotImpactFocus
    ? buildImpactFocusSummaryRule({
        scopeLabel: selectedProduct ? `产品「${selectedProduct}」` : `${sourceLabel}整体`,
        recommendations,
        records,
      })
    : null
  const resolvedImpactFocus = snapshotImpactFocus || localImpactFocus || { summary: null, themeLinks: [], ungroupedEvidenceRecordIds: [] }
  const recordById = new Map(records.map((record) => [record.id, record]))
  const groupedThemeLinks = (resolvedImpactFocus.themeLinks || [])
    .map((link) => ({
      ...link,
      records: (link.evidenceRecordIds || []).map((id) => recordById.get(id)).filter(Boolean),
    }))
    .filter((link) => link.records.length > 0)
  const fallbackImpactRecords = (resolvedImpactFocus.ungroupedEvidenceRecordIds || [])
    .map((id) => recordById.get(id))
    .filter(Boolean)
  const growing = journeyModel.changeRows.find((row) => row.change === '新增' || row.change === '增长')
  const topCluster = actionRows.find((row) => row.isFormalCluster) || actionRows[0]
  const pendingActions = actionRows.filter((row) => !row.action).length
  const recoveryRows = scopedActions.filter((action) => action.status === 'completed').map((action) => {
    const currentProblem = actionRows.find((row) => row.action?.id === action.id)
    const completedMonth = String(action.updatedAt || '').slice(0, 7)
    const canCompare = Boolean(periodEndMonth && completedMonth && periodEndMonth > completedMonth)
    const inferred = canCompare && currentProblem
      ? { status: 'not_recovered', label: '未改善', explanation: `举措完成后当前范围仍识别到 ${currentProblem.ticketCount} 条同类问题` }
      : { status: 'pending', label: '待验证', explanation: '需要举措完成后的后续周期数据验证问题是否改善' }
    return { ...action, validation: action.recoveryValidation || inferred }
  }).sort((a, b) => (a.validation.status === 'not_recovered' ? -1 : 1))
  const notImproved = recoveryRows.filter((row) => row.validation.status === 'not_recovered').length
  const latestVolume = endMonth ? volumeTrend.find((row) => row.date === endMonth)?.count ?? changeSourceRecords.filter((record) => monthOf(record) === endMonth).length : 0
  const previousVolume = momPreviousMonth
    ? (volumeTrend.find((row) => row.date === momPreviousMonth)?.count
      ?? changeSourceRecords.filter((record) => monthOf(record) === momPreviousMonth).length)
    : null
  const volumeDelta = previousVolume == null ? null : latestVolume - previousVolume
  const overallState = !total ? '暂无有效工单' : negativeRecords.length / total >= 0.3 ? '负向反馈需重点关注' : volumeDelta > 0 ? '工单规模正在增长' : '整体状态相对稳定'
  return {
    scope: {
      sourceType,
      sourceLabel,
      periodLabel,
      selectedProduct: selectedProduct || '全部产品',
      total,
      productCount: productGroups.size,
      qualityStatus: quality.status,
      qualityWarningCount: quality.warningCount,
      pipelineVersion: quality.pipelineVersion,
      clusteringVersion: quality.clusteringVersion,
    },
    conclusions: [
      { key: 'overall', label: '整体状态', value: overallState, detail: `工单 ${total} 条，负向 ${negativeRecords.length} 条（${pct(negativeRecords.length, total)}%）`, target: '#ticket-status' },
      { key: 'risk', label: complaint ? '首要风险' : '首要机会', value: topCluster ? `${topCluster.product} · ${topCluster.pain}` : '暂无稳定痛点聚类', detail: topCluster?.basis || '样本不足时不做确定性判断', target: '#ticket-drivers' },
      { key: 'change', label: '最大变化', value: growing ? growing.journeyL1 : '暂无新增或增长问题', detail: growing ? `${growing.change}：${growing.previousCount} → ${growing.currentCount}` : `需要${comparisonLabels.previous}与${comparisonLabels.current}数据才能比较`, target: '#ticket-location' },
      { key: 'action', label: '行动状态', value: `${pendingActions} 项待创建`, detail: `${notImproved} 项已完成但未改善`, target: '#ticket-actions' },
    ],
    overview: {
      metrics: {
        total,
        negativeCount: negativeRecords.length,
        negativePct: pct(negativeRecords.length, total),
        urgentCount: urgentRecords.length,
        followUpCount: followUpRecords.length,
        followUpTenPointRate: pct(tenPoint, followUpRecords.length),
        unresolvedCount: unresolvedRecords.length,
        customerExperienceComplaintCount: complaint ? records.filter(isCustomerExperienceComplaint).length : 0,
        highFrequencyTopicCount: complaint ? 0 : [...repeatGroups.values()].filter((group) => group.length > 1).length,
        repeatConsultationPct: complaint ? 0 : pct(repeatedRecords.size, total),
        selfServicePct: complaint ? 0 : pct(selfServiceRecords.length, total),
      },
      productOverview,
      wanTou: selectedWanTou,
    },
    trendsAndChanges: {
      volumeTrend,
      changes: journeyModel.changeRows,
      highlights: journeyModel.highlights,
      currentMonth: currentPeriodMonths.at(-1) || '',
      previousMonth: previousPeriodMonths.at(-1) || '',
      previousPeriodLabel: comparisonLabels.previous,
      currentPeriodLabel: comparisonLabels.current,
    },
    drivers,
    impactAndEvidence: {
      highValueCount: highValueRecords.length,
      strongNegativeCount: negativeRecords.filter((record) => String(record.sentiment) === 'strong_negative').length,
      urgentCount: urgentRecords.length,
      unresolvedCount: unresolvedRecords.length,
      records: (fallbackImpactRecords.length ? fallbackImpactRecords : impactRecords).slice(0, 20),
      summary: resolvedImpactFocus.summary,
      themeLinks: groupedThemeLinks,
      summarySource: snapshotImpactFocus ? 'snapshot' : 'runtime_fallback',
    },
    actionsAndRecovery: {
      rows: actionRows,
      recoveryRows,
      pendingActions,
      notImproved,
    },
    quality,
  }
}
