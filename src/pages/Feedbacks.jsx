import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Button, Card, Empty, Modal, Segmented, Space, Spin, Tag, Tooltip, Typography, message } from 'antd'
import { DownloadOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserTicketReviews } from '../context/UserTicketReviewContext.jsx'
import { matchesMyReviewFilter } from '../domain/userTicketReview.js'
import { formatBulkRetagScopeLabel } from '../lib/retagSession.js'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { useBulkRetagModal } from '../hooks/useBulkRetagModal.jsx'
import { TaggingProgressAlert } from '../components/TaggingProgressAlert.jsx'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { periodSpecFromImportMonth, resolveInsightPeriod } from '../domain/insightPeriod.js'
import { usePeriodScope } from '../hooks/usePeriodScope.js'
import { SCHEMA_VERSION, DEFAULT_TENANT_ID } from '../domain/constants.js'
import { recordSourceType } from '../snapshots/recordScope.js'
import { PageHeader } from './Dashboard.shared.jsx'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import FeedbackTable from '../components/FeedbackTable.jsx'
import FeedbackDrawer from '../components/FeedbackDrawer.jsx'
import { useFeedbackDrawerSelection } from '../hooks/useFeedbackDrawerSelection.js'
import FeedbackFilterBar from '../components/feedbacks/FeedbackFilterBar.jsx'
import SentimentBadge from '../components/SentimentBadge.jsx'
import { sentimentStats } from '../lib/analytics.js'
import { listProducts, listResourcePools } from '../lib/productTaxonomy.js'
import { countByField } from '../lib/productAnalytics.js'
import {
  cascadeClearProductDependentFilters,
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
import ComplaintCauseReviewAdminModal from '../components/ComplaintCauseReviewAdminModal.jsx'
import { getEstablishedActionDisplay } from '../domain/establishedAction.js'
import {
  matchesFollowUpFilters,
  matchesHandlingKeywordFilter,
  matchesListeningReviewedFilter,
  matchesOptionalTextFilter,
  matchesTodoStatusFilter,
  parseFeedbackSearchParams,
  patchFeedbackSearchParams,
} from '../lib/feedbackFilters.js'
import { hasOpenTicketTodos } from '../domain/ticketTodo.js'
import {
  applyFeedbackFilterPatch,
  clearAllFeedbackFilters,
  createEmptyFeedbackFilters,
  feedbackFiltersFromParsed,
  feedbackFiltersToUrlPatch,
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
  POST_USE_LANE_HINT,
  isPostUseRatingLibraryRecord,
  isPostUseNon10LibraryRecord,
  resolveFeedbackLane,
} from '../domain/postUseRatingImport.js'
import {
  needsPostUseJourney,
  enrichPostUseJourneyBatch,
} from '../lib/postUseRating/enrichPostUseJourney.js'

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
    syncSharedDataFromServer,
    updateFeedback,
  } = useInsights()
  const { user } = useAuth()
  const { enabled: reviewEnabled, doneRecordIds } = useUserTicketReviews()
  const { remoteBannerText } = useSharedBackgroundTaskBlock()
  const [journeyBusy, setJourneyBusy] = useState(false)
  const [view, setView] = useState('table')
  const [filters, setFilters] = useState(createEmptyFeedbackFilters)
  const [importAnalysisOpen, setImportAnalysisOpen] = useState(false)
  const [complaintCauseReviewOpen, setComplaintCauseReviewOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const skipUrlSyncRef = useRef(false)

  const feedbackLane = useMemo(() => resolveFeedbackLane(searchParams), [searchParams])
  const isPostUseLane = feedbackLane === FEEDBACK_LANE_POST_USE

  const switchFeedbackLane = useCallback(
    (lane) => {
      const next = new URLSearchParams(searchParams)
      next.set('lane', lane)
      if (lane === FEEDBACK_LANE_POST_USE) {
        next.set('source', 'post_use_rating')
      } else if (next.get('source') === 'post_use_rating') {
        next.delete('source')
      }
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
    setFilters(next)
    syncFiltersToUrl(next)
  }, [syncFiltersToUrl])

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
      message.success('已刷新')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '刷新失败')
    } finally {
      setRefreshing(false)
    }
  }, [importSession?.active, retagSession?.active, syncSharedDataFromServer])

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
    setFilters(
      feedbackFiltersFromParsed({
        ...parsed,
        ticketIds: parsed.ticketIds,
      }),
    )
  }, [searchParams])

  useEffect(() => {
    const ticketId = searchParams.get('ticketId')
    if (!ticketId || !feedbacks.length) return
    const match = feedbacks.find((fb) => fb.ticketId === ticketId || fb.id === ticketId)
    if (match) setSelectedDirect(match)
  }, [searchParams, feedbacks, currentPeriodId])

  useEffect(() => {
    setSelectedDirect(null)
  }, [currentPeriodId])

  const { periodFeedbacks, periodCount, totalInDb } = usePeriodScope({
    period: activePeriod,
  })

  /** 周期内按大类可见条数（用后即评不含 callback） */
  const laneVisiblePeriodCount = useMemo(() => {
    if (isPostUseLane) {
      return periodFeedbacks.filter(isPostUseRatingLibraryRecord).length
    }
    return periodFeedbacks.filter((fb) => {
      const t = recordSourceType(fb)
      return t === 'complaint_ticket' || t === 'consultation_ticket'
    }).length
  }, [periodFeedbacks, isPostUseLane])

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

  const handleProductChange = useCallback(
    (product) => {
      const scoped = scopeFeedbacksByProduct(periodFeedbacks, product || '')
      const next = cascadeClearProductDependentFilters(
        applyFeedbackFilterPatch('product', { product: product || '' }, filters),
        scoped,
      )
      setFilters(next)
      syncFiltersToUrl(next)
    },
    [filters, periodFeedbacks, syncFiltersToUrl],
  )

  const scopedFeedbacks = useMemo(
    () => scopeFeedbacksByProduct(periodFeedbacks, filters.product || undefined),
    [periodFeedbacks, filters.product],
  )

  const products = useMemo(() => listProducts(periodFeedbacks), [periodFeedbacks])
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

  const selectedTicketIdSet = useMemo(
    () => (filters.ticketIds.length ? new Set(filters.ticketIds) : null),
    [filters.ticketIds],
  )

  const ticketIdOptions = useMemo(() => {
    /** @type {Map<string, string>} */
    const map = new Map()
    for (const tid of filters.ticketIds) {
      if (tid) map.set(tid, tid)
    }
    for (const fb of periodFeedbacks) {
      const tid = fb.ticketId?.trim()
      if (tid) map.set(tid, tid)
    }
    return [...map.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((tid) => ({ label: tid, value: tid }))
  }, [periodFeedbacks, filters.ticketIds])

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
  ])

  const filteredSentiment = useMemo(() => sentimentStats(filtered), [filtered])

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
            库内 {totalInDb} 条 · 本大类周期内 {laneVisiblePeriodCount} 条 · 当前筛选 {filtered.length}{' '}
            条
            {activePeriod ? `（${activePeriod.label}）` : ''}
            {periodCount !== laneVisiblePeriodCount ? (
              <span className="text-ink-400"> · 周期全量 {periodCount}</span>
            ) : null}
            {filtered.length > 0 && !isPostUseLane ? (
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

      {!isPostUseLane &&
        (needsTicketLlmCount > 0 ||
          needsJourneyLlmCount > 0 ||
          missingTags > 0 ||
          filters.ticketIds.length > 0) && (
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

          {filters.ticketIds.length > 0 && (
            <Alert
              type="info"
              showIcon
              title={`已按工单号筛选 ${filters.ticketIds.length} 个`}
              description={
                matchedEvidenceCount > 0
                  ? `库内匹配证据 ${matchedEvidenceCount} 条（含跨周期）。`
                  : '当前筛选工单号在库内暂无匹配记录。'
              }
            />
          )}
        </div>
      )}

      <div
        className={`page-sticky-chrome ${
          needsTicketLlmCount > 0 ||
          needsJourneyLlmCount > 0 ||
          missingTags > 0 ||
          filters.ticketIds.length > 0
            ? 'page-section-sm'
            : 'page-section'
        }`}
      >        <FeedbackFilterBar
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onProductChange={handleProductChange}
          onClearFilters={handleClearFilters}
          showComplaintCauseFilter={showComplaintCauseFilter}
          showMyReviewFilter={reviewEnabled}
          options={{
            ticketIdOptions,
            products,
            problemTypes,
            complaintCauseOptions,
            journeys,
            resourcePools: pools,
            requestScenes,
          }}
          actions={
            <>
              <Tooltip title="按工单号覆盖库内已有分析字段；列含义与必填项见下载模板表头（带 * 为必填）">
                <Button icon={<DownloadOutlined />} onClick={() => setImportAnalysisOpen(true)}>
                  导入分析结果
                </Button>
              </Tooltip>
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

      <div className="page-section-sm">
        {periodsLoading ? (
          <div className="flex justify-center py-16">
            <Spin tip="加载数据周期…" />
          </div>
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

      <FeedbackDrawer
        feedback={selected}
        onClose={requestCloseDrawer}
        onSavedClose={closeDrawer}
        onDirtyChange={onDrawerDirtyChange}
      />

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

      <ComplaintCauseReviewAdminModal
        open={complaintCauseReviewOpen}
        onClose={() => setComplaintCauseReviewOpen(false)}
      />
    </div>
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
