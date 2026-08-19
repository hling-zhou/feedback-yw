import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Button, Card, Empty, Modal, Segmented, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd'
import { DownloadOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserTicketReviews } from '../context/UserTicketReviewContext.jsx'
import { matchesMyReviewFilter } from '../domain/userTicketReview.js'
import { formatBulkRetagScopeLabel } from '../lib/retagSession.js'
import {
  clearFeedbackTicketIdSet,
  formatClusterTicketSetChipLabel,
  readFeedbackTicketIdSet,
} from '../lib/feedbackTicketIdSet.js'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { useBulkRetagModal } from '../hooks/useBulkRetagModal.jsx'
import { TaggingProgressAlert } from '../components/TaggingProgressAlert.jsx'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { isImportMonthInPeriod, periodSpecFromImportMonth, resolveInsightPeriod } from '../domain/insightPeriod.js'
import { usePeriodScope } from '../hooks/usePeriodScope.js'
import { SCHEMA_VERSION, DEFAULT_TENANT_ID } from '../domain/constants.js'
import { recordSourceType } from '../snapshots/recordScope.js'
import { PageHeader } from './Dashboard.shared.jsx'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import FeedbackTable from '../components/FeedbackTable.jsx'
import FeedbackDrawer from '../components/FeedbackDrawer.jsx'
import { useFeedbackDrawerSelection } from '../hooks/useFeedbackDrawerSelection.js'
import FeedbackFilterBar from '../components/feedbacks/FeedbackFilterBar.jsx'
import FeedbackCompositeFilter from '../components/feedbacks/FeedbackCompositeFilter.jsx'
import SentimentBadge from '../components/SentimentBadge.jsx'
import { sentimentStats } from '../lib/analytics.js'
import { listResourcePools } from '../lib/productTaxonomy.js'
import { countByField } from '../lib/productAnalytics.js'
import {
  cascadeClearProductDependentFilters,
  libraryFilterOptionRecords,
  listFeedbackLibraryProducts,
  scopeFeedbacksByProduct,
} from '../lib/feedbackFilterScope.js'
import {
  countComplaintCauseL1,
  getComplaintCauseL1Display,
  isComplaintTicket,
} from '../domain/complaintCause.js'
import PermissionGate from '../components/auth/PermissionGate.jsx'
import { exportTicketAnalysisWithConfirm } from '../lib/ticketAnalysisExport.js'
import { isLegacyDemoTicketId } from '../lib/desensitize.js'
import {
  countRecordsNeedingTicketLlmEnrichment,
  countRecordsNeedingJourneyLlmEnrichment,
  recordHasFullTicketLlmEnrichment,
  recordNeedsTicketLlmEnrichment,
  recordNeedsJourneyLlmEnrichment,
  TICKET_LLM_FILTER_HINTS,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'
import {
  downloadUnknownJourneyCsv,
  summarizeUnknownJourneyRecords,
  UNKNOWN_JOURNEY_REASON_LABELS,
} from '../lib/journeyRetagSummary.js'
import ImportAnalysisPanel from '../components/ImportAnalysisPanel.jsx'
import ImportCustomerRestorePanel from '../components/ImportCustomerRestorePanel.jsx'
import { CUSTOMER_RESTORE_IMPORT_ENABLED } from '../lib/customerRestore/constants.js'
import ComplaintCauseReviewAdminModal from '../components/ComplaintCauseReviewAdminModal.jsx'
import { getEstablishedActionDisplay } from '../domain/establishedAction.js'
import {
  matchesCustomerNamesFilter,
  matchesFollowUpFilters,
  matchesHandlingKeywordFilter,
  matchesListeningReviewedFilter,
  matchesOptionalTextFilter,
  matchesTodoStatusFilter,
  parseFeedbackSearchParams,
  patchFeedbackSearchParams,
} from '../lib/feedbackFilters.js'
import {
  listPostUseChannelFilterOptions,
  listPostUseRatingFilterOptions,
  matchesCommentKeywordFilter,
  matchesPostUseChannelFilter,
  matchesPostUseRatingFilter,
} from '../lib/postUseRating/libraryFilters.js'
import { hasOpenTicketTodos } from '../domain/ticketTodo.js'
import {
  applyFeedbackFilterPatch,
  clearAllFeedbackFilters,
  createEmptyFeedbackFilters,
  FEEDBACK_CUSTOMER_VISIT_COMPOSITE_KEYS,
  FEEDBACK_POST_USE_COMPOSITE_KEYS,
  FEEDBACK_TICKET_COMPOSITE_KEYS,
  feedbackFiltersFromParsed,
  feedbackFiltersToUrlPatch,
  restrictFeedbackFiltersToKeys,
} from '../lib/feedbackFilterModel.js'
import { matchesTicketActualDateRange } from '../domain/ticketActualDate.js'
import { isTicketSource } from '../lib/importUtils.js'
import {
  WORKBENCH_HOME,
  buildWorkbenchAnalysisUrl,
} from '../lib/workbenchAnalysisLink.js'
import {
  FEEDBACK_LANE_POST_USE,
  FEEDBACK_LANE_TICKETS,
  FEEDBACK_LANE_CUSTOMER_VISITS,
  POST_USE_LANE_HINT,
  isPostUseRatingLibraryRecord,
  isPostUseNon10LibraryRecord,
  resolveFeedbackLane,
} from '../domain/postUseRatingImport.js'
import {
  needsPostUseJourney,
  enrichPostUseJourneyBatch,
} from '../lib/postUseRating/enrichPostUseJourney.js'
import { getCatalogProducts } from '../lib/productCatalogLoader.js'
import { loadVisitRecords } from '../lib/postUseRating/visitRecords.js'
import { buildPostUseCallbackRecommendations } from '../lib/postUseRating/callbackRecommendations.js'
import {
  buildPostUseCustomerVisitRows,
  downloadPostUseCustomerVisitExcel,
} from '../lib/postUseRating/customerVisitExport.js'

export default function Feedbacks() {
  const {
    feedbacks,
    retagSession,
    importSession,
    currentPeriodId,
    currentPeriod,
    periods,
    periodsLoading,
    selectInsightPeriod,
    settings,
    productCatalogMeta,
    syncSharedDataFromServer,
    updateFeedback,
    adapter,
  } = useInsights()
  const { user } = useAuth()
  const { enabled: reviewEnabled, doneRecordIds } = useUserTicketReviews()
  const { remoteBannerText } = useSharedBackgroundTaskBlock()
  const [journeyBusy, setJourneyBusy] = useState(false)
  const [view, setView] = useState('table')
  const [filters, setFilters] = useState(createEmptyFeedbackFilters)
  const [importAnalysisOpen, setImportAnalysisOpen] = useState(false)
  const [importCustomerRestoreOpen, setImportCustomerRestoreOpen] = useState(false)
  const [complaintCauseReviewOpen, setComplaintCauseReviewOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [customerVisitRecords, setCustomerVisitRecords] = useState([])
  const [customerVisitLoading, setCustomerVisitLoading] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const skipUrlSyncRef = useRef(false)

  const feedbackLane = useMemo(() => resolveFeedbackLane(searchParams), [searchParams])
  const isPostUseLane = feedbackLane === FEEDBACK_LANE_POST_USE
  const isCustomerVisitLane = feedbackLane === FEEDBACK_LANE_CUSTOMER_VISITS

  const switchFeedbackLane = useCallback(
    (lane) => {
      // 两大类 Tab 筛选相互独立：切换时清空，避免条件串到另一 Tab
      const cleared = clearAllFeedbackFilters()
      if (lane === FEEDBACK_LANE_POST_USE) {
        cleared.dataSource = 'post_use_rating'
      }
      setFilters(cleared)
      skipUrlSyncRef.current = true
      const existingSetKey = searchParams.get('ticketIdSet')?.trim() || ''
      if (existingSetKey) clearFeedbackTicketIdSet(existingSetKey)
      const next = patchFeedbackSearchParams(searchParams, {
        ...feedbackFiltersToUrlPatch(cleared),
        lane,
        source: lane === FEEDBACK_LANE_POST_USE ? 'post_use_rating' : '',
        ticketIdSet: '',
      })
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const activePeriod = useMemo(
    () =>
      resolveInsightPeriod(
        currentPeriodId,
        currentPeriod ?? periods.find((p) => p.id === currentPeriodId),
        SCHEMA_VERSION,
        DEFAULT_TENANT_ID,
      ),
    [currentPeriodId, currentPeriod, periods],
  )
  const {
    selected,
    selectFeedback,
    setSelectedDirect,
    requestCloseDrawer,
    closeDrawer,
    onDrawerDirtyChange,
  } = useFeedbackDrawerSelection()

  const syncFiltersToUrl = useCallback(
    (nextFilters) => {
      skipUrlSyncRef.current = true
      setSearchParams(patchFeedbackSearchParams(searchParams, feedbackFiltersToUrlPatch(nextFilters)), {
        replace: true,
      })
    },
    [searchParams, setSearchParams],
  )

  const handleFiltersChange = useCallback(
    (next, meta) => {
      setFilters(next)
      if (meta?.syncUrl) syncFiltersToUrl(next)
    },
    [syncFiltersToUrl],
  )

  const handleClearFilters = useCallback(() => {
    const next = clearAllFeedbackFilters()
    if (isPostUseLane) next.dataSource = 'post_use_rating'
    setFilters(next)
    const ticketIdSetKey = searchParams.get('ticketIdSet')?.trim() || ''
    if (ticketIdSetKey) clearFeedbackTicketIdSet(ticketIdSetKey)
    skipUrlSyncRef.current = true
    setSearchParams(patchFeedbackSearchParams(searchParams, {
      ...feedbackFiltersToUrlPatch(next),
      ticketIdSet: '',
    }), { replace: true })
  }, [isPostUseLane, searchParams, setSearchParams])

  const refreshCustomerVisitRecords = useCallback(async () => {
    setCustomerVisitLoading(true)
    try {
      const records = await loadVisitRecords(adapter)
      setCustomerVisitRecords(records)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载客服部回访失败')
    } finally {
      setCustomerVisitLoading(false)
    }
  }, [adapter])

  const handleRefresh = useCallback(async () => {
    if (importSession?.active) {
      message.warning('数据导入进行中，请稍后再刷新')
      return
    }
    if (retagSession?.active) {
      message.warning('批量重新打标进行中，请稍后再刷新')
      return
    }
    setRefreshing(true)
    try {
      await syncSharedDataFromServer({ notify: false })
      await refreshCustomerVisitRecords()
      message.success('已刷新')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '刷新失败')
    } finally {
      setRefreshing(false)
    }
  }, [importSession?.active, retagSession?.active, syncSharedDataFromServer, refreshCustomerVisitRecords])

  useEffect(() => {
    if (skipUrlSyncRef.current) {
      skipUrlSyncRef.current = false
      return
    }

    const month = searchParams.get('month')
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      void selectInsightPeriod(periodSpecFromImportMonth(month))
    }

    const parsed = parseFeedbackSearchParams(searchParams)
    const { ticketIdSet: _ignoredTicketIdSet, ...parsedFilters } = parsed
    const lane = resolveFeedbackLane(searchParams)
    let next = feedbackFiltersFromParsed({
      ...parsedFilters,
      ticketIds: parsed.ticketIds,
    })
    if (lane === FEEDBACK_LANE_POST_USE) {
      next = restrictFeedbackFiltersToKeys(next, FEEDBACK_POST_USE_COMPOSITE_KEYS, {
        dataSource: 'post_use_rating',
      })
    } else if (lane === FEEDBACK_LANE_CUSTOMER_VISITS) {
      next = restrictFeedbackFiltersToKeys(next, FEEDBACK_CUSTOMER_VISIT_COMPOSITE_KEYS)
    }
    setFilters(next)
  }, [searchParams])

  useEffect(() => {
    setSelectedDirect(null)
  }, [currentPeriodId])

  useEffect(() => {
    void refreshCustomerVisitRecords()
  }, [refreshCustomerVisitRecords])

  const { periodFeedbacks, periodCount, totalInDb } = usePeriodScope({
    period: activePeriod,
  })

  const customerVisitPeriodRecords = useMemo(() => {
    return (customerVisitRecords || []).filter((record) =>
      isImportMonthInPeriod(record.importMonth || record.visitMonth || '', activePeriod),
    )
  }, [customerVisitRecords, activePeriod])

  const catalogProducts = useMemo(
    () => getCatalogProducts(),
    // productCatalogMeta.loadedAt 变化时重新取目录
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feedbacks, productCatalogMeta?.loadedAt],
  )

  const callbackRecommendationPool = useMemo(
    () =>
      buildPostUseCallbackRecommendations(feedbacks, {
        keyCustomers: settings?.postUseKeyCustomers,
        productNames: catalogProducts
          .filter((product) => product?.analysisPostUseRating)
          .map((product) => String(product.name || '').trim())
          .filter(Boolean),
      }),
    [feedbacks, settings?.postUseKeyCustomers, catalogProducts],
  )

  const filteredCustomerVisitRecords = useMemo(() => {
    const needles = (filters.customerNames || []).map((name) => String(name || '').trim().toLowerCase()).filter(Boolean)
    if (!needles.length) return customerVisitPeriodRecords
    return customerVisitPeriodRecords.filter((record) => {
      const name = String(record.customerName || '').trim().toLowerCase()
      return needles.some((needle) => name.includes(needle))
    })
  }, [customerVisitPeriodRecords, filters.customerNames])

  const customerVisitTableRows = useMemo(
    () => buildPostUseCustomerVisitRows(filteredCustomerVisitRecords, callbackRecommendationPool),
    [filteredCustomerVisitRecords, callbackRecommendationPool],
  )

  /** 周期内按大类可见条数（用后即评不含 callback） */
  const laneVisiblePeriodCount = useMemo(() => {
    if (isCustomerVisitLane) return customerVisitPeriodRecords.length
    if (isPostUseLane) {
      return periodFeedbacks.filter(isPostUseRatingLibraryRecord).length
    }
    return periodFeedbacks.filter((fb) => {
      const t = recordSourceType(fb)
      return t === 'complaint_ticket' || t === 'consultation_ticket'
    }).length
  }, [periodFeedbacks, isPostUseLane, isCustomerVisitLane, customerVisitPeriodRecords.length])

  const postUseNon10NeedingJourney = useMemo(() => {
    if (!isPostUseLane) return []
    return periodFeedbacks.filter(
      (fb) => isPostUseNon10LibraryRecord(fb) && needsPostUseJourney(fb),
    )
  }, [periodFeedbacks, isPostUseLane])

  const runPostUseJourneyEnrichment = useCallback(async () => {
    const targets = postUseNon10NeedingJourney
    if (!targets.length) {
      message.info('当前没有待补全旅程的非 10 分评价')
      return
    }
    setJourneyBusy(true)
    try {
      const patches = enrichPostUseJourneyBatch(targets)
      let n = 0
      for (const { id, patch } of patches) {
        const rec = targets.find((r) => r.id === id)
        if (!rec) continue
        await updateFeedback(id, patch)
        n += 1
      }
      message.success(`已为 ${n} 条非 10 分评价补全用户旅程`)
    } catch (e) {
      message.error(e?.message || '旅程补全失败')
    } finally {
      setJourneyBusy(false)
    }
  }, [postUseNon10NeedingJourney, updateFeedback])

  const filterOptionRecords = useMemo(
    () => libraryFilterOptionRecords(periodFeedbacks, feedbackLane),
    [feedbackLane, periodFeedbacks],
  )

  const handleProductChange = useCallback(
    (product) => {
      const scoped = scopeFeedbacksByProduct(filterOptionRecords, product || '')
      const next = cascadeClearProductDependentFilters(
        applyFeedbackFilterPatch('product', { product: product || '' }, filters),
        scoped,
      )
      setFilters(next)
      syncFiltersToUrl(next)
    },
    [filters, filterOptionRecords, syncFiltersToUrl],
  )

  const scopedFeedbacks = useMemo(
    () => scopeFeedbacksByProduct(filterOptionRecords, filters.product || undefined),
    [filterOptionRecords, filters.product],
  )

  const products = useMemo(
    () => listFeedbackLibraryProducts(filterOptionRecords, catalogProducts, feedbackLane),
    [catalogProducts, feedbackLane, filterOptionRecords],
  )

  useEffect(() => {
    if (!filters.product) return
    if (products.some((item) => item.name === filters.product)) return
    handleProductChange('')
  }, [filters.product, handleProductChange, products])

  const pools = useMemo(
    () => listResourcePools(scopedFeedbacks, filters.product || undefined),
    [scopedFeedbacks, filters.product],
  )
  const problemTypes = useMemo(() => countByField(scopedFeedbacks, 'problemType'), [scopedFeedbacks])
  const complaintCauseOptions = useMemo(
    () => countComplaintCauseL1(scopedFeedbacks),
    [scopedFeedbacks],
  )
  const showComplaintCauseFilter = !filters.dataSource || filters.dataSource === 'complaint_ticket'
  const journeys = useMemo(() => countByField(scopedFeedbacks, 'journeyL1'), [scopedFeedbacks])
  const requestScenes = useMemo(() => countByField(scopedFeedbacks, 'requestScene'), [scopedFeedbacks])
  const ratingScoreOptions = useMemo(
    () => (isPostUseLane ? listPostUseRatingFilterOptions(scopedFeedbacks) : []),
    [isPostUseLane, scopedFeedbacks],
  )
  const channelOptions = useMemo(
    () => (isPostUseLane ? listPostUseChannelFilterOptions(scopedFeedbacks) : []),
    [isPostUseLane, scopedFeedbacks],
  )
  const unknownJourneySummary = useMemo(
    () => summarizeUnknownJourneyRecords(periodFeedbacks),
    [periodFeedbacks],
  )
  const missingTags = unknownJourneySummary.count
  const needsTicketLlmCount = useMemo(
    () => countRecordsNeedingTicketLlmEnrichment(periodFeedbacks),
    [periodFeedbacks],
  )
  const needsJourneyLlmCount = useMemo(
    () => countRecordsNeedingJourneyLlmEnrichment(periodFeedbacks, settings),
    [periodFeedbacks, settings],
  )

  const unknownReasonHint = useMemo(() => {
    if (!missingTags) return ''
    const parts = Object.entries(unknownJourneySummary.reasons)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => `${UNKNOWN_JOURNEY_REASON_LABELS[key]} ${count} 条`)
    return parts.join('；')
  }, [missingTags, unknownJourneySummary.reasons])

  const legacyDemoTickets = useMemo(
    () => feedbacks.filter((fb) => isLegacyDemoTicketId(fb.ticketId)).length,
    [feedbacks],
  )

  const ticketIdSetKey = searchParams.get('ticketIdSet')?.trim() || ''
  const ticketIdSet = useMemo(
    () => readFeedbackTicketIdSet(ticketIdSetKey),
    [ticketIdSetKey],
  )

  const selectedTicketIdSet = useMemo(() => {
    if (ticketIdSet?.ticketIds.length) return new Set(ticketIdSet.ticketIds)
    if (filters.ticketIds.length) return new Set(filters.ticketIds)
    return null
  }, [ticketIdSet, filters.ticketIds])

  const ticketIdOptions = useMemo(() => {
    /** @type {Map<string, string>} */
    const map = new Map()
    for (const tid of filters.ticketIds) {
      if (tid) map.set(tid, tid)
    }
    for (const fb of filterOptionRecords) {
      const tid = fb.ticketId?.trim()
      if (tid) map.set(tid, tid)
    }
    return [...map.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((tid) => ({ label: tid, value: tid }))
  }, [filterOptionRecords, filters.ticketIds])

  const customerNameOptions = useMemo(() => {
    /** @type {Map<string, string>} */
    const map = new Map()
    for (const name of filters.customerNames) {
      const trimmed = String(name || '').trim()
      if (trimmed) map.set(trimmed, trimmed)
    }
    for (const fb of filterOptionRecords) {
      const name = String(fb.customerName || '').trim()
      if (name) map.set(name, name)
    }
    return [...map.values()]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((name) => ({ label: name, value: name }))
  }, [filterOptionRecords, filters.customerNames])

  const visitCustomerNameOptions = useMemo(() => {
    /** @type {Map<string, string>} */
    const map = new Map()
    for (const name of filters.customerNames) {
      const trimmed = String(name || '').trim()
      if (trimmed) map.set(trimmed, trimmed)
    }
    for (const record of customerVisitPeriodRecords) {
      const name = String(record.customerName || '').trim()
      if (name) map.set(name, name)
    }
    return [...map.values()]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((name) => ({ label: name, value: name }))
  }, [customerVisitPeriodRecords, filters.customerNames])

  const matchedEvidenceCount = useMemo(() => {
    if (!selectedTicketIdSet?.size) return 0
    let n = 0
    for (const fb of feedbacks) {
      if (fb.ticketId && selectedTicketIdSet.has(fb.ticketId)) n += 1
    }
    return n
  }, [feedbacks, selectedTicketIdSet])

  const ticketDateFilter = useMemo(() => {
    if (!filters.ticketDateFrom && !filters.ticketDateTo) return null
    return { from: filters.ticketDateFrom, to: filters.ticketDateTo }
  }, [filters.ticketDateFrom, filters.ticketDateTo])

  const filtered = useMemo(() => {
    if (isCustomerVisitLane) return []
    const baseList = selectedTicketIdSet?.size ? feedbacks : periodFeedbacks
    return baseList.filter((fb) => {
      if (selectedTicketIdSet?.size) {
        if (!fb.ticketId || !selectedTicketIdSet.has(fb.ticketId)) return false
      }
      // 两大类分流
      if (isPostUseLane) {
        if (!isPostUseRatingLibraryRecord(fb)) return false
      } else {
        const t = recordSourceType(fb)
        if (t !== 'complaint_ticket' && t !== 'consultation_ticket') return false
        // 工单侧也不展示用后即评 callback 独立行
        if (isPostUseRatingLibraryRecord(fb) || fb.dataSourceType === 'post_use_rating') return false
      }
      if (filters.product && (fb.product || fb.productName || '未标注产品') !== filters.product) return false
      if (!matchesOptionalTextFilter(fb.problemType, filters.problemType)) return false
      if (filters.complaintCauseL1) {
        if (!isComplaintTicket(fb)) return false
        if (getComplaintCauseL1Display(fb) !== filters.complaintCauseL1) return false
      }
      if (filters.journeyL1 && fb.journeyL1 !== filters.journeyL1) return false
      if (filters.resourcePool && (fb.resourcePool || '未标注资源池') !== filters.resourcePool) return false
      if (filters.dataSource && recordSourceType(fb) !== filters.dataSource) return false
      if (ticketDateFilter && !matchesTicketActualDateRange(fb, ticketDateFilter)) return false
      if (!matchesOptionalTextFilter(fb.requestScene, filters.requestScene)) return false
      if (
        !matchesFollowUpFilters(fb, {
          followUp: filters.followUp,
          followUpResolved: filters.followUpResolved,
          reasonDim: filters.reasonDim,
        })
      ) {
        return false
      }
      if (filters.ticketLlm === 'needs_llm' && !recordNeedsTicketLlmEnrichment(fb)) return false
      if (filters.ticketLlm === 'needs_journey_llm' && !recordNeedsJourneyLlmEnrichment(fb, settings))
        return false
      if (filters.ticketLlm === 'full_llm' && !recordHasFullTicketLlmEnrichment(fb)) return false
      if (
        reviewEnabled &&
        filters.myReview &&
        !matchesMyReviewFilter(filters.myReview, fb.id, doneRecordIds)
      ) {
        return false
      }
      if (!matchesTodoStatusFilter(fb, filters.todoStatus, { userId: user?.id })) return false
      if (!matchesListeningReviewedFilter(fb, filters.listeningReviewed)) return false
      if (!matchesHandlingKeywordFilter(fb, filters.handlingKeyword)) return false
      if (!matchesCommentKeywordFilter(fb, filters.commentKeyword)) return false
      if (!matchesPostUseRatingFilter(fb, filters.ratingScore)) return false
      if (!matchesPostUseChannelFilter(fb, filters.channel)) return false
      if (!matchesCustomerNamesFilter(fb, filters.customerNames)) return false
      return true
    })
  }, [
    feedbacks,
    periodFeedbacks,
    selectedTicketIdSet,
    filters,
    ticketDateFilter,
    settings,
    reviewEnabled,
    doneRecordIds,
    user?.id,
    isPostUseLane,
    isCustomerVisitLane,
  ])

  const filteredSentiment = useMemo(() => sentimentStats(filtered), [filtered])
  const laneTotalInDb = isCustomerVisitLane ? customerVisitRecords.length : totalInDb

  const sentimentWorkbenchUrl = useMemo(() => {
    const source = filters.dataSource
    if (source && isTicketSource(source)) {
      return `${WORKBENCH_HOME}?tab=${encodeURIComponent(source)}`
    }
    return buildWorkbenchAnalysisUrl({
      source: source || undefined,
      product: filters.product || undefined,
      journeyL1: filters.journeyL1 || undefined,
      tab: 'sentiment',
    })
  }, [filters.dataSource, filters.product, filters.journeyL1])

  const sentimentWorkbenchLabel = useMemo(() => {
    if (filters.dataSource && isTicketSource(filters.dataSource)) {
      return `工作台 · ${DATA_SOURCE_LABELS[filters.dataSource]}`
    }
    return '洞察分析 · 用户情绪'
  }, [filters.dataSource])

  const handleExport = () => {
    if (isCustomerVisitLane) {
      downloadPostUseCustomerVisitExcel(
        filteredCustomerVisitRecords,
        callbackRecommendationPool,
        activePeriod?.label || '周期',
      )
      return
    }
    exportTicketAnalysisWithConfirm(filtered, {
      filePrefix: '反馈库',
      periodLabel: activePeriod?.label || '周期',
      totalInDb: periodCount,
      totalScopeLabel: '周期内',
    })
  }

  const handleExportUnknownJourney = () => {
    const ok = downloadUnknownJourneyCsv(periodFeedbacks, '未识别旅程样本.csv')
    if (!ok) {
      message.info('当前没有未识别用户旅程的记录')
    }
  }

  const { openBulkRetagModal, startScopedBulkRetag, bulkRetagBusy, bulkRetagDisabled, bulkRetagDisabledTip } =
    useBulkRetagModal({ filteredRecords: filtered })

  const applyTicketLlmFilter = (value) => {
    handleFiltersChange(applyFeedbackFilterPatch('ticketLlm', { ticketLlm: value }, filters), {
      key: 'ticketLlm',
    })
  }

  return (
    <div>
      <PageHeader
        title="反馈库"
        desc={
          <>
            库内 {laneTotalInDb} 条 · 本大类周期内 {laneVisiblePeriodCount} 条 · 当前筛选{' '}
            {isCustomerVisitLane ? customerVisitTableRows.length : filtered.length}{' '}
            条
            {activePeriod ? `（${activePeriod.label}）` : ''}
            {!isCustomerVisitLane && periodCount !== laneVisiblePeriodCount ? (
              <span className="text-ink-400"> · 周期全量 {periodCount}</span>
            ) : null}
            {filtered.length > 0 && !isPostUseLane && !isCustomerVisitLane ? (
              <>
                {' · '}
                负面类{' '}
                <span className="font-semibold tabular-nums text-red-600">
                  {filteredSentiment.negativeCount}（{filteredSentiment.negativePct}%）
                </span>
                {' · '}
                加急{' '}
                <span className="font-semibold tabular-nums text-rose-600">
                  {filteredSentiment.urgentCount}（{filteredSentiment.urgentPct}%）
                </span>
                {' · '}
                <Link
                  to={sentimentWorkbenchUrl}
                  className="font-medium text-brand-600 hover:text-brand-700"
                >
                  {sentimentWorkbenchLabel} →
                </Link>
              </>
            ) : null}
          </>
        }
      />

      <div className="page-toolbar flex flex-wrap items-center gap-3">
        <InsightPeriodPicker />
        <Segmented
          value={feedbackLane}
          onChange={(v) => switchFeedbackLane(String(v))}
          options={[
            { label: '投诉咨询工单', value: FEEDBACK_LANE_TICKETS },
            { label: '用后即评满意度', value: FEEDBACK_LANE_POST_USE },
            { label: '客服部回访', value: FEEDBACK_LANE_CUSTOMER_VISITS },
          ]}
        />
      </div>

      {isPostUseLane && (
        <Alert
          className="page-section-sm"
          type="info"
          showIcon
          title="用后即评满意度"
          description={
            <>
              {POST_USE_LANE_HINT}{' '}
              <Button type="link" className="!px-0" onClick={() => switchFeedbackLane(FEEDBACK_LANE_TICKETS)}>
                切换到投诉咨询工单
              </Button>
            </>
          }
        />
      )}

      {importSession.active && (
        <Alert
          className="page-section-sm"
          type="warning"
          showIcon
          title="数据导入进行中"
          description={
            <span>
              {importSession.progress || '正在处理…'}
              {importSession.dataMonth ? (
                <span className="text-ink-500"> · 数据月份 {importSession.dataMonth}</span>
              ) : null}
            </span>
          }
        />
      )}

      {remoteBannerText && !importSession.active && !retagSession.active && (
        <Alert
          className="page-section-sm"
          type="info"
          showIcon
          title="团队后台任务进行中"
          description={remoteBannerText}
        />
      )}

      {retagSession.active && (
        <TaggingProgressAlert
          progress={retagSession.progress}
          total={retagSession.total}
          scopeLabel={formatBulkRetagScopeLabel(retagSession.scope)}
        />
      )}

      {legacyDemoTickets > 0 && (
        <Alert
          className="page-section-sm"
          type="error"
          showIcon
          title={`检测到 ${legacyDemoTickets} 条旧版演示数据`}
          description="请重新导入真实工单，列映射选择「工单流水号」。"
        />
      )}

      {isPostUseLane && postUseNon10NeedingJourney.length > 0 && (
        <Alert
          className="page-section-sm"
          type="warning"
          showIcon
          title={`有 ${postUseNon10NeedingJourney.length} 条非 10 分评价待补全用户旅程`}
          description="仅补用户旅程字段，不走投诉/咨询统一批量打标。"
          action={
            <Button type="primary" size="small" loading={journeyBusy} onClick={() => void runPostUseJourneyEnrichment()}>
              补全用户旅程
            </Button>
          }
        />
      )}

      {!isCustomerVisitLane &&
        !isPostUseLane &&
        (needsTicketLlmCount > 0 ||
          needsJourneyLlmCount > 0 ||
          missingTags > 0 ||
          filters.ticketIds.length > 0 ||
          ticketIdSetKey) && (
        <div className="page-section page-stack">
          {(needsTicketLlmCount > 0 || needsJourneyLlmCount > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-sky-100 bg-sky-50/50 px-3 py-1.5 text-sm text-sky-900">
              {needsTicketLlmCount > 0 && (
                <span
                  className="inline-flex flex-wrap items-center gap-2"
                  title="客户请求或痛点仍为规则/人工/导入打标；多为导入时未配置 API Key 或额度不足"
                >
                  <span>{needsTicketLlmCount} 条客户请求/痛点待 LLM</span>
                  <PermissionGate permission="retag">
                    <Button
                      size="small"
                      type="link"
                      className="!px-0 !h-auto"
                      loading={bulkRetagBusy}
                      disabled={bulkRetagDisabled}
                      title={bulkRetagDisabledTip}
                      onClick={() => {
                        applyTicketLlmFilter('needs_llm')
                        startScopedBulkRetag('needs_ticket_llm')
                      }}
                    >
                      补打
                    </Button>
                  </PermissionGate>
                </span>
              )}
              {needsTicketLlmCount > 0 && needsJourneyLlmCount > 0 && (
                <span className="text-sky-300" aria-hidden>
                  |
                </span>
              )}
              {needsJourneyLlmCount > 0 && (
                <span
                  className="inline-flex flex-wrap items-center gap-2"
                  title={TICKET_LLM_FILTER_HINTS.needs_journey_llm}
                >
                  <span>{needsJourneyLlmCount} 条待 LLM（旅程）</span>
                  <PermissionGate permission="retag">
                    <Button
                      size="small"
                      type="link"
                      className="!px-0 !h-auto"
                      loading={bulkRetagBusy}
                      disabled={bulkRetagDisabled}
                      title={bulkRetagDisabledTip}
                      onClick={() => {
                        applyTicketLlmFilter('needs_journey_llm')
                        startScopedBulkRetag('needs_journey_llm')
                      }}
                    >
                      补打旅程
                    </Button>
                  </PermissionGate>
                </span>
              )}
            </div>
          )}

          {missingTags > 0 && (
            <Alert
              type="warning"
              showIcon
              title={`有 ${missingTags} 条工单的用户旅程仍为「未识别环节」`}
              description={
                <>
                  {unknownReasonHint ? `主要原因：${unknownReasonHint}。` : null}
                  可批量重新打标，或导出样本排查产品与旅程模板配置。
                </>
              }
              action={
                <Space wrap>
                  <Button size="small" onClick={handleExportUnknownJourney}>
                    导出未识别样本
                  </Button>
                  <PermissionGate permission="retag">
                    <Button
                      size="small"
                      type="primary"
                      loading={bulkRetagBusy}
                      disabled={bulkRetagDisabled}
                      title={bulkRetagDisabledTip}
                      onClick={openBulkRetagModal}
                    >
                      批量重新打标
                    </Button>
                  </PermissionGate>
                </Space>
              }
            />
          )}

          {ticketIdSetKey && !ticketIdSet ? (
            <Alert
              type="warning"
              showIcon
              title="依据工单集已失效，请从看板重新打开"
            />
          ) : null}

          {ticketIdSet ? (
            <Alert
              type="info"
              showIcon
              title={formatClusterTicketSetChipLabel(ticketIdSet.ticketIds.length, matchedEvidenceCount)}
              description={
                matchedEvidenceCount > 0
                  ? '含当前库内跨周期记录。'
                  : '当前主题依据工单号在库内暂无匹配记录。'
              }
            />
          ) : filters.ticketIds.length > 0 ? (
            <Alert
              type="info"
              showIcon
              title={formatClusterTicketSetChipLabel(filters.ticketIds.length, matchedEvidenceCount)}
              description={
                matchedEvidenceCount > 0
                  ? '含当前库内跨周期记录。'
                  : '当前筛选工单号在库内暂无匹配记录。'
              }
            />
          ) : null}
        </div>
      )}

      <div
        className={`page-sticky-chrome ${
          needsTicketLlmCount > 0 ||
          needsJourneyLlmCount > 0 ||
          missingTags > 0 ||
          filters.ticketIds.length > 0 ||
          ticketIdSetKey
            ? 'page-section-sm'
            : 'page-section'
        }`}
      >
        {isCustomerVisitLane ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <FeedbackCompositeFilter
                filters={filters}
                onFiltersChange={handleFiltersChange}
                onClearFilters={handleClearFilters}
                options={{
                  filterKeys: FEEDBACK_CUSTOMER_VISIT_COMPOSITE_KEYS,
                  customerNameOptions: visitCustomerNameOptions,
                  emptyPlaceholder: '选择属性筛选（客户名称）',
                }}
              />
            </div>
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
              <Button
                icon={<UploadOutlined />}
                disabled={!filteredCustomerVisitRecords.length}
                onClick={handleExport}
              >
                导出
              </Button>
              <Button
                icon={<ReloadOutlined />}
                loading={refreshing || customerVisitLoading}
                onClick={() => void handleRefresh()}
              >
                刷新
              </Button>
            </div>
          </div>
        ) : (
        <div className="space-y-2">
          {ticketIdSet ? (
            <Tag
              color="blue"
              closable
              onClose={(event) => {
                event.preventDefault()
                clearFeedbackTicketIdSet(ticketIdSetKey)
                skipUrlSyncRef.current = true
                setSearchParams(patchFeedbackSearchParams(searchParams, { ticketIdSet: '' }), { replace: true })
              }}
            >
              {formatClusterTicketSetChipLabel(ticketIdSet.ticketIds.length, matchedEvidenceCount)}
            </Tag>
          ) : null}
        <FeedbackFilterBar
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onProductChange={handleProductChange}
          onClearFilters={handleClearFilters}
          showComplaintCauseFilter={showComplaintCauseFilter}
          showMyReviewFilter={reviewEnabled}
          options={{
            ticketIdOptions,
            customerNameOptions,
            products,
            problemTypes,
            complaintCauseOptions,
            journeys,
            resourcePools: pools,
            requestScenes,
            filterKeys: isPostUseLane ? FEEDBACK_POST_USE_COMPOSITE_KEYS : FEEDBACK_TICKET_COMPOSITE_KEYS,
            emptyPlaceholder: isPostUseLane
              ? '选择属性筛选（评分、渠道、原文、客户…）'
              : '选择属性筛选（工单号、客户、内容、日期…）',
            ratingScoreOptions,
            channelOptions,
          }}
          actions={
            <>
              <Tooltip title="按工单号覆盖库内已有分析字段；列含义与必填项见下载模板表头（带 * 为必填）">
                <Button icon={<DownloadOutlined />} onClick={() => setImportAnalysisOpen(true)}>
                  导入分析结果
                </Button>
              </Tooltip>
              {CUSTOMER_RESTORE_IMPORT_ENABLED ? (
                <PermissionGate permission="import">
                  <Tooltip title="临时：按工单号回填已脱敏工单的客户名称/编码。1～7 月已复原。8 月及以后数据会自带这些字段，完成后可下架。">
                    <Button onClick={() => setImportCustomerRestoreOpen(true)}>
                      复原客户信息（临时）
                    </Button>
                  </Tooltip>
                </PermissionGate>
              ) : null}
              <Button icon={<UploadOutlined />} disabled={!filtered.length} onClick={handleExport}>
                导出分析结果
              </Button>
              {!isPostUseLane && user?.role === 'admin' ? (
                <Button onClick={() => setComplaintCauseReviewOpen(true)}>投诉原因复核</Button>
              ) : null}
              {!isPostUseLane && (
                <PermissionGate permission="retag">
                  <Button
                    disabled={bulkRetagDisabled}
                    loading={bulkRetagBusy}
                    title={bulkRetagDisabledTip}
                    onClick={openBulkRetagModal}
                  >
                    批量重新打标
                  </Button>
                </PermissionGate>
              )}
              {isPostUseLane && (
                <Button
                  loading={journeyBusy}
                  disabled={!postUseNon10NeedingJourney.length}
                  onClick={() => void runPostUseJourneyEnrichment()}
                >
                  补全非10分旅程
                  {postUseNon10NeedingJourney.length
                    ? `（${postUseNon10NeedingJourney.length}）`
                    : ''}
                </Button>
              )}
              <Segmented
                value={view}
                options={[
                  { label: '表格', value: 'table' },
                  { label: '卡片', value: 'cards' },
                ]}
                onChange={setView}
              />
              <Button
                className="ml-auto"
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={() => void handleRefresh()}
              >
                刷新
              </Button>
            </>
          }
        />
        </div>
        )}
      </div>

      <div className="page-section-sm">
        {periodsLoading || (isCustomerVisitLane && customerVisitLoading) ? (
          <div className="flex justify-center py-16">
            <Spin tip={isCustomerVisitLane ? '加载客服部回访…' : '加载数据周期…'} />
          </div>
        ) : isCustomerVisitLane ? (
          <CustomerVisitTable rows={customerVisitTableRows} />
        ) : view === 'table' ? (
          <FeedbackTable
            key={currentPeriodId || 'no-period'}
            items={filtered}
            onSelect={selectFeedback}
            reviewEnabled={reviewEnabled}
            doneRecordIds={doneRecordIds}
            dataSource={isPostUseLane ? 'post_use_rating' : filters.dataSource || ''}
          />
        ) : (
          <CardGrid
            key={currentPeriodId || 'no-period'}
            items={filtered}
            onSelect={selectFeedback}
            postUseMode={isPostUseLane}
          />
        )}
      </div>

      {!isCustomerVisitLane ? (
        <FeedbackDrawer
          feedback={selected}
          onClose={requestCloseDrawer}
          onSavedClose={closeDrawer}
          onDirtyChange={onDrawerDirtyChange}
        />
      ) : null}

      {!isCustomerVisitLane ? (
        <Modal
          title="导入分析结果"
          open={importAnalysisOpen}
          onCancel={() => setImportAnalysisOpen(false)}
          footer={null}
          width={720}
          destroyOnClose
        >
          <ImportAnalysisPanel inModal onImportComplete={() => setImportAnalysisOpen(false)} />
        </Modal>
      ) : null}

      {!isCustomerVisitLane && CUSTOMER_RESTORE_IMPORT_ENABLED ? (
        <Modal
          title="按工单号复原客户信息（临时）"
          open={importCustomerRestoreOpen}
          onCancel={() => setImportCustomerRestoreOpen(false)}
          footer={null}
          width={720}
          destroyOnClose
        >
          <ImportCustomerRestorePanel onImportComplete={() => setImportCustomerRestoreOpen(false)} />
        </Modal>
      ) : null}

      {!isCustomerVisitLane ? (
        <ComplaintCauseReviewAdminModal
          open={complaintCauseReviewOpen}
          onClose={() => setComplaintCauseReviewOpen(false)}
        />
      ) : null}
    </div>
  )
}

function CustomerVisitTable({ rows }) {
  const columns = useMemo(() => {
    const maxQuotes = Math.max(
      0,
      ...rows.map((row) =>
        Object.keys(row).filter((key) => /^客户原话\d+$/.test(key) && row[key]).length,
      ),
    )
    const maxReasons = Math.max(
      0,
      ...rows.map((row) =>
        Object.keys(row).filter((key) => /^低分原因\d+$/.test(key) && row[key]).length,
      ),
    )

    return [
      { title: '数据月份', dataIndex: '数据月份', width: 100, fixed: 'left' },
      { title: '客户名称', dataIndex: '客户名称', width: 160, fixed: 'left', ellipsis: true },
      { title: '客户编码', dataIndex: '客户编码', width: 140, ellipsis: true },
      { title: '产品名称', dataIndex: '产品名称', width: 160, ellipsis: true },
      { title: '建议触发类型', dataIndex: '建议触发类型', width: 140, ellipsis: true },
      { title: '7分以下总次数', dataIndex: '7分以下总次数', width: 112 },
      { title: '7分以下分布', dataIndex: '7分以下分布', width: 160, ellipsis: true },
      { title: '原话命中条数', dataIndex: '原话命中条数', width: 112 },
      { title: '低分原因命中条数', dataIndex: '低分原因命中条数', width: 132 },
      { title: '最近反馈时间', dataIndex: '最近反馈时间', width: 168 },
      { title: '涉及渠道', dataIndex: '涉及渠道', width: 140, ellipsis: true },
      { title: '建议回访原因', dataIndex: '建议回访原因', width: 260, ellipsis: true },
      ...Array.from({ length: maxQuotes }, (_, index) => ({
        title: `客户原话${index + 1}`,
        dataIndex: `客户原话${index + 1}`,
        width: 220,
        ellipsis: true,
      })),
      ...Array.from({ length: maxReasons }, (_, index) => ({
        title: `低分原因${index + 1}`,
        dataIndex: `低分原因${index + 1}`,
        width: 220,
        ellipsis: true,
      })),
      { title: '回访结果', dataIndex: '回访结果', width: 220, ellipsis: true },
      { title: '内部评估', dataIndex: '内部评估', width: 220, ellipsis: true },
    ]
  }, [rows])

  if (!rows.length) {
    return <Empty className="rounded-xl border border-ink-200 bg-white py-12" description="无匹配客服部回访记录" />
  }

  return (
    <Table
      size="small"
      rowKey={(row, index) => `${row['数据月份'] || 'month'}-${row['客户名称'] || 'customer'}-${row['产品名称'] || 'product'}-${index}`}
      dataSource={rows}
      columns={columns}
      scroll={{ x: 2200 }}
      pagination={{ pageSize: 20 }}
    />
  )
}

function CardGrid({ items, onSelect, postUseMode = false }) {
  if (!items.length) {
    return <Empty className="rounded-xl border border-ink-200 bg-white py-12" description="无匹配反馈" />
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((fb) => {
        const isPostUse =
          postUseMode ||
          fb.dataSourceType === 'post_use_rating' ||
          recordSourceType(fb) === 'post_use_rating'
        if (isPostUse) {
          const channel =
            fb.channel === 'sms'
              ? '短信'
              : fb.channel === 'console'
                ? '控制台'
                : fb.channel || fb.sourceSubType || '用后即评'
          const score =
            fb.ratingScore != null && Number.isFinite(Number(fb.ratingScore))
              ? Number(fb.ratingScore)
              : null
          const product = fb.productName || fb.product || '—'
          const snippet = fb.rawText || fb.commentText || fb.lowScoreReason || '—'
          return (
            <Card
              key={fb.id}
              hoverable
              className="cursor-pointer"
              onClick={() => onSelect(fb)}
            >
              <div className="flex flex-wrap gap-1.5">
                <Tag color="blue">{channel}</Tag>
                {score != null ? <Tag color="gold">{score} 分</Tag> : null}
                <Tag>{DATA_SOURCE_LABELS.post_use_rating || '用后即评'}</Tag>
                {fb.journeyL1 ? <Tag color="blue">{fb.journeyL1}</Tag> : null}
              </div>
              <Typography.Paragraph className="!mb-0 !mt-2 line-clamp-2 text-sm font-medium">
                {product}
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 line-clamp-3 !text-xs">
                {snippet}
              </Typography.Paragraph>
              <Typography.Text type="secondary" className="mt-3 block text-[10px]">
                {fb.importMonth || '未知月份'} · {fb.customerName || fb.customerCode || '—'}
              </Typography.Text>
            </Card>
          )
        }
        return (
        <Card
          key={fb.id}
          hoverable
          className="cursor-pointer"
          onClick={() => onSelect(fb)}
        >
          <div className="flex flex-wrap gap-1.5">
            <SentimentBadge record={fb} />
            <Tag>{DATA_SOURCE_LABELS[recordSourceType(fb)] || recordSourceType(fb)}</Tag>
            <Tag color="blue">{fb.requestScene || '未分类'}</Tag>
            <Tag>{fb.problemType || '未分类'}</Tag>
            {fb.journeyL1 && <Tag color="blue">{fb.journeyL1}</Tag>}
            {hasOpenTicketTodos(fb) ? <Tag color="orange">有待办</Tag> : null}
          </div>
          <Typography.Paragraph className="!mb-0 !mt-2 line-clamp-2 text-sm font-medium">
            {fb.problemSummary || fb.customerQuote || '—'}
          </Typography.Paragraph>
          {fb.journeyL2 && (
            <Typography.Text type="secondary" className="mt-1 block text-xs">
              {fb.journeyL2}
            </Typography.Text>
          )}
          <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 line-clamp-2 !text-xs">
            {fb.solutionSummary || '—'}
          </Typography.Paragraph>
          {fb.optimizationSuggestion && (
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 line-clamp-2 !text-xs">
              LLM：{fb.optimizationSuggestion}
            </Typography.Paragraph>
          )}
          {getEstablishedActionDisplay(fb) && (
            <Typography.Paragraph className="!mb-0 !mt-1 line-clamp-2 !text-xs">
              确立举措：{getEstablishedActionDisplay(fb)}
            </Typography.Paragraph>
          )}
          <Typography.Text type="secondary" className="mt-3 block text-[10px]">
            {fb.ticketId || '—'} · {fb.importMonth || '未知月份'} · {fb.product || '—'}
            {fb.productSpec && fb.productSpec !== fb.product ? ` / ${fb.productSpec}` : ''} ·{' '}
            {fb.resourcePool || '—'}
          </Typography.Text>
        </Card>
        )
      })}
    </div>
  )
}
