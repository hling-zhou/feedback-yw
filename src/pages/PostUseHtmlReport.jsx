import { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Link, useParams } from 'react-router-dom'
import { Alert, Button, Space, Spin, Typography, message } from 'antd'
import { MailOutlined } from '@ant-design/icons'
import { useAuth } from '../context/AuthContext.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { SCHEMA_VERSION } from '../domain/constants.js'
import { resolveInsightPeriod, resolvePreviousInsightPeriod } from '../domain/insightPeriod.js'
import { filterRecordsForScope } from '../snapshots/recordScope.js'
import {
  getPostUseFocusTrackedNames,
  getPostUseRatingProductNames,
  scopePostUseRatingRecords,
} from '../lib/productCatalog/postUseRatingProducts.js'
import { getCatalogProducts } from '../lib/productCatalogLoader.js'
import { listActionItems } from '../lib/actionItemClient.js'
import { listAllPostUseJiraItems } from '../lib/postUseJiraClient.js'
import { isLlmAvailable } from '../lib/llmClient.js'
import { listReportDrafts, listReportIssueLinks, saveReportDraft } from '../lib/postUseRating/reportClient.js'
import { mergeGeneratedReportDraft, runReportDraftQueue } from '../lib/postUseRating/reportDraftAuto.js'
import { generateReportProductDraft } from '../lib/postUseRating/reportNarrative.js'
import { initialReportIssueNarratives, mergeManualReportIssueNarratives } from '../lib/postUseRating/reportNarrativeState.js'
import { loadVisitRecords } from '../lib/postUseRating/visitRecords.js'
import { loadPostUseTrend } from '../lib/postUseRating/trendStore.js'
import { loadPostUsePeriodQuality } from '../lib/postUseRating/qualityStore.js'
import { postUsePeriodMonths, postUseVisitMonthsForPeriod } from '../lib/postUseRating/periodScope.js'
import { buildPostUseStoryModel } from '../lib/postUseRating/storyModel.js'
import { clipDepartmentStatusTrends, normalizeDepartmentStatusTrends, rollupCompanyMetrics } from '../lib/postUseRating/statusTrends.js'
import { buildHtmlMonthlyReportModel } from '../lib/postUseRating/htmlReportModel.js'
import { buildPostUseReportV2Model, validatePostUseReportV2 } from '../lib/postUseRating/reportV2Model.js'
import { REPORT_V2_CSS } from '../lib/postUseRating/reportV2Styles.js'
import { generatePostUseReportV2Narrative } from '../lib/postUseRating/reportV2Narrative.js'
import { loadHtmlReportOverlay, saveHtmlReportOverlay } from '../lib/postUseRating/htmlReportOverlay.js'
import {
  buildOfflineMonthlyReportHtml,
  downloadOfflineMonthlyReportHtml,
  offlineMonthlyReportFilename,
} from '../lib/postUseRating/htmlReportOffline.js'
import { loadMonthlyReportLearnings } from '../lib/postUseRating/monthlyReportDocxImport.js'
import PostUseHtmlReportDocument, {
  ReportSectionToggles,
} from '../components/workbench/PostUseHtmlReportDocument.jsx'
import PostUseHtmlReportV2Document from '../components/workbench/PostUseHtmlReportV2Document.jsx'
import SendMailModal from '../components/mail/SendMailModal.jsx'
import { MAIL_PRESET_REPORT } from '../domain/mail.js'
import { textToBase64 } from '../lib/mailClient.js'
import './PostUseHtmlReport.css'
import { REPORT_SHARED_CSS } from '../lib/postUseRating/reportSharedStyles.js'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const QUARTER_RE = /^\d{4}-Q[1-4]$/
const WORKBENCH_HREF = '/workbench?tab=post_use_rating'

function resolveReportRoute(param) {
  if (MONTH_RE.test(param || '')) {
    const periodId = `period:month:${param}`
    return { key: param, kind: 'month', periodId, period: resolveInsightPeriod(periodId, null, SCHEMA_VERSION) }
  }
  if (QUARTER_RE.test(param || '')) {
    const periodId = `period:quarter:${param}`
    return { key: param, kind: 'quarter', periodId, period: resolveInsightPeriod(periodId, null, SCHEMA_VERSION) }
  }
  return null
}

/** @param {{ version?: 'v1' | 'v2' }} props */
export default function PostUseHtmlReport({ version = 'v1' }) {
  const isV2 = version === 'v2'
  const { month } = useParams()
  const { can, user } = useAuth()
  const canEdit = can('editRecord')
  const {
    feedbacks,
    adapter,
    settings,
    storageReady,
    loadPostUseRatingForPeriod,
    postUseRatingOnDemand,
    postUseSettledPeriodIds,
    postUseCacheGeneration,
    productCatalogMeta,
  } = useInsights()
  const [visits, setVisits] = useState([])
  const [traces, setTraces] = useState([])
  const [issueLinks, setIssueLinks] = useState([])
  const [generatedDrafts, setGeneratedDrafts] = useState([])
  const [autoDraftStatus, setAutoDraftStatus] = useState({ reportKey: '', phase: 'idle', completed: 0, total: 0, failures: [] })
  const autoDraftRunRef = useRef(null)
  const manualIssueFieldsRef = useRef({})
  const overlayRef = useRef(null)
  const activeReportRef = useRef('')
  const [actionItems, setActionItems] = useState([])
  const [trendSnap, setTrendSnap] = useState(null)
  const [quality, setQuality] = useState(null)
  const [learnings, setLearnings] = useState([])
  const [overlay, setOverlay] = useState(null)
  const [sideLoading, setSideLoading] = useState(true)
  const [loadedReportKey, setLoadedReportKey] = useState('')
  const [sideLoadError, setSideLoadError] = useState(null)
  const [autoEvidenceReady, setAutoEvidenceReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [judgment, setJudgment] = useState('')
  const [todoNote, setTodoNote] = useState('')
  const [todoItems, setTodoItems] = useState([])
  const [issueNarratives, setIssueNarratives] = useState({})
  const [actionOverrides, setActionOverrides] = useState({})
  const [manualIssueFields, setManualIssueFields] = useState({})
  const [visitSupplements, setVisitSupplements] = useState({})
  const [statusTrends, setStatusTrends] = useState(null)
  const [statusTrendsReady, setStatusTrendsReady] = useState(false)
  const [hiddenSectionIds, setHiddenSectionIds] = useState([])
  const [mailOpen, setMailOpen] = useState(false)
  const [regeneratingKey, setRegeneratingKey] = useState('')
  const [narrativeGenerating, setNarrativeGenerating] = useState(false)
  overlayRef.current = overlay

  const route = useMemo(() => resolveReportRoute(month), [month])
  const reportKey = route?.key || ''
  activeReportRef.current = reportKey
  const reportKind = route?.kind || ''
  const reportPeriod = route?.period || null
  const regenerating = regeneratingKey === reportKey && Boolean(reportKey)
  const savedV2Snapshot = Boolean(isV2 && !regenerating && overlay?.snapshot?.reportKey === reportKey)
  const loadMonthIds = useMemo(() => {
    if (!reportPeriod) return []
    const months = new Set(postUsePeriodMonths(reportPeriod))
    const previous = resolvePreviousInsightPeriod(reportPeriod)
    for (const item of postUsePeriodMonths(previous)) months.add(item)
    return [...months].map((item) => `period:month:${item}`)
  }, [reportPeriod])

  useEffect(() => {
    if (!storageReady || !loadMonthIds.length) return undefined
    if (isV2 && (loadedReportKey !== reportKey || savedV2Snapshot)) return undefined
    for (const periodId of loadMonthIds) void loadPostUseRatingForPeriod(periodId)
    return undefined
  }, [storageReady, loadMonthIds, loadPostUseRatingForPeriod, postUseCacheGeneration, isV2, loadedReportKey, reportKey, savedV2Snapshot])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!adapter || !reportKey) {
        setSideLoading(false)
        return
      }
      setSideLoading(true)
      setLoadedReportKey('')
      setSideLoadError(null)
      setAutoEvidenceReady(false)
      try {
        let completeForAi = true
        const requiredForAi = (promise, fallback) => promise.catch(() => {
          completeForAi = false
          return fallback
        })
        const overlaySnap = await requiredForAi(loadHtmlReportOverlay(adapter, reportKey, version), null)
        if (isV2 && !completeForAi) throw new Error('已保存报告读取失败，请刷新重试。')
        if (isV2 && overlaySnap?.snapshot && !regenerating) {
          if (!cancelled) {
            setOverlay(overlaySnap)
            setStatusTrendsReady(true)
            setLoadedReportKey(reportKey)
            setAutoEvidenceReady(true)
          }
          return
        }
        const [v, actionsRes, trend, qualityStore, learningSnap, traceRows, links, drafts] = await Promise.all([
          loadVisitRecords(adapter),
          requiredForAi(listActionItems({ linkedDataSources: 'post_use_rating', limit: 500 }), { items: [] }),
          isV2 ? Promise.resolve(null) : loadPostUseTrend(adapter).catch(() => null),
          isV2 ? Promise.resolve(null) : loadPostUsePeriodQuality(adapter).catch(() => null),
          isV2 ? Promise.resolve([]) : loadMonthlyReportLearnings(adapter).catch(() => []),
          requiredForAi(listAllPostUseJiraItems(), []),
          requiredForAi(listReportIssueLinks(), []),
          isV2 ? Promise.resolve([]) : requiredForAi(listReportDrafts(reportKey), []),
        ])
        if (!cancelled) {
          if (isV2 && !completeForAi) {
            setSideLoadError({ reportKey, message: '报告所需的回访、溯源或行动数据未完整加载，请刷新重试。' })
            setLoadedReportKey('')
            return
          }
          setVisits(v)
          setTraces(traceRows)
          setIssueLinks(links)
          setGeneratedDrafts(drafts)
          setActionItems(actionsRes?.items || [])
          setTrendSnap(trend)
          setQuality(qualityStore)
          setOverlay(overlaySnap)
          setLearnings(learningSnap)
          setLoadedReportKey(reportKey)
          setAutoEvidenceReady(completeForAi)
        }
      } catch (error) {
        if (!cancelled) {
          setSideLoadError({ reportKey, message: error instanceof Error ? error.message : '报告证据加载失败' })
          setLoadedReportKey('')
          setAutoEvidenceReady(false)
        }
      } finally {
        if (!cancelled) setSideLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, reportKey, reportKind, version, isV2, regenerating])

  const endMonth = useMemo(
    () => (reportPeriod ? postUsePeriodMonths(reportPeriod).at(-1) || '' : ''),
    [reportPeriod],
  )

  useEffect(() => {
    if (isV2 && (loadedReportKey !== reportKey || savedV2Snapshot)) {
      setStatusTrendsReady(savedV2Snapshot)
      return undefined
    }
    if (!adapter || typeof adapter.listPostUseStatusTrends !== 'function' || !endMonth) {
      setStatusTrends(null)
      setStatusTrendsReady(true)
      if (isV2 && endMonth) setSideLoadError({ reportKey, message: '报告历史趋势服务不可用，请刷新重试。' })
      return undefined
    }
    let cancelled = false
    setStatusTrendsReady(false)
    ;(async () => {
      try {
        const trends = clipDepartmentStatusTrends(
          normalizeDepartmentStatusTrends(await adapter.listPostUseStatusTrends()),
          endMonth,
        )
        if (!cancelled) {
          setStatusTrends(trends)
          setStatusTrendsReady(true)
        }
      } catch {
        if (!cancelled) {
          setStatusTrends(null)
          setStatusTrendsReady(true)
          if (isV2) setSideLoadError({ reportKey, message: '报告历史趋势计算失败，请刷新重试。' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, endMonth, isV2, reportKey, postUseCacheGeneration, loadedReportKey, savedV2Snapshot])

  const catalog = useMemo(() => getCatalogProducts(), [feedbacks, productCatalogMeta])
  const productNames = useMemo(() => getPostUseRatingProductNames(catalog), [catalog])
  const focusNames = useMemo(() => getPostUseFocusTrackedNames(catalog), [catalog])
  const items = useMemo(
    () => (reportPeriod && !savedV2Snapshot ? filterRecordsForScope(feedbacks, reportPeriod, 'post_use_rating') : []),
    [feedbacks, reportPeriod, savedV2Snapshot],
  )
  const scopedItems = useMemo(() => scopePostUseRatingRecords(items, catalog), [items, catalog])
  const ticketRecords = useMemo(
    () =>
      (savedV2Snapshot ? [] : feedbacks || []).filter(
        (record) =>
          record.dataSourceType === 'complaint_ticket' ||
          record.dataSourceType === 'consultation_ticket',
      ),
    [feedbacks, savedV2Snapshot],
  )
  const scopedVisits = useMemo(() => {
    if (savedV2Snapshot) return []
    const months = new Set(postUseVisitMonthsForPeriod(reportPeriod))
    return scopePostUseRatingRecords(
      visits.filter((visit) => months.has(visit.importMonth || visit.visitMonth)),
      catalog,
    )
  }, [visits, reportPeriod, catalog, savedV2Snapshot])
  const allScopedItems = useMemo(
    () => scopePostUseRatingRecords(
      (savedV2Snapshot ? [] : feedbacks || []).filter((record) => record.dataSourceType === 'post_use_rating'),
      catalog,
    ),
    [feedbacks, catalog, savedV2Snapshot],
  )
  const periodMonths = useMemo(
    () => (reportPeriod ? postUsePeriodMonths(reportPeriod) : []),
    [reportPeriod],
  )
  const monthReasons = useMemo(() => {
    if (!trendSnap || !periodMonths.length) return []
    const monthSet = new Set(periodMonths)
    const grouped = new Map()
    for (const row of trendSnap.reasons || []) {
      if (!monthSet.has(row.month)) continue
      const key = `${row.reason || ''}\0${row.channel || ''}`
      const current = grouped.get(key) || {
        reason: row.reason,
        count: 0,
        ...(row.channel != null && row.channel !== '' ? { channel: row.channel } : {}),
      }
      current.count += Number(row.count) || 0
      grouped.set(key, current)
    }
    return [...grouped.values()].sort((a, b) => b.count - a.count)
  }, [trendSnap, periodMonths])
  const periodQuality = quality?.periods?.[endMonth] || null

  const remoteCompanyMetrics = useMemo(
    () => isV2 && Array.isArray(statusTrends?.companyMetrics)
      ? rollupCompanyMetrics(statusTrends.companyMetrics, reportPeriod)
      : null,
    [isV2, statusTrends, reportPeriod],
  )
  const useRemoteCompany = Number(remoteCompanyMetrics?.totalSample) > 0

  const storyModel = useMemo(() => {
    if (!reportPeriod || isV2) return null
    return buildPostUseStoryModel({
      records: scopedItems,
      allRecords: allScopedItems,
      companyRecords: useRemoteCompany ? undefined : items,
      companyMetrics: useRemoteCompany ? remoteCompanyMetrics : null,
      visits: scopedVisits,
      productNames,
      focusNames,
      actions: actionItems,
      trend: trendSnap,
      quality: periodQuality,
      period: reportPeriod,
      settings,
      ticketRecords,
      statusTrends,
      nowMonth: endMonth,
    })
  }, [
    reportPeriod,
    isV2,
    scopedItems,
    allScopedItems,
    items,
    scopedVisits,
    productNames,
    focusNames,
    actionItems,
    trendSnap,
    periodQuality,
    settings,
    ticketRecords,
    statusTrends,
    endMonth,
    useRemoteCompany,
    remoteCompanyMetrics,
  ])

  const ratingsPending = !savedV2Snapshot &&
    postUseRatingOnDemand &&
    loadMonthIds.some((periodId) => !postUseSettledPeriodIds.includes(periodId))

  // The two report versions have distinct document models and separate render branches.
  const model = /** @type {any} */ (useMemo(() => {
    if (!reportKey || !storageReady || sideLoading || loadedReportKey !== reportKey) return null
    if (savedV2Snapshot) return overlay.snapshot
    if (ratingsPending || (isV2 && !statusTrendsReady)) return null
    if (isV2) return buildPostUseReportV2Model({
      reportKey, reportKind, reportPeriod,
      records: scopedItems,
      companyRecords: items,
      allRecords: allScopedItems,
      allCompanyRecords: (feedbacks || []).filter((record) => record.dataSourceType === 'post_use_rating'),
      visits, traces, issueLinks, actionItems, statusTrends, overlay,
    })
    if (!storyModel) return null
    const legacyModel = buildHtmlMonthlyReportModel({
      reportMonth: reportKey,
      reportPeriod,
      storyModel,
      records: scopedItems,
      allRecords: allScopedItems,
      productNames,
      visits,
      traces,
      issueLinks,
      generatedDrafts,
      actionItems,
      reasons: monthReasons,
      quality: periodQuality,
      learnings,
      overlay,
      statusTrends,
      trend: trendSnap,
    })
    return legacyModel
  }, [reportKey, reportKind, reportPeriod, storyModel, storageReady, ratingsPending, sideLoading, loadedReportKey, scopedItems, items, allScopedItems, feedbacks, productNames, visits, traces, issueLinks, generatedDrafts, actionItems, monthReasons, periodQuality, learnings, overlay, statusTrends, statusTrendsReady, trendSnap, isV2, savedV2Snapshot]))

  useEffect(() => {
    if (!model) return
    setJudgment(model.judgment)
    setTodoNote(model.todoNote)
    setTodoItems(isV2 ? overlay?.narratives?.todoItems || model.todoRows || [] : model.todoItems || [])
    setHiddenSectionIds(isV2 ? overlay?.hiddenSectionIds || model.hiddenSectionIds || [] : model.hiddenSectionIds || [])
    setIssueNarratives(isV2
      ? Object.fromEntries(model.products.map((product) => [
        `product:${product.name}`,
        overlay?.narratives?.issues?.[`product:${product.name}`] || { conclusion: '', action: '' },
      ]))
      : initialReportIssueNarratives(model))
    setActionOverrides(isV2 ? overlay?.narratives?.actionOverrides || {} : {})
    setManualIssueFields({})
    manualIssueFieldsRef.current = {}
    setVisitSupplements(
      Object.fromEntries(
        (model.previousVisits || []).map((row) => [
          row.id,
          {
            visitResult: row.visitResult || '',
            internalConclusion: row.internalConclusion || '',
            remark: row.remark || '',
          },
        ]),
      ),
    )
  }, [model?.dataFingerprint, overlay?.updatedAt, isV2])

  useEffect(() => {
    if (isV2 || !model || !reportKey || !canEdit || !autoEvidenceReady || !isLlmAvailable(settings)) {
      if (autoDraftRunRef.current) autoDraftRunRef.current.cancelled = true
      autoDraftRunRef.current = null
      setAutoDraftStatus((prev) => prev.phase === 'running' ? { reportKey: '', phase: 'idle', completed: 0, total: 0, failures: [] } : prev)
      return
    }
    const key = `${reportKey}\0${model.productCards.map((card) => `${card.productName}:${card.evidenceFingerprint}`).join('\0')}`
    if (autoDraftRunRef.current?.key === key) return
    if (autoDraftRunRef.current) autoDraftRunRef.current.cancelled = true
    const run = { key, cancelled: false }
    autoDraftRunRef.current = run
    const isCurrent = () => autoDraftRunRef.current === run && !run.cancelled

    void runReportDraftQueue({
      cards: model.productCards,
      savedDrafts: generatedDrafts,
      reportKey,
      settings,
      generate: generateReportProductDraft,
      save: saveReportDraft,
      isCurrent,
      onSaved: (card, item) => {
        setGeneratedDrafts((prev) => [...prev.filter((row) => row.productName !== card.productName), item])
        setIssueNarratives((prev) => {
          const manual = overlayRef.current?.narratives?.issues?.[card.conclusionKey]
          const edited = manualIssueFieldsRef.current[card.conclusionKey]
          return mergeGeneratedReportDraft(prev, card.conclusionKey, item, manual, edited)
        })
      },
      onProgress: ({ completed, total, failures }) => {
        if (isCurrent()) setAutoDraftStatus({ reportKey, phase: completed === total ? 'done' : 'running', completed, total, failures })
      },
    }).catch(() => {
      if (isCurrent()) setAutoDraftStatus({ reportKey, phase: 'done', completed: 0, total: 0, failures: [{ productName: '报告', message: '生成队列失败' }] })
    })
  }, [model, reportKey, canEdit, autoEvidenceReady, settings, generatedDrafts, isV2])

  useEffect(() => () => {
    if (autoDraftRunRef.current) autoDraftRunRef.current.cancelled = true
  }, [])

  const loading = !storageReady || sideLoading || ratingsPending || (isV2 && !statusTrendsReady)
    || (Boolean(reportKey) && loadedReportKey !== reportKey)

  const onIssueChange = (key, field, value) => {
    const editedFields = {
      ...manualIssueFieldsRef.current,
      [key]: { ...(manualIssueFieldsRef.current[key] || {}), [field]: true },
    }
    manualIssueFieldsRef.current = editedFields
    setManualIssueFields(editedFields)
    setIssueNarratives((prev) => ({
      ...prev,
      [key]: {
        conclusion: prev[key]?.conclusion || '',
        action: prev[key]?.action || '',
        [field]: value,
      },
    }))
  }

  const onActionChange = (key, field, value) => {
    setActionOverrides((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [field]: value },
    }))
  }

  const v2Validation = isV2 && model ? validatePostUseReportV2(model, actionOverrides) : []

  const onVisitSupplementChange = (id, field, value) => {
    setVisitSupplements((prev) => ({
      ...prev,
      [id]: {
        visitResult: prev[id]?.visitResult || '',
        internalConclusion: prev[id]?.internalConclusion || '',
        remark: prev[id]?.remark || '',
        [field]: value,
      },
    }))
  }

  const onToggleSection = (sectionId, visible) => {
    setHiddenSectionIds((prev) => {
      const next = new Set(prev)
      if (visible) next.delete(sectionId)
      else next.add(sectionId)
      return [...next]
    })
  }

  const handleGenerateV2Narrative = async () => {
    if (!isV2 || !model || !canEdit) return
    const requestedKey = reportKey
    setNarrativeGenerating(true)
    try {
      const draft = await generatePostUseReportV2Narrative(settings, model)
      if (activeReportRef.current !== requestedKey) return
      setIssueNarratives((prev) => ({
        ...prev,
        ...Object.fromEntries(Object.entries(draft.products).map(([key, conclusion]) => [key, {
          ...(prev[key] || {}), conclusion,
        }])),
      }))
      setActionOverrides((prev) => ({
        ...prev,
        ...Object.fromEntries(Object.entries(draft.focus).map(([key, value]) => [key, {
          ...(prev[key] || {}), ...value,
        }])),
      }))
      // 待办自动行（11-18）：LLM 逐条推导 content；失败条目回退规则模板 fallbackContent。
      // 只按候选 id 命中——index 越界/被丢弃的条目天然走回退；人工行不在此合成（编辑态手动加）。
      if (model.todoCandidates?.length) {
        const manualRows = todoItems.filter((row) => row.source === 'manual' || (!row.source && !String(row.id || '').startsWith('todo-')))
        setTodoItems([
          ...model.todoCandidates.map((candidate) => ({
            id: candidate.id,
            productName: candidate.productName,
            content: draft.todos?.[candidate.id] || candidate.fallbackContent,
            owner: candidate.owner || '',
            team: candidate.team || '',
            status: candidate.status || '',
            source: 'auto',
          })),
          ...manualRows,
        ])
      }
      // 语义归类覆盖表（11-18）：LLM 把未命中正则的低分标签归入封闭组；合入 overlay 触发模型重算，
      // 部门表/分产品表立即按归类结果聚合；保存时随 narratives.themeGroupLabels 落库。
      if (draft.themeGroupLabels && Object.keys(draft.themeGroupLabels).length) {
        setOverlay((prev) => ({
          ...(prev || {}),
          narratives: { ...(prev?.narratives || {}), themeGroupLabels: {
            ...(prev?.narratives?.themeGroupLabels || {}),
            ...draft.themeGroupLabels,
          } },
        }))
      }
      message.success('报告文案草稿已生成，请复核后保存')
    } catch (error) {
      message.error(error?.message || '报告文案生成失败')
    } finally {
      setNarrativeGenerating(false)
    }
  }

  const handleSave = async () => {
    if (!canEdit || !model) return
    if (isV2 && v2Validation.length) {
      message.error(`保存前请处理 ${v2Validation.length} 项校验差异`)
      return
    }
    setSaving(true)
    try {
      const saved = await saveHtmlReportOverlay(adapter, {
        month: reportKey,
        updatedBy: user?.username || user?.id || '',
        dataFingerprint: model.dataFingerprint,
        ...(isV2 ? { snapshot: { ...model, todoRows: todoItems, hiddenSectionIds } } : {}),
        hiddenSectionIds,
        narratives: {
          judgment,
          issues: isV2 ? issueNarratives : mergeManualReportIssueNarratives(
            overlay?.narratives?.issues, issueNarratives, manualIssueFields,
          ),
          todoNote,
          todoItems,
          ...(isV2 ? { actionOverrides } : {}),
          ...(isV2 ? { themeGroupLabels: overlay?.narratives?.themeGroupLabels || {} } : {}),
          visitSupplements,
        },
      }, version)
      setOverlay(saved)
      if (isV2) setRegeneratingKey('')
      message.success(isV2 ? '已保存本期报告，其他用户打开将直接显示此版本' : reportKind === 'quarter' ? '已保存本季叙述' : '已保存本月叙述')
    } catch (error) {
      message.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const buildOfflineHtml = () => {
    if (!model) return ''
    if (isV2) {
      const content = renderToStaticMarkup(
        <PostUseHtmlReportV2Document
          model={model}
          printAll
          issueNarratives={issueNarratives}
          actionOverrides={actionOverrides}
          todoItems={todoItems}
          hiddenSectionIds={hiddenSectionIds}
        />,
      )
      return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${model.title}</title><style>${REPORT_SHARED_CSS}\n${REPORT_V2_CSS}</style></head><body><div class="post-use-html-report"><div class="post-use-html-report-sheet">${content}</div></div></body></html>`
    }
    return buildOfflineMonthlyReportHtml({
      model,
      judgment,
      todoNote,
      todoItems,
      issueNarratives,
      visitSupplements,
      hiddenSectionIds,
      keyCustomers: settings?.postUseKeyCustomers,
      exportedAt: new Date().toISOString(),
    })
  }

  const handleExportOfflineHtml = () => {
    if (!model) return
    if (isV2 && v2Validation.length) {
      message.error(`导出前请处理 ${v2Validation.length} 项校验差异`)
      return
    }
    setExporting(true)
    try {
      const html = buildOfflineHtml()
      downloadOfflineMonthlyReportHtml(html, offlineMonthlyReportFilename(reportKey, isV2 ? `用后即评${reportKind === 'quarter' ? '季报' : '月报'}-新版` : model.copy?.filenamePrefix))
      message.success('已导出离线 HTML，可用浏览器直接打开')
    } catch (error) {
      message.error(error?.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  let body = null
  if (!route) {
    body = (
      <Alert
        type="error"
        showIcon
        message="报告周期无效"
        description="请使用 YYYY-MM 或 YYYY-Qq，例如 2026-06、2026-Q2。"
      />
    )
  } else if (sideLoadError?.reportKey === reportKey) {
    body = <Alert type="error" showIcon message="报告证据加载失败" description={sideLoadError.message} />
  } else if (loading) {
    body = (
      <div className="flex justify-center py-24">
        <Spin size="large" tip={reportKind === 'quarter' ? '正在加载季报…' : '正在加载月报…'} />
      </div>
    )
  } else if (isV2 ? !model?.kpis?.totalSample : !storyModel?.scoredRows?.length) {
    body = (
      <Alert
        type="warning"
        showIcon
        message={`${reportKey} 没有有效评分`}
        description={reportKind === 'quarter' ? '当季无评分时不生成空稿。请返回工作台确认数据范围与产品目录。' : '当月无评分时不生成空稿。请返回工作台确认数据范围与产品目录。'}
      />
    )
  } else if (model) {
    body = isV2 ? (
      <PostUseHtmlReportV2Document
        model={model}
        canEdit={canEdit}
        issueNarratives={issueNarratives}
        onIssueChange={onIssueChange}
        actionOverrides={actionOverrides}
        onActionChange={onActionChange}
        todoItems={todoItems}
        hiddenSectionIds={hiddenSectionIds}
        onTodoItemsChange={setTodoItems}
        keyCustomers={settings?.postUseKeyCustomers}
      />
    ) : (
      <PostUseHtmlReportDocument
        model={model}
        canEdit={canEdit}
        judgment={judgment}
        todoNote={todoNote}
        todoItems={todoItems}
        issueNarratives={issueNarratives}
        visitSupplements={visitSupplements}
        hiddenSectionIds={hiddenSectionIds}
        onJudgmentChange={setJudgment}
        onTodoNoteChange={setTodoNote}
        onTodoItemsChange={setTodoItems}
        onIssueChange={onIssueChange}
        onVisitSupplementChange={onVisitSupplementChange}
        keyCustomers={settings?.postUseKeyCustomers}
      />
    )
  }

  const showEvidenceWarning = Boolean(!isV2 && model && canEdit && !autoEvidenceReady)
  const showDraftProgress = autoDraftStatus.reportKey === reportKey && autoDraftStatus.phase === 'running'
  const showDraftFailures = autoDraftStatus.reportKey === reportKey && autoDraftStatus.phase === 'done' && autoDraftStatus.failures.length > 0

  return (
    <div className="post-use-html-report">
      <style>{isV2 ? `${REPORT_SHARED_CSS}\n${REPORT_V2_CSS}` : REPORT_SHARED_CSS}</style>
      <header className="post-use-html-report-toolbar">
        <Space wrap>
          <Link to={WORKBENCH_HREF}>返回工作台</Link>
          <Typography.Text strong>{reportKind === 'quarter' ? '用后即评季报' : '用后即评月报'} {reportKey || month || ''}</Typography.Text>
          {route ? <Link to={isV2 ? `/workbench/post-use-report/${reportKey}` : `/workbench/post-use-report-v2/${reportKey}`}>
            {isV2 ? '查看旧版' : '查看新版'}
          </Link> : null}
        </Space>
        <Space wrap>
          {model ? (
            <ReportSectionToggles
              hiddenSectionIds={hiddenSectionIds}
              showPreviousVisits={isV2 ? reportKind === 'month' : model.showPreviousVisits !== false}
              onToggleSection={onToggleSection}
            />
          ) : null}
          {isV2 && model && overlay?.snapshot && !regenerating && canEdit ? (
            <Button onClick={() => { setLoadedReportKey(''); setRegeneratingKey(reportKey) }}>
              重新生成草稿
            </Button>
          ) : null}
          {isV2 && model && (!overlay?.snapshot || regenerating) && canEdit ? (
            <Button disabled={!isLlmAvailable(settings)} loading={narrativeGenerating} onClick={() => void handleGenerateV2Narrative()}>
              生成报告文案
            </Button>
          ) : null}
          {isV2 && model ? <Typography.Text type="secondary" className="text-xs">
            {overlay?.snapshot && !regenerating ? `已保存 · ${overlay.updatedAt || ''}` : '未保存草稿 · 请复核后保存'}
          </Typography.Text> : null}
          <Button disabled={!canEdit || !model} loading={saving} type="primary" onClick={() => void handleSave()}>
            保存
          </Button>
          <Button disabled={!model || (isV2 && v2Validation.length > 0)} loading={exporting} onClick={handleExportOfflineHtml}>
            导出离线 HTML
          </Button>
          <Button
            disabled={!canEdit || !model}
            icon={<MailOutlined />}
            onClick={() => setMailOpen(true)}
          >
            发送邮件
          </Button>
        </Space>
      </header>
      <SendMailModal
        open={mailOpen}
        onClose={() => setMailOpen(false)}
        defaultTemplateId={MAIL_PRESET_REPORT}
        dataSourceType="post_use_rating"
        periodLabel={isV2 ? reportPeriod?.label || reportKey : storyModel?.scope?.periodLabel || reportKey}
        reportKey={reportKey}
        reportKind={reportKind === 'quarter' ? 'quarter' : 'month'}
        reportVersion={version}
        linkKind="report"
        canSend={canEdit && Boolean(model) && (!isV2 || v2Validation.length === 0)}
        buildAttachment={async () => {
          if (!model) return null
          const html = buildOfflineHtml()
          return {
            filename: offlineMonthlyReportFilename(reportKey, isV2 ? `用后即评${reportKind === 'quarter' ? '季报' : '月报'}-新版` : model.copy?.filenamePrefix),
            mime: 'text/html;charset=utf-8',
            contentBase64: textToBase64(html),
          }
        }}
      />
      {showEvidenceWarning || showDraftProgress || showDraftFailures ? (
        <div className="post-use-html-report-status no-print">
          {showEvidenceWarning ? (
            <Alert
              type="warning"
              showIcon
              message="部分报告证据读取失败，已暂停自动文字生成"
              description="当前显示规则稿或已保存稿；请刷新报告重试。"
            />
          ) : null}
          {showDraftProgress ? (
            <Alert
              type="info"
              showIcon
              message={`正在生成产品文字稿（${autoDraftStatus.completed}/${autoDraftStatus.total}）`}
              description="报告可继续查看，完成的产品会逐个更新。"
            />
          ) : null}
          {showDraftFailures ? (
            <Alert
              type="warning"
              showIcon
              message={`${autoDraftStatus.failures.length} 个产品的文字稿生成失败，当前显示规则稿`}
              description={`涉及产品：${autoDraftStatus.failures.map((item) => item.productName).join('、')}。重新打开报告时会再次尝试。`}
            />
          ) : null}
        </div>
      ) : null}
      {isV2 && model && v2Validation.length ? <div className="post-use-html-report-status no-print">
        <Alert type="warning" showIcon message="新版报告导出校验待处理" description={v2Validation.join('；')} />
      </div> : null}
      <div className="post-use-html-report-sheet">
        {body}
      </div>
    </div>
  )
}
