import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, Card, Empty, Input, Modal, Segmented, Select, Space, Spin, Tag, Tooltip, Typography, message } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { useInsights } from '../context/InsightsContext.jsx'
import { formatBulkRetagScopeLabel } from '../lib/retagSession.js'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { useBulkRetagModal } from '../hooks/useBulkRetagModal.jsx'
import { TaggingProgressAlert } from '../components/TaggingProgressAlert.jsx'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { periodSpecFromImportMonth, resolveInsightPeriod } from '../domain/insightPeriod.js'
import { usePeriodScope } from '../hooks/usePeriodScope.js'
import { SCHEMA_VERSION, DEFAULT_TENANT_ID } from '../domain/constants.js'
import { recordSourceType } from '../snapshots/recordScope.js'
import { PageHeader } from './Dashboard.shared.jsx'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import FeedbackTable from '../components/FeedbackTable.jsx'
import FeedbackDrawer from '../components/FeedbackDrawer.jsx'
import SentimentBadge from '../components/SentimentBadge.jsx'
import SentimentDistributionPanel from '../components/SentimentDistributionPanel.jsx'
import { listProducts, listResourcePools } from '../lib/productTaxonomy.js'
import { countByField } from '../lib/productAnalytics.js'
import {
  countComplaintCauseL1,
  getComplaintCauseL1Display,
  isComplaintTicket,
} from '../domain/complaintCause.js'
import PermissionGate from '../components/auth/PermissionGate.jsx'
import { exportTicketAnalysisWithConfirm, getExportV3Headers } from '../lib/ticketAnalysisExport.js'
import { isLegacyDemoTicketId } from '../lib/desensitize.js'
import {
  countRecordsNeedingTicketLlmEnrichment,
  countRecordsNeedingJourneyLlmEnrichment,
  recordHasFullTicketLlmEnrichment,
  recordNeedsTicketLlmEnrichment,
  recordNeedsJourneyLlmEnrichment,
  TICKET_LLM_FILTER_HINTS,
  TICKET_LLM_FILTER_OPTIONS,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'
import { renderDefinitionSelectOption } from '../components/tags/DefinitionSelectOption.jsx'
import {
  downloadUnknownJourneyCsv,
  summarizeUnknownJourneyRecords,
  UNKNOWN_JOURNEY_REASON_LABELS,
} from '../lib/journeyRetagSummary.js'
import ImportAnalysisPanel from '../components/ImportAnalysisPanel.jsx'
import { getEstablishedActionDisplay } from '../domain/establishedAction.js'
import {
  FOLLOW_UP_FILTER_OPTIONS,
  FOLLOW_UP_RESOLVED_FILTER_OPTIONS,
  matchesFollowUpFilters,
  matchesOptionalTextFilter,
  parseFeedbackFollowUpSearchParams,
  patchFeedbackFollowUpSearchParams,
} from '../lib/feedbackFilters.js'

/**
 * @param {string | null | undefined} raw
 */
function parseTicketIdsParam(raw) {
  if (!raw) return []
  return raw
    .split(',')
    .map((t) => decodeURIComponent(t.trim()))
    .filter(Boolean)
}

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
  } = useInsights()
  const { remoteBannerText } = useSharedBackgroundTaskBlock()

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
  const [selected, setSelected] = useState(null)
  const [view, setView] = useState('table')
  const [q, setQ] = useState('')
  const [product, setProduct] = useState('')
  const [problemType, setProblemType] = useState('')
  const [complaintCauseL1, setComplaintCauseL1] = useState('')
  const [journeyL1, setJourneyL1] = useState('')
  const [resourcePool, setResourcePool] = useState('')
  const [dataSourceFilter, setDataSourceFilter] = useState('')
  const [ticketLlmFilter, setTicketLlmFilter] = useState('')
  const [followUpFilter, setFollowUpFilter] = useState('')
  const [followUpResolvedFilter, setFollowUpResolvedFilter] = useState('')
  const [reasonDimFilter, setReasonDimFilter] = useState('')
  const [requestScene, setRequestScene] = useState('')
  const [selectedTicketIds, setSelectedTicketIds] = useState(/** @type {string[]} */ ([]))
  const [importAnalysisOpen, setImportAnalysisOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const skipTicketIdsUrlSyncRef = useRef(false)
  const skipFollowUpUrlSyncRef = useRef(false)

  const syncFollowUpFiltersToUrl = (patch) => {
    skipFollowUpUrlSyncRef.current = true
    const next = patchFeedbackFollowUpSearchParams(searchParams, patch)
    setSearchParams(next, { replace: true })
  }

  const syncTicketIdsToUrl = (ids) => {
    const unique = [...new Set(ids.map((t) => t.trim()).filter(Boolean))]
    setSelectedTicketIds(unique)
    skipTicketIdsUrlSyncRef.current = true
    const next = new URLSearchParams(searchParams)
    if (unique.length) next.set('ticketIds', unique.join(','))
    else next.delete('ticketIds')
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    if (skipTicketIdsUrlSyncRef.current) {
      skipTicketIdsUrlSyncRef.current = false
      return
    }

    const month = searchParams.get('month')
    const rawTicketIds = searchParams.get('ticketIds')

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      void selectInsightPeriod(periodSpecFromImportMonth(month))
    }

    if (rawTicketIds !== null) {
      setSelectedTicketIds(parseTicketIdsParam(rawTicketIds))
      setProduct('')
      setProblemType('')
      setComplaintCauseL1('')
      setJourneyL1('')
      setResourcePool('')
      setDataSourceFilter('')
      setQ('')
      return
    }

    setSelectedTicketIds([])

    const source = searchParams.get('source')
    const urlProduct = searchParams.get('product')
    const urlProblemType = searchParams.get('problemType')
    const urlComplaintCauseL1 = searchParams.get('complaintCauseL1')
    const urlJourneyL1 = searchParams.get('journeyL1')
    const urlRequestScene = searchParams.get('requestScene')

    if (source && DATA_SOURCE_TYPES.includes(source)) setDataSourceFilter(source)
    else setDataSourceFilter('')
    setProduct(urlProduct || '')
    setProblemType(urlProblemType || '')
    setComplaintCauseL1(urlComplaintCauseL1 || '')
    setJourneyL1(urlJourneyL1 || '')
    setRequestScene(urlRequestScene || '')
    setResourcePool('')
    setQ('')

    if (!skipFollowUpUrlSyncRef.current) {
      const followUpParams = parseFeedbackFollowUpSearchParams(searchParams)
      setFollowUpFilter(followUpParams.followUp)
      setFollowUpResolvedFilter(followUpParams.followUpResolved)
      setReasonDimFilter(followUpParams.reasonDim)
    } else {
      skipFollowUpUrlSyncRef.current = false
    }
    // 仅响应 URL 变化；勿依赖 selectInsightPeriod，否则会反复把周期重置回 ?month=
  }, [searchParams])

  useEffect(() => {
    const ticketId = searchParams.get('ticketId')
    if (!ticketId || !feedbacks.length) return
    const match = feedbacks.find((fb) => fb.ticketId === ticketId || fb.id === ticketId)
    if (match) setSelected(match)
  }, [searchParams, feedbacks, currentPeriodId])

  useEffect(() => {
    setSelected(null)
  }, [currentPeriodId])

  const { periodFeedbacks, periodCount, totalInDb } = usePeriodScope({
    feedbacks,
    period: activePeriod,
  })

  const products = useMemo(() => listProducts(periodFeedbacks), [periodFeedbacks])
  const pools = useMemo(
    () => listResourcePools(periodFeedbacks, product || undefined),
    [periodFeedbacks, product],
  )
  const problemTypes = useMemo(() => countByField(periodFeedbacks, 'problemType'), [periodFeedbacks])
  const complaintCauseOptions = useMemo(() => countComplaintCauseL1(periodFeedbacks), [periodFeedbacks])
  const showComplaintCauseFilter =
    !dataSourceFilter || dataSourceFilter === 'complaint_ticket'
  const journeys = useMemo(() => countByField(periodFeedbacks, 'journeyL1'), [periodFeedbacks])
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
    () => (selectedTicketIds.length ? new Set(selectedTicketIds) : null),
    [selectedTicketIds],
  )

  const ticketIdOptions = useMemo(() => {
    /** @type {Map<string, string>} */
    const map = new Map()
    for (const tid of selectedTicketIds) {
      if (tid) map.set(tid, tid)
    }
    for (const fb of periodFeedbacks) {
      const tid = fb.ticketId?.trim()
      if (tid) map.set(tid, tid)
    }
    return [...map.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((tid) => ({ label: tid, value: tid }))
  }, [periodFeedbacks, selectedTicketIds])

  const matchedEvidenceCount = useMemo(() => {
    if (!selectedTicketIdSet?.size) return 0
    let n = 0
    for (const fb of feedbacks) {
      if (fb.ticketId && selectedTicketIdSet.has(fb.ticketId)) n += 1
    }
    return n
  }, [feedbacks, selectedTicketIdSet])

  const filtered = useMemo(() => {
    const baseList = selectedTicketIdSet?.size ? feedbacks : periodFeedbacks
    return baseList.filter((fb) => {
      if (selectedTicketIdSet?.size) {
        if (!fb.ticketId || !selectedTicketIdSet.has(fb.ticketId)) return false
      }
      if (product && (fb.product || '未标注产品') !== product) return false
      if (!matchesOptionalTextFilter(fb.problemType, problemType)) return false
      if (complaintCauseL1) {
        if (!isComplaintTicket(fb)) return false
        if (getComplaintCauseL1Display(fb) !== complaintCauseL1) return false
      }
      if (journeyL1 && fb.journeyL1 !== journeyL1) return false
      if (resourcePool && (fb.resourcePool || '未标注资源池') !== resourcePool) return false
      if (dataSourceFilter && recordSourceType(fb) !== dataSourceFilter) return false
      if (!matchesOptionalTextFilter(fb.requestScene, requestScene)) return false
      if (
        !matchesFollowUpFilters(fb, {
          followUp: followUpFilter,
          followUpResolved: followUpResolvedFilter,
          reasonDim: reasonDimFilter,
        })
      ) {
        return false
      }
      if (ticketLlmFilter === 'needs_llm' && !recordNeedsTicketLlmEnrichment(fb)) return false
      if (ticketLlmFilter === 'needs_journey_llm' && !recordNeedsJourneyLlmEnrichment(fb, settings))
        return false
      if (ticketLlmFilter === 'full_llm' && !recordHasFullTicketLlmEnrichment(fb)) return false
      if (q) {
        const hay = [
          fb.customerQuote,
          fb.rawText,
          fb.handlingText,
          fb.problemSummary,
          fb.solutionSummary,
          fb.ticketId,
          fb.product,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q.toLowerCase())) return false
      }
      return true
    })
  }, [
    feedbacks,
    periodFeedbacks,
    selectedTicketIdSet,
    product,
    problemType,
    complaintCauseL1,
    journeyL1,
    resourcePool,
    dataSourceFilter,
    followUpFilter,
    followUpResolvedFilter,
    reasonDimFilter,
    requestScene,
    ticketLlmFilter,
    settings,
    q,
  ])

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

  return (
    <div>
      <PageHeader
        title="反馈库"
        desc={`库内 ${totalInDb} 条 · 周期内 ${periodCount} 条 · 当前筛选 ${filtered.length} 条${activePeriod ? `（${activePeriod.label}）` : ''}`}
      />

      <div className="page-toolbar">
        <InsightPeriodPicker />
      </div>

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
                      setTicketLlmFilter('needs_llm')
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
                      setTicketLlmFilter('needs_journey_llm')
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

        {selectedTicketIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
            <Typography.Text className="shrink-0 text-sm text-indigo-900">
              行动建议依据工单（{selectedTicketIds.length} 个）
              {matchedEvidenceCount < selectedTicketIds.length ? (
                <Typography.Text type="secondary" className="ml-1 text-xs">
                  · 库内匹配 {matchedEvidenceCount} 条
                </Typography.Text>
              ) : null}
            </Typography.Text>
            <Typography.Text type="secondary" className="text-xs">
              已按工单号限定范围，可叠加下方类型等条件；取消工单号后恢复常规筛选
            </Typography.Text>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Select
            mode="multiple"
            allowClear
            showSearch
            className="min-w-[220px] max-w-md"
            placeholder="工单号（可多选）"
            value={selectedTicketIds}
            options={ticketIdOptions}
            onChange={syncTicketIdsToUrl}
            maxTagCount="responsive"
            optionFilterProp="label"
            popupMatchSelectWidth={320}
          />
        <Input.Search
          className="max-w-xs"
          placeholder="搜索工单号、原话、问题/方案摘要…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          allowClear
        />
        <Select
          className="min-w-[150px]"
          value={product}
          options={[
            { label: '全部产品', value: '' },
            ...products.map((p) => ({ label: p.name, value: p.name })),
          ]}
          onChange={(value) => {
            setProduct(value)
            setResourcePool('')
          }}
        />
        <Select
          className="min-w-[150px]"
          value={problemType}
          options={[
            { label: '全部问题类型（打标）', value: '' },
            ...problemTypes.map((t) => ({ label: t.name, value: t.name })),
          ]}
          onChange={setProblemType}
        />
        {showComplaintCauseFilter && (
          <Select
            className="min-w-[180px]"
            value={complaintCauseL1}
            options={[
              { label: '全部投诉原因（终判）', value: '' },
              ...complaintCauseOptions.map((t) => ({ label: t.name, value: t.name })),
            ]}
            onChange={setComplaintCauseL1}
          />
        )}
        <Select
          className="min-w-[150px]"
          value={journeyL1}
          options={[
            { label: '全部旅程环节', value: '' },
            ...journeys.map((j) => ({ label: j.name, value: j.name })),
          ]}
          onChange={setJourneyL1}
        />
        <Select
          className="min-w-[150px]"
          value={resourcePool}
          options={[
            { label: '全部资源池', value: '' },
            ...pools.map((p) => ({ label: p.name, value: p.name })),
          ]}
          onChange={setResourcePool}
        />
        <Tooltip
          title={TICKET_LLM_FILTER_HINTS[ticketLlmFilter] || TICKET_LLM_FILTER_HINTS['']}
          placement="bottom"
        >
          <Select
            className="min-w-[220px]"
            value={ticketLlmFilter}
            optionRender={renderDefinitionSelectOption}
            options={TICKET_LLM_FILTER_OPTIONS}
            onChange={setTicketLlmFilter}
          />
        </Tooltip>
        <Select
          className="min-w-[130px]"
          value={dataSourceFilter}
          options={[
            { label: '全部来源', value: '' },
            ...DATA_SOURCE_TYPES.map((t) => ({ label: DATA_SOURCE_LABELS[t], value: t })),
          ]}
          onChange={(value) => {
            setDataSourceFilter(value)
            if (value && value !== 'complaint_ticket') setComplaintCauseL1('')
          }}
        />
        <Select
          className="min-w-[140px]"
          value={followUpFilter}
          options={FOLLOW_UP_FILTER_OPTIONS}
          onChange={(value) => {
            setFollowUpFilter(value)
            const nextResolved =
              value === 'none' || !value ? '' : followUpResolvedFilter
            if (nextResolved !== followUpResolvedFilter) setFollowUpResolvedFilter(nextResolved)
            syncFollowUpFiltersToUrl({
              followUp: value,
              followUpResolved: nextResolved,
            })
          }}
        />
        <Select
          className="min-w-[140px]"
          value={followUpResolvedFilter}
          disabled={!followUpFilter || followUpFilter === 'none'}
          options={FOLLOW_UP_RESOLVED_FILTER_OPTIONS}
          onChange={(value) => {
            setFollowUpResolvedFilter(value)
            syncFollowUpFiltersToUrl({
              followUp: followUpFilter,
              followUpResolved: value,
            })
          }}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Tooltip title="按工单号覆盖库内已有分析字段；列含义与必填项见下载模板表头（带 * 为必填）">
            <Button icon={<DownloadOutlined />} onClick={() => setImportAnalysisOpen(true)}>
              导入分析结果
            </Button>
          </Tooltip>
          <Tooltip title={`导出 v3：${getExportV3Headers().length} 列分析结果（可与导入分析结果往返，含回访满意度）。列说明见 docs/EXPORT-V2-MIGRATION.md`}>
            <Button
              icon={<UploadOutlined />}
              disabled={!filtered.length}
              onClick={handleExport}
            >
              导出分析结果
            </Button>
          </Tooltip>
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
          <Segmented
            value={view}
            options={[
              { label: '表格', value: 'table' },
              { label: '卡片', value: 'cards' },
            ]}
            onChange={setView}
          />
        </div>
      </div>
      </div>

      {filtered.length > 0 && (
        <div className="page-section-sm">
          <SentimentDistributionPanel
            items={filtered}
            subtitle="随上方筛选条件联动"
          />
        </div>
      )}

      <div className="page-section-sm">
        {periodsLoading ? (
          <div className="flex justify-center py-16">
            <Spin tip="加载数据周期…" />
          </div>
        ) : view === 'table' ? (
          <FeedbackTable
            key={currentPeriodId || 'no-period'}
            items={filtered}
            onSelect={setSelected}
          />
        ) : (
          <CardGrid
            key={currentPeriodId || 'no-period'}
            items={filtered}
            onSelect={setSelected}
          />
        )}
      </div>

      <FeedbackDrawer feedback={selected} onClose={() => setSelected(null)} />

      <Modal
        title="导入分析结果"
        open={importAnalysisOpen}
        onCancel={() => setImportAnalysisOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <ImportAnalysisPanel
          inModal
          onImportComplete={() => setImportAnalysisOpen(false)}
        />
      </Modal>
    </div>
  )
}

function CardGrid({ items, onSelect }) {
  if (!items.length) {
    return <Empty className="rounded-xl border border-ink-200 bg-white py-12" description="无匹配反馈" />
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((fb) => (
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
            {fb.journeyL1 && (
              <Tag color="blue">
                {fb.journeyL1}
              </Tag>
            )}
          </div>
          <Typography.Paragraph className="!mb-0 !mt-2 line-clamp-2 text-sm font-medium">
            {fb.problemSummary || fb.customerQuote || '—'}
          </Typography.Paragraph>
          {fb.journeyL2 && (
            <Typography.Text type="secondary" className="mt-1 block text-xs">{fb.journeyL2}</Typography.Text>
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
      ))}
    </div>
  )
}
