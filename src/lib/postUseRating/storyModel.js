import {
  buildMonthlyScoreTable,
  computeExternalMixedMetrics,
  computeScoreDistribution,
  computeInternalExperienceMetrics,
  computeInternalSatisfactionMetrics,
} from './metrics.js'
import { buildPostUseInsightBundle } from './insights.js'
import { buildPostUseActionSignals } from './actionSignals.js'
import { evaluateActionRecovery } from './actionRecovery.js'
import {
  buildPostUseCallbackNonTenRecords,
  buildPostUseCallbackRecommendations,
} from './callbackRecommendations.js'
import {
  buildFocusSatisfactionTrendChartModel,
  buildFocusScoreTrendChartModel,
} from './trendStore.js'
import { filterPostUseTrendForPeriod } from './periodScope.js'

/** @param {object[]} records */
export function postUseRecordsToScoredRows(records) {
  return (records || [])
    .filter((record) => record.dataSourceType === 'post_use_rating' && record.ratingScore != null)
    .map((record) => ({
      id: record.id,
      channel: record.channel || (record.sourceSubType === 'sms_survey' ? 'sms' : record.sourceSubType === 'satisfaction_callback' ? 'callback' : 'console'),
      productName: record.productName || record.product || '',
      score: Number(record.ratingScore),
      customerName: record.customerName || '',
      customerCode: record.customerCode || '',
      answeredAt: record.createdAt || '',
      originalTicketId: record.originalTicketId || '',
      lowScoreReason: record.lowScoreReason || '',
    }))
    .filter((row) => Number.isFinite(row.score) && row.productName)
}

/**
 * Single presentation model for the online story and its monthly report projection.
 * @param {object} input
 */
export function buildPostUseStoryModel(input) {
  const {
    records = [],
    allRecords = [],
    visits = [],
    productNames = [],
    focusNames = [],
    actions = [],
    trend = null,
    quality = null,
    period = null,
    settings = null,
  } = input
  const scoredRows = postUseRecordsToScoredRows(records)
  const internalExperience = computeInternalExperienceMetrics(scoredRows, { productNames })
  const satisfaction = computeInternalSatisfactionMetrics(scoredRows, { productNames })
  const external = computeExternalMixedMetrics(scoredRows, { productNames })
  const monthlyScoreTable = buildMonthlyScoreTable(scoredRows, { productNames })
  const nonTenDistributionProducts = monthlyScoreTable
    .filter((row) => row.avgScore !== 10 || row.hasNonTenScore)
    .map((row) => row.productName)
  const scoreDistribution = computeScoreDistribution(scoredRows, nonTenDistributionProducts)
  const currentInsights = buildPostUseInsightBundle(records, {
    visits,
    keyCustomers: settings?.postUseKeyCustomers,
    productNames,
  })
  const unclassifiedNeedCount = currentInsights.unclassifiedNeeds.length
  const analysisQuality = {
    ...(quality || {}),
    snapshotAvailable: Boolean(quality),
    counts: {
      ...(quality?.counts || {}),
      unclassifiedNeed: unclassifiedNeedCount,
    },
    anomalies: [
      ...(quality?.anomalies || []),
      ...currentInsights.unclassifiedNeeds.map((item) => ({
        type: 'unclassified_need',
        productName: item.productName,
        channel: item.channel,
        detail: `证据 ${item.id || '—'}；评分 ${item.score}：${item.text}`,
      })),
    ],
  }
  const endMonth = String(period?.endDate || '').slice(0, 7)
  const comparisonRecords = endMonth
    ? allRecords.filter((record) => String(record.importMonth || record.createdAt || '').slice(0, 7) <= endMonth)
    : allRecords
  const changes = buildPostUseInsightBundle(comparisonRecords, { productNames }).issueChanges

  const satisfactionByProduct = new Map(satisfaction.byProduct.map((item) => [item.productName, item]))
  const needsByProduct = new Map()
  const needsByKey = new Map()
  for (const need of currentInsights.needs) {
    if (!needsByProduct.has(need.productName)) needsByProduct.set(need.productName, need)
    needsByKey.set(`${need.productName}\u0000${need.need}`, need)
  }
  const productOverview = currentInsights.products.map((product) => {
    const sat = satisfactionByProduct.get(product.productName)
    const need = needsByProduct.get(product.productName)
    return {
      ...product,
      satisfactionRate: sat?.rate ?? null,
      satisfactionSample: sat?.sampleSize || 0,
      satisfactionSmallSample: sat?.smallSample || false,
      satisfactionBelowBaseline: sat?.belowBaseline || false,
      primaryNeed: need?.need || '—',
      primaryNeedPriority: need?.priority || '',
    }
  })

  const callbackNonTen = scoredRows
    .filter((row) => row.channel === 'callback' && row.score !== 10)
    .map((row) => ({
      productName: row.productName,
      score: row.score,
      customerName: row.customerName,
      lowScoreReason: row.lowScoreReason,
      originalTicketId: row.originalTicketId,
    }))
  const signals = buildPostUseActionSignals({
    internalSat: satisfaction,
    internalExp: internalExperience,
    callbackNonTen: callbackNonTen.slice(0, 20),
    needInsights: currentInsights.needs,
    period: period?.id || '',
  })
  const triggerGroupsMap = new Map()
  for (const signal of signals.filter((item) => item.type !== 'aggregated_need')) {
    const key = signal.productName || '未标注产品'
    const group = triggerGroupsMap.get(key) || {
      productName: key,
      priority: 'P1',
      satisfactionSignal: null,
      experienceSignal: null,
      criticalLowScoreSignal: null,
      callbackNonTenCount: 0,
      callbackExamples: [],
    }
    if (signal.priority === 'P0') group.priority = 'P0'
    if (signal.type === 'satisfaction_below') group.satisfactionSignal = signal
    if (signal.type === 'experience_below') group.experienceSignal = signal
    if (signal.type === 'experience_critical_low_score') group.criticalLowScoreSignal = signal
    if (signal.type === 'callback_non_ten') {
      group.callbackNonTenCount += 1
      if (group.callbackExamples.length < 2) group.callbackExamples.push(signal.detail)
    }
    triggerGroupsMap.set(key, group)
  }
  const triggerGroups = [...triggerGroupsMap.values()].sort(
    (a, b) =>
      ({ P0: 0, P1: 1 }[a.priority] - ({ P0: 0, P1: 1 }[b.priority])) ||
      a.productName.localeCompare(b.productName, 'zh'),
  )
  const productSet = new Set(productNames)
  const scopedActions = actions.filter((action) => {
    if (!action?.linkedDataSources?.includes('post_use_rating')) return false
    return !productSet.size || productSet.has(action.productName)
  })
  const evidenceByProduct = new Map(productOverview.map((product) => [product.productName, [
    ...(product.evidenceIds || []),
    ...(product.visitEvidenceIds || []),
  ]]))
  const changeByKey = new Map(
    changes.map((item) => [`${item.productName}\u0000${item.issue}`, item]),
  )
  const actionRows = signals
    .filter((item) => item.type === 'aggregated_need')
    .map((rawSignal) => {
    const need = needsByKey.get(`${rawSignal.productName}\u0000${rawSignal.insightTheme || ''}`) || null
    const change = changeByKey.get(`${rawSignal.productName}\u0000${rawSignal.insightTheme || ''}`) || null
    const signal = {
      ...rawSignal,
      linkedInsightIds: rawSignal.linkedInsightIds?.length
        ? rawSignal.linkedInsightIds
        : [`post-use:${rawSignal.productName}:${rawSignal.type}`],
      evidenceRecordIds: rawSignal.evidenceRecordIds?.length
        ? rawSignal.evidenceRecordIds
        : evidenceByProduct.get(rawSignal.productName) || [],
      insightTheme: rawSignal.insightTheme || rawSignal.title,
    }
    const linked = scopedActions.find((action) =>
      signal.linkedInsightIds?.some((id) => action.linkedInsightIds?.includes(id)),
    )
    return {
      id: linked?.id || `${signal.type}:${signal.productName}:${signal.title}`,
      productName: signal.productName,
      theme: signal.insightTheme || signal.title,
      priority: signal.priority,
      title: signal.title,
      detail: signal.detail,
      feedbackCount: need?.count ?? null,
      customerCount: need?.customerCount ?? null,
      visitEvidenceCount: need?.visitEvidenceCount ?? null,
      avgScore: need?.avgScore ?? null,
      priorityScore: need?.priorityScore ?? null,
      change: change?.change || '',
      changeDetail: change ? `${change.previousCount} → ${change.currentCount}` : '',
      quotes: need?.quotes || [],
      status: linked?.status || 'recommended',
      action: linked || null,
      signal,
      evidenceCount: signal.evidenceRecordIds?.length || linked?.evidenceRecordIds?.length || 0,
    }
  })
  const representedActions = new Set(actionRows.map((row) => row.action?.id).filter(Boolean))
  for (const action of scopedActions) {
    if (representedActions.has(action.id)) continue
    actionRows.push({
      id: action.id,
      productName: action.productName,
      theme: action.insightTheme || action.painPointSnapshot || '未关联主题',
      priority: '—',
      title: action.content,
      detail: action.detail || action.painPointSnapshot || '',
      feedbackCount: null,
      customerCount: null,
      visitEvidenceCount: null,
      avgScore: null,
      priorityScore: null,
      change: '',
      changeDetail: '',
      quotes: [],
      status: action.status,
      action,
      signal: null,
      evidenceCount: action.evidenceRecordIds?.length || 0,
    })
  }

  const latestMetrics = new Map(internalExperience.byProduct.map((product) => [product.productName, {
    period: period?.label || period?.id || '',
    value: product.avgScore,
  }]))
  const recoveryRows = scopedActions
    .filter((action) => action.status === 'completed')
    .map((action) => ({
      ...action,
      validation: evaluateActionRecovery(action, latestMetrics.get(action.productName)),
    }))
    .sort((a, b) => ({ not_recovered: 0, pending: 1, recovered: 2, not_applicable: 3 }[a.validation.status] - ({ not_recovered: 0, pending: 1, recovered: 2, not_applicable: 3 }[b.validation.status])))

  const filteredTrend = trend ? filterPostUseTrendForPeriod(trend, period) : null
  const callbackRecommendations = buildPostUseCallbackRecommendations(records, settings?.postUseKeyCustomers, {
    productNames,
  })
  const callbackNonTenRecords = buildPostUseCallbackNonTenRecords(records, { productNames })
  const scoreTrend = filteredTrend
    ? buildFocusScoreTrendChartModel(filteredTrend, focusNames, 'internal_experience')
    : { data: [], areas: [] }
  const satisfactionTrend = filteredTrend
    ? buildFocusSatisfactionTrendChartModel(filteredTrend, focusNames)
    : { data: [], areas: [] }

  const critical = productOverview.find((product) => product.stateCode === 'critical')
    || productOverview.find((product) => product.stateCode === 'watch')
  const growing = changes.find((change) => change.change === '新增' || change.change === '增长')
  const unlinkedRecommendations = actionRows.filter((row) => row.status === 'recommended').length
  const notRecovered = recoveryRows.filter((row) => row.validation.status === 'not_recovered').length
  const overallState = internalExperience.totalSample === 0
    ? '暂无有效评分'
    : productOverview.some((product) => product.stateCode === 'critical')
      ? '存在重点改善产品'
      : productOverview.some((product) => product.stateCode === 'watch')
        ? '整体稳定，仍需观察'
        : '整体体验良好'
  const conclusions = [
    { key: 'overall', label: '整体状态', value: overallState, detail: `体验均分 ${internalExperience.avgScore || '—'}，有效样本 ${internalExperience.totalSample}`, target: '#post-use-status' },
    { key: 'risk', label: '首要风险', value: critical ? critical.productName : '暂无明确风险产品', detail: critical?.explanation || '当前没有达到重点改善或持续观察条件的产品', target: '#post-use-status' },
    { key: 'change', label: '主要变化', value: growing ? `${growing.productName} · ${growing.issue}` : '暂无新增或增长问题', detail: growing ? `${growing.change}：${growing.previousCount} → ${growing.currentCount}` : '至少需要两个有数据月份进行比较', target: '#post-use-trends' },
    { key: 'action', label: '行动状态', value: `${unlinkedRecommendations} 项待推动`, detail: `${notRecovered} 项已完成但未恢复`, target: '#post-use-actions' },
  ]

  const qualityWarnings = quality?.counts
    ? Number(quality.counts.outOfScope || 0) + Number(quality.counts.missingOriginalScene || 0) + Number(quality.counts.rejected || 0)
    : 0
  const totalQualityWarnings = qualityWarnings + unclassifiedNeedCount
  return {
    scope: {
      periodLabel: period?.label || '未选择',
      productCount: productOverview.length,
      validSample: scoredRows.length,
      isMonthPeriod: period?.granularity === 'month',
      postUseKeyCustomerCount: settings?.postUseKeyCustomers?.length || 0,
      qualityStatus: !quality ? (unclassifiedNeedCount ? '未生成快照，存在未识别需求' : '未生成质量快照') : totalQualityWarnings ? '存在需关注项' : '数据质量正常',
      qualityWarningCount: totalQualityWarnings,
      catalogVersion: quality?.versions?.catalog || '—',
      ruleVersion: quality?.versions?.analysisRule || currentInsights.ruleVersion,
    },
    conclusions,
    metrics: {
      internalExperience,
      satisfaction,
      external,
      monthlyScoreTable,
      scoreDistribution,
      nonTenDistributionProducts,
    },
    productOverview,
    trendsAndChanges: { scoreTrend, satisfactionTrend, changes },
    drivers: {
      sceneJourneys: currentInsights.sceneJourneys,
      needs: currentInsights.needs,
      unclassifiedNeeds: currentInsights.unclassifiedNeeds,
      customers: currentInsights.customers,
      highFrequencyLowScoreReasons: currentInsights.highFrequencyLowScoreReasons,
      visitEvidenceCount: currentInsights.visitEvidenceCount,
    },
    actionsAndRecovery: { triggerGroups, rows: actionRows, recoveryRows, unlinkedRecommendations, notRecovered },
    quality: analysisQuality,
    scoredRows,
    callbackRecommendations,
    callbackNonTenRecords,
    insightBundle: { ...currentInsights, issueChanges: changes },
  }
}
