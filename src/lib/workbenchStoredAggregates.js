import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { isCustomerExperienceComplaint } from '../domain/complaintCause.js'
import { resolvePreviousInsightPeriod } from '../domain/insightPeriod.js'
import {
  monthsForInsightPeriod,
  resolveJourneyComparisonWindow,
  buildTicketStoryModel,
  buildJourneyStages,
  collectOverviewJourneyRecordsForMonths,
} from './ticketStoryModel.js'
import { filterFeedbacks } from './productAnalytics.js'
import { listProducts, filterProductsByCatalog } from './productTaxonomy.js'
import { getCatalogProducts, getEnabledProducts, isManagedCatalogLoaded } from './productCatalogLoader.js'
import { resolveTrendMonthWindow, filterRecordsByImportMonths } from './workbenchTrendWindow.js'
import { buildWanTouByProducts } from './wanTouRatio.js'
import { buildProductExperienceTrend } from '../domain/workbenchProductTrends.js'
import { buildPostUseStoryModel } from './postUseRating/storyModel.js'
import { buildPostUseCatalogVersion } from './postUseRating/modelVersions.js'
import {
  getPostUseRatingProductNames,
  getPostUseFocusTrackedNames,
  scopePostUseRatingRecords,
} from './productCatalog/postUseRatingProducts.js'
import { computeExternalMixedMetrics } from './postUseRating/metrics.js'
import { postUseRecordsToScoredRows } from './postUseRating/scoredRows.js'

export const WORKBENCH_AGGREGATE_VERSION = 1

function productOf(record) {
  return String(record?.product || record?.productName || record?.productSpec || '未标注产品').trim()
}

function recordSourceType(record) {
  return record?.dataSourceType || 'complaint_ticket'
}

function minMonth(a, b) {
  if (!a) return b || ''
  if (!b) return a
  return a < b ? a : b
}

function maxMonth(a, b) {
  if (!a) return b || ''
  if (!b) return a
  return a > b ? a : b
}

/**
 * 快照重建需要覆盖的导入月份：当年趋势窗 ∪ 上月（1 月要带上一年 12 月）。
 * @param {import('../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 */
export function resolveWorkbenchHistoryMonthRange(period) {
  const trend = resolveTrendMonthWindow(period)
  const previous = resolvePreviousInsightPeriod(period)
  const previousMonths = monthsForInsightPeriod(previous)
  const startMonth = minMonth(trend.startMonth, previousMonths[0] || '')
  const endMonth = maxMonth(trend.endMonth, monthsForInsightPeriod(period).at(-1) || period?.endDate?.slice(0, 7) || '')
  return {
    startMonth,
    endMonth,
    trendMonths: trend.months,
    baselineYear: trend.baselineYear,
    previousMonths,
    currentMonths: monthsForInsightPeriod(period),
  }
}

function slimStage(stage) {
  if (!stage || typeof stage !== 'object') return stage
  const { recordIds, ticketIds, previousTicketIds, ...rest } = stage
  return {
    ...rest,
    children: Array.isArray(stage.children)
      ? stage.children.map((child) => {
          const { ticketIds: childTickets, ...childRest } = child || {}
          return childRest
        })
      : [],
  }
}

export function slimJourneyModel(model) {
  if (!model) return null
  return {
    stages: (model.stages || []).map(slimStage),
    layout: model.layout || 'empty',
    changeRows: (model.changeRows || []).map((row) => {
      const { ticketIds, ...rest } = row || {}
      return rest
    }),
    highlights: model.highlights || [],
    peakKeys: model.peakKeys || [],
    sourceFilter: model.sourceFilter || 'all',
  }
}

function scopeTicketRecords(records, sourceType) {
  const rows = (records || []).filter((record) => recordSourceType(record) === sourceType)
  if (sourceType === 'complaint_ticket') return rows.filter(isCustomerExperienceComplaint)
  return rows
}

function buildTicketSlice({
  sourceType,
  sourceLabel,
  period,
  periodRecords,
  historyRecords,
  trendMonths,
  baselineYear,
  selectedProduct,
  orderVolumes,
  wanTouTargets,
}) {
  const product = String(selectedProduct || '').trim()
  const records = product ? periodRecords.filter((record) => productOf(record) === product) : periodRecords
  const trendRecords = product
    ? historyRecords.filter((record) => productOf(record) === product)
    : historyRecords
  const model = buildTicketStoryModel({
    sourceType,
    sourceLabel,
    periodLabel: period?.label || '当前范围',
    period,
    records,
    trendRecords,
    comparisonRecords: trendRecords,
    trendMonths,
    snapshot: null,
    recommendations: [],
    actions: [],
    orderVolumes,
    wanTouTargets,
    baselineYear,
    selectedProduct: product,
    periodEndMonth: String(period?.endDate || '').slice(0, 7),
  })
  return {
    metrics: model.overview.metrics,
    productOverview: model.overview.productOverview,
    wanTou: model.overview.wanTou,
    volumeTrend: model.trendsAndChanges.volumeTrend,
    complaintVolumeWanTou: model.trendsAndChanges.complaintVolumeWanTou,
    journey: slimJourneyModel({
      stages: model.drivers.journeyStages,
      layout: model.drivers.journeyLayout,
      changeRows: model.trendsAndChanges.changes,
      highlights: model.drivers.journeyChangeHighlights,
      peakKeys: [],
      sourceFilter: model.drivers.journeySourceFilter,
    }),
    changes: slimJourneyModel({
      changeRows: model.trendsAndChanges.changes,
    }).changeRows,
  }
}

/**
 * 投诉/咨询工作台可落库聚合：全部 + 按产品。
 */
export function buildTicketWorkbenchAggregate({
  sourceType,
  period,
  records = [],
  historyRecords = [],
  orderVolumes = [],
  wanTouTargets = [],
}) {
  const sourceLabel = DATA_SOURCE_LABELS[sourceType] || sourceType
  const range = resolveWorkbenchHistoryMonthRange(period)
  const periodRecords = scopeTicketRecords(records, sourceType)
  const history = scopeTicketRecords(historyRecords.length ? historyRecords : records, sourceType)
  const productNames = [...new Set(periodRecords.map(productOf))].filter((name) => name && name !== '未标注产品')
  const all = buildTicketSlice({
    sourceType,
    sourceLabel,
    period,
    periodRecords,
    historyRecords: history,
    trendMonths: range.trendMonths,
    baselineYear: range.baselineYear,
    selectedProduct: '',
    orderVolumes,
    wanTouTargets,
  })
  /** @type {Record<string, ReturnType<typeof buildTicketSlice>>} */
  const byProduct = {}
  for (const productName of productNames) {
    byProduct[productName] = buildTicketSlice({
      sourceType,
      sourceLabel,
      period,
      periodRecords,
      historyRecords: history,
      trendMonths: range.trendMonths,
      baselineYear: range.baselineYear,
      selectedProduct: productName,
      orderVolumes,
      wanTouTargets,
    })
  }
  return {
    version: WORKBENCH_AGGREGATE_VERSION,
    sourceType,
    historyRange: { startMonth: range.startMonth, endMonth: range.endMonth },
    productNames,
    all,
    byProduct,
  }
}

export function pickTicketWorkbenchSlice(workbench, selectedProduct) {
  if (!workbench || workbench.version !== WORKBENCH_AGGREGATE_VERSION) return null
  const product = String(selectedProduct || '').trim()
  if (product) return workbench.byProduct?.[product] || null
  return workbench.all || null
}

export function applyTicketWorkbenchAggregate(model, workbench, selectedProduct) {
  const slice = pickTicketWorkbenchSlice(workbench, selectedProduct)
  if (!model || !slice) return model
  return {
    ...model,
    overview: {
      ...model.overview,
      metrics: slice.metrics || model.overview.metrics,
      productOverview: slice.productOverview || model.overview.productOverview,
      wanTou: slice.wanTou || model.overview.wanTou,
    },
    trendsAndChanges: {
      ...model.trendsAndChanges,
      volumeTrend: slice.volumeTrend || model.trendsAndChanges.volumeTrend,
      complaintVolumeWanTou: slice.complaintVolumeWanTou || model.trendsAndChanges.complaintVolumeWanTou,
      changes: slice.changes || slice.journey?.changeRows || model.trendsAndChanges.changes,
      highlights: slice.journey?.highlights || model.trendsAndChanges.highlights,
    },
    drivers: {
      ...model.drivers,
      journeyLayout: slice.journey?.layout || model.drivers.journeyLayout,
      journeyStages: slice.journey?.stages || model.drivers.journeyStages,
      journeyChangeHighlights: slice.journey?.highlights || model.drivers.journeyChangeHighlights,
    },
  }
}

function slimYunwang(external) {
  const yw = external?.yunwang || {}
  return {
    productCount: yw.productCount || 0,
    totalSample: yw.totalSample || 0,
    avgScore: yw.avgScore ?? null,
    belowNineCount: yw.belowNineCount || 0,
    belowNineRatio: yw.belowNineRatio || 0,
  }
}

function slimCompany(company) {
  return {
    productCount: company?.productCount || 0,
    totalSample: company?.totalSample || 0,
    avgScore: company?.avgScore ?? null,
  }
}

function slimProductOverview(rows) {
  return (rows || []).map((row) => ({
    productName: row.productName,
    avgScore: row.avgScore,
    sampleSize: row.sampleSize,
    state: row.state,
    stateCode: row.stateCode,
    explanation: row.explanation,
    satisfactionRate: row.satisfactionRate,
    satisfactionSample: row.satisfactionSample,
    satisfactionSmallSample: row.satisfactionSmallSample,
    satisfactionBelowBaseline: row.satisfactionBelowBaseline,
    primaryNeed: row.primaryNeed,
    nonTenCount: row.nonTenCount,
    visitEvidenceCount: row.visitEvidenceCount,
  }))
}

/**
 * 用后即评工作台可落库聚合。catalogVersion 与目录开关不一致时前端不得使用。
 */
export function buildPostUseWorkbenchAggregate({
  period,
  records = [],
  catalog = getCatalogProducts(),
}) {
  const scoped = scopePostUseRatingRecords(records, catalog)
  const productNames = getPostUseRatingProductNames(catalog)
  const scored = postUseRecordsToScoredRows(records)
  const company = computeExternalMixedMetrics(scoped.length ? postUseRecordsToScoredRows(scoped) : [], {
    productNames,
    companyRows: scored,
  }).company
  const model = buildPostUseStoryModel({
    records: scoped,
    allRecords: scoped,
    companyMetrics: slimCompany(company),
    productNames,
    focusNames: getPostUseFocusTrackedNames(catalog),
    period,
  })
  return {
    version: WORKBENCH_AGGREGATE_VERSION,
    catalogVersion: buildPostUseCatalogVersion(catalog),
    analysisScopedCount: scoped.length,
    yunwang: slimYunwang(model.metrics.external),
    company: slimCompany(company),
    internalExperience: {
      avgScore: model.metrics.internalExperience?.avgScore ?? null,
      totalSample: model.metrics.internalExperience?.totalSample || 0,
    },
    satisfaction: {
      rate: model.metrics.satisfaction?.rate ?? null,
      totalSample: model.metrics.satisfaction?.totalSample || 0,
    },
    productOverview: slimProductOverview(model.productOverview),
  }
}

export function postUseWorkbenchMatchesCatalog(workbench, catalog = getCatalogProducts()) {
  if (!workbench || workbench.version !== WORKBENCH_AGGREGATE_VERSION) return false
  return workbench.catalogVersion === buildPostUseCatalogVersion(catalog)
}

export function applyPostUseWorkbenchAggregate(model, workbench) {
  if (!model || !workbench || workbench.version !== WORKBENCH_AGGREGATE_VERSION) return model
  return {
    ...model,
    metrics: {
      ...model.metrics,
      internalExperience: {
        ...model.metrics.internalExperience,
        avgScore: workbench.internalExperience?.avgScore ?? model.metrics.internalExperience?.avgScore,
        totalSample: workbench.internalExperience?.totalSample ?? model.metrics.internalExperience?.totalSample,
      },
      satisfaction: {
        ...model.metrics.satisfaction,
        rate: workbench.satisfaction?.rate ?? model.metrics.satisfaction?.rate,
        totalSample: workbench.satisfaction?.totalSample ?? model.metrics.satisfaction?.totalSample,
      },
      external: {
        ...model.metrics.external,
        yunwang: {
          ...model.metrics.external?.yunwang,
          ...workbench.yunwang,
        },
        company: {
          ...model.metrics.external?.company,
          ...workbench.company,
        },
      },
    },
    productOverview: workbench.productOverview?.length ? workbench.productOverview : model.productOverview,
  }
}

function catalogProductOptions(records) {
  const enabled = getEnabledProducts()
  const catalogReady = isManagedCatalogLoaded()
  const listed = listProducts(records)
  return catalogReady ? filterProductsByCatalog(enabled, listed) : listed
}

/**
 * 综合概述：旅程（含上月摘要）+ 万投比 + 单产品体验趋势立方。
 */
export function buildOverviewWorkbenchAggregate({
  period,
  feedbacks = [],
  sourceSnapshots = {},
  orderVolumes = [],
  wanTouTargets = [],
}) {
  const comparison = resolveJourneyComparisonWindow(period)
  const currentRecords = collectOverviewJourneyRecordsForMonths(feedbacks, comparison.currentMonths)
  const previousRecords = collectOverviewJourneyRecordsForMonths(feedbacks, comparison.previousMonths)
  const products = catalogProductOptions(currentRecords)
  const productNames = products.map((item) => item.name).filter(Boolean)
  const sourceFilters = /** @type {const} */ (['all', 'complaint', 'consultation'])
  /** @type {Record<string, { all: ReturnType<typeof slimJourneyModel>, byProduct: Record<string, ReturnType<typeof slimJourneyModel>> }>} */
  const journey = {}
  for (const sourceFilter of sourceFilters) {
    const all = slimJourneyModel(buildJourneyStages({
      currentRecords,
      previousRecords,
      hasPreviousPeriod: comparison.previousMonths.length > 0 && comparison.currentMonths.length > 0,
      selectedProduct: '',
      sourceFilter,
      useMonthlyAverage: comparison.useMonthlyAverage,
      currentMonthCount: comparison.currentMonths.length,
    }))
    /** @type {Record<string, ReturnType<typeof slimJourneyModel>>} */
    const byProduct = {}
    for (const productName of productNames) {
      byProduct[productName] = slimJourneyModel(buildJourneyStages({
        currentRecords: filterFeedbacks(currentRecords, { product: productName }),
        previousRecords: filterFeedbacks(previousRecords, { product: productName }),
        hasPreviousPeriod: comparison.previousMonths.length > 0 && comparison.currentMonths.length > 0,
        selectedProduct: productName,
        sourceFilter,
        useMonthlyAverage: comparison.useMonthlyAverage,
        currentMonthCount: comparison.currentMonths.length,
      }))
    }
    journey[sourceFilter] = { all, byProduct }
  }

  const complaintRecords = scopeTicketRecords(
    filterRecordsByImportMonths(feedbacks, comparison.currentMonths),
    'complaint_ticket',
  )
  const wanTouRows = buildWanTouByProducts({
    period,
    records: complaintRecords,
    orderVolumes,
    wanTouTargets,
    productList: sourceSnapshots.complaint_ticket?.aggregates?.products,
  })

  const endMonth = String(period?.endDate || '').slice(0, 7)
  /** @type {Record<string, ReturnType<typeof buildProductExperienceTrend>>} */
  const productExperienceTrend = {}
  for (const productName of productNames) {
    productExperienceTrend[productName] = buildProductExperienceTrend(feedbacks, productName, {
      limit: 12,
      endMonth,
    })
  }

  return {
    version: WORKBENCH_AGGREGATE_VERSION,
    historyRange: resolveWorkbenchHistoryMonthRange(period),
    productNames,
    journey,
    wanTouRows,
    productExperienceTrend,
  }
}

export function pickOverviewJourney(workbench, sourceFilter, selectedProduct) {
  if (!workbench || workbench.version !== WORKBENCH_AGGREGATE_VERSION) return null
  const group = workbench.journey?.[sourceFilter] || workbench.journey?.all
  if (!group) return null
  const product = String(selectedProduct || '').trim()
  if (product) return group.byProduct?.[product] || null
  return group.all || null
}

export function hasWorkbenchAggregate(value) {
  return Boolean(value && value.version === WORKBENCH_AGGREGATE_VERSION)
}
