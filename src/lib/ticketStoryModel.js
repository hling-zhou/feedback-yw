import { countByField, journeyTree } from './productAnalytics.js'
import { isNegativeSentiment, getUrgencyLevel } from './sentiment.js'
import { getFollowUpScore } from '../domain/followUpSatisfaction.js'
import { getComplaintCauseL1Display, isCustomerExperienceComplaint } from '../domain/complaintCause.js'
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
const UNCLASSIFIED = new Set(['', '未分类', '未识别环节', '未识别子环节'])

const pct = (value, total) => total ? Math.round((value / total) * 1000) / 10 : 0
const productOf = (record) => String(record.product || record.productSpec || '未标注产品').trim()
const monthOf = (record) => String(record.importMonth || record.createdAt || '').slice(0, 7)
const painOf = (record) => String(record.painPoint || record.problemSummary || '').trim()

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

function changeBuckets(records, months) {
  const dataMonths = months.filter((month) => records.some((record) => monthOf(record) === month))
  const currentMonth = dataMonths.at(-1) || ''
  const previousMonth = dataMonths.at(-2) || ''
  if (!currentMonth || !previousMonth) return { currentMonth, previousMonth, rows: [] }
  const bucket = (month) => {
    const groups = new Map()
    for (const record of records.filter((item) => monthOf(item) === month)) {
      const product = productOf(record)
      const problemType = String(record.problemType || '未分类').trim()
      const journey = String(record.journeyL1 || '未识别环节').trim()
      const key = `${product}\u0000${problemType}\u0000${journey}`
      const group = groups.get(key) || { key, product, problemType, journey, count: 0, recordIds: [], ticketIds: [] }
      group.count += 1
      if (record.id) group.recordIds.push(record.id)
      if (record.ticketId) group.ticketIds.push(record.ticketId)
      groups.set(key, group)
    }
    return groups
  }
  const current = bucket(currentMonth)
  const previous = bucket(previousMonth)
  return {
    currentMonth,
    previousMonth,
    rows: [...new Set([...current.keys(), ...previous.keys()])].map((key) => {
      const now = current.get(key)
      const before = previous.get(key)
      const currentCount = now?.count || 0
      const previousCount = before?.count || 0
      let change = '持续'
      if (!previousCount && currentCount) change = '新增'
      else if (previousCount && !currentCount) change = '消失'
      else if (currentCount > previousCount) change = '增长'
      else if (currentCount < previousCount) change = '缓解'
      return {
        ...(now || before),
        currentCount,
        previousCount,
        change,
        recordIds: [...(now?.recordIds || []), ...(before?.recordIds || [])],
        ticketIds: [...new Set([...(now?.ticketIds || []), ...(before?.ticketIds || [])])],
      }
    }).sort((a, b) => ({ 新增: 0, 增长: 1, 持续: 2, 缓解: 3, 消失: 4 }[a.change] - ({ 新增: 0, 增长: 1, 持续: 2, 缓解: 3, 消失: 4 }[b.change]) || b.currentCount - a.currentCount)),
  }
}

function consultationOpportunity(record) {
  const text = `${record.requestScene || ''} ${record.problemType || ''} ${painOf(record)} ${record.customerRequest || ''}`
  if (/文档|说明|指引|教程|自助|帮助/.test(text)) return '文档自助'
  if (/流程|操作|配置|开通|申请|步骤/.test(text)) return '流程简化'
  if (/功能|能力|支持|缺少|无法/.test(text)) return '产品能力补足'
  return '信息透明'
}

function buildLocationRows(records) {
  const groups = new Map()
  for (const record of records) {
    const scene = String(record.requestScene || '未分类').trim()
    const journeyL1 = String(record.journeyL1 || '未识别环节').trim()
    const journeyL2 = String(record.journeyL2 || '未识别子环节').trim()
    const problemType = String(record.problemType || '未分类').trim()
    const key = `${scene}\u0000${journeyL1}\u0000${journeyL2}\u0000${problemType}`
    const group = groups.get(key) || { key, scene, journeyL1, journeyL2, problemType, count: 0, recordIds: [], ticketIds: [] }
    group.count += 1
    if (record.id) group.recordIds.push(record.id)
    if (record.ticketId) group.ticketIds.push(record.ticketId)
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    ticketIds: [...new Set(group.ticketIds)],
  })).sort((a, b) => b.count - a.count)
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
      pain: recommendation.summary || recommendation.text || '未命名问题',
      customerRequest: evidence.find((item) => item.customerRequest)?.customerRequest || '—',
      rootCause: evidence.find((item) => item.rootCause || item.rootCauseReview)?.rootCauseReview || evidence.find((item) => item.rootCause)?.rootCause || '—',
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
    records = [],
    trendRecords = [],
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
  const total = records.length
  const negativeRecords = records.filter((record) => isNegativeSentiment(record.sentiment))
  const urgentRecords = records.filter((record) => getUrgencyLevel(record) === 'high')
  const followUpRecords = records.filter((record) => getFollowUpScore(record) != null)
  const tenPoint = followUpRecords.filter((record) => getFollowUpScore(record) === 10).length
  const unresolvedRecords = followUpRecords.filter((record) => record.followUpSatisfaction?.problemResolved === 'unresolved')
  const scopedActions = selectedProduct ? actions.filter((action) => action.productName === selectedProduct) : actions
  const actionRows = recommendationRows(recommendations, records, scopedActions, sourceType)
  const changes = changeBuckets(trendRecords, trendMonths)
  const latestTrendMonth = [...trendMonths].reverse().find((month) => trendRecords.some((record) => monthOf(record) === month)) || trendMonths.at(-1) || ''
  const previousTrendMonth = [...trendMonths].reverse().find((month) => month < latestTrendMonth && trendRecords.some((record) => monthOf(record) === month)) || ''
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
    const currentCount = rows.filter((record) => monthOf(record) === latestTrendMonth).length
    const previousCount = trendRecords.filter((record) => productOf(record) === product && monthOf(record) === previousTrendMonth).length
    const rowFollowUps = rows.filter((record) => getFollowUpScore(record) != null)
    const productWanTou = complaint
      ? buildWanTou(rows, trendRecords.filter((record) => productOf(record) === product), trendMonths, product, orderVolumes, wanTouTargets, baselineYear)
      : null
    return {
      product,
      count: rows.length,
      sharePct: pct(rows.length, total),
      delta: previousTrendMonth ? currentCount - previousCount : null,
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
    locationRows: buildLocationRows(records),
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
  const growing = changes.rows.find((row) => row.change === '新增' || row.change === '增长')
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
  const latestVolume = volumeTrend.find((row) => row.date === latestTrendMonth)?.count || 0
  const previousVolume = volumeTrend.find((row) => row.date === previousTrendMonth)?.count
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
      { key: 'change', label: '最大变化', value: growing ? `${growing.product} · ${growing.problemType}` : '暂无新增或增长问题', detail: growing ? `${growing.change}：${growing.previousCount} → ${growing.currentCount}` : '至少需要两个有数据月份进行比较', target: '#ticket-trends' },
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
    trendsAndChanges: { volumeTrend, changes: changes.rows, currentMonth: changes.currentMonth, previousMonth: changes.previousMonth },
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
