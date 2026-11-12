import { useEffect, useMemo, useRef, useState } from 'react'
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
import { clipDepartmentStatusTrends, normalizeDepartmentStatusTrends } from '../lib/postUseRating/statusTrends.js'
import { buildHtmlMonthlyReportModel } from '../lib/postUseRating/htmlReportModel.js'
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

export default function PostUseHtmlReport() {
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
  const [manualIssueFields, setManualIssueFields] = useState({})
  const [visitSupplements, setVisitSupplements] = useState({})
  const [statusTrends, setStatusTrends] = useState(null)
  const [hiddenSectionIds, setHiddenSectionIds] = useState([])
  const [mailOpen, setMailOpen] = useState(false)
  overlayRef.current = overlay

  const route = useMemo(() => resolveReportRoute(month), [month])
  const reportKey = route?.key || ''
  const reportKind = route?.kind || ''
  const reportPeriod = route?.period || null
  const loadMonthIds = useMemo(() => {
    if (!reportPeriod) return []
    const months = new Set(postUsePeriodMonths(reportPeriod))
    const previous = resolvePreviousInsightPeriod(reportPeriod)
    for (const item of postUsePeriodMonths(previous)) months.add(item)
    return [...months].map((item) => `period:month:${item}`)
  }, [reportPeriod])

  useEffect(() => {
    if (!storageReady || !loadMonthIds.length) return undefined
    for (const periodId of loadMonthIds) void loadPostUseRatingForPeriod(periodId)
    return undefined
  }, [storageReady, loadMonthIds, loadPostUseRatingForPeriod, postUseCacheGeneration])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!adapter || !reportKey) {
        setSideLoading(false)
        return
      }
      setSideLoading(true)
      setSideLoadError(null)
      setAutoEvidenceReady(false)
      try {
        let completeForAi = true
        const requiredForAi = (promise, fallback) => promise.catch(() => {
          completeForAi = false
          return fallback
        })
        const [v, actionsRes, trend, qualityStore, overlaySnap, learningSnap, traceRows, links, drafts] = await Promise.all([
          loadVisitRecords(adapter),
          requiredForAi(listActionItems({ linkedDataSources: 'post_use_rating', limit: 500 }), { items: [] }),
          loadPostUseTrend(adapter).catch(() => null),
          loadPostUsePeriodQuality(adapter).catch(() => null),
          requiredForAi(loadHtmlReportOverlay(adapter, reportKey), null),
          loadMonthlyReportLearnings(adapter).catch(() => []),
          requiredForAi(listAllPostUseJiraItems(), []),
          requiredForAi(listReportIssueLinks(), []),
          requiredForAi(listReportDrafts(reportKey), []),
        ])
        if (!cancelled) {
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
  }, [adapter, reportKey])

  const endMonth = useMemo(
    () => (reportPeriod ? postUsePeriodMonths(reportPeriod).at(-1) || '' : ''),
    [reportPeriod],
  )

  useEffect(() => {
    if (!adapter || typeof adapter.listPostUseStatusTrends !== 'function' || !endMonth) {
      setStatusTrends(null)
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        const trends = clipDepartmentStatusTrends(
          normalizeDepartmentStatusTrends(await adapter.listPostUseStatusTrends()),
          endMonth,
        )
        if (!cancelled) setStatusTrends(trends)
      } catch {
        if (!cancelled) setStatusTrends(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, endMonth])

  const catalog = useMemo(() => getCatalogProducts(), [feedbacks, productCatalogMeta])
  const productNames = useMemo(() => getPostUseRatingProductNames(catalog), [catalog])
  const focusNames = useMemo(() => getPostUseFocusTrackedNames(catalog), [catalog])
  const items = useMemo(
    () => (reportPeriod ? filterRecordsForScope(feedbacks, reportPeriod, 'post_use_rating') : []),
    [feedbacks, reportPeriod],
  )
  const scopedItems = useMemo(() => scopePostUseRatingRecords(items, catalog), [items, catalog])
  const ticketRecords = useMemo(
    () =>
      (feedbacks || []).filter(
        (record) =>
          record.dataSourceType === 'complaint_ticket' ||
          record.dataSourceType === 'consultation_ticket',
      ),
    [feedbacks],
  )
  const scopedVisits = useMemo(() => {
    const months = new Set(postUseVisitMonthsForPeriod(reportPeriod))
    return scopePostUseRatingRecords(
      visits.filter((visit) => months.has(visit.importMonth || visit.visitMonth)),
      catalog,
    )
  }, [visits, reportPeriod, catalog])
  const allScopedItems = useMemo(
    () => scopePostUseRatingRecords(
      (feedbacks || []).filter((record) => record.dataSourceType === 'post_use_rating'),
      catalog,
    ),
    [feedbacks, catalog],
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

  const storyModel = useMemo(() => {
    if (!reportPeriod) return null
    return buildPostUseStoryModel({
      records: scopedItems,
      allRecords: allScopedItems,
      companyRecords: items,
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
  ])

  const ratingsPending =
    postUseRatingOnDemand &&
    loadMonthIds.some((periodId) => !postUseSettledPeriodIds.includes(periodId))

  const model = useMemo(() => {
    if (!reportKey || !storyModel || !storageReady || ratingsPending || sideLoading || loadedReportKey !== reportKey) return null
    return buildHtmlMonthlyReportModel({
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
  }, [reportKey, reportPeriod, storyModel, storageReady, ratingsPending, sideLoading, loadedReportKey, scopedItems, allScopedItems, productNames, visits, traces, issueLinks, generatedDrafts, actionItems, monthReasons, periodQuality, learnings, overlay, statusTrends, trendSnap])

  useEffect(() => {
    if (!model) return
    setJudgment(model.judgment)
    setTodoNote(model.todoNote)
    setTodoItems(model.todoItems || [])
    setHiddenSectionIds(model.hiddenSectionIds || [])
    setIssueNarratives(initialReportIssueNarratives(model))
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
  }, [model?.dataFingerprint, overlay?.updatedAt])

  useEffect(() => {
    if (!model || !reportKey || !canEdit || !autoEvidenceReady || !isLlmAvailable(settings)) {
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
  }, [model, reportKey, canEdit, autoEvidenceReady, settings, generatedDrafts])

  useEffect(() => () => {
    if (autoDraftRunRef.current) autoDraftRunRef.current.cancelled = true
  }, [])

  const loading = !storageReady || sideLoading || ratingsPending
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

  const handleSave = async () => {
    if (!canEdit || !model) return
    setSaving(true)
    try {
      const saved = await saveHtmlReportOverlay(adapter, {
        month: reportKey,
        updatedBy: user?.username || user?.id || '',
        dataFingerprint: model.dataFingerprint,
        hiddenSectionIds,
        narratives: {
          judgment,
          issues: mergeManualReportIssueNarratives(
            overlay?.narratives?.issues,
            issueNarratives,
            manualIssueFields,
          ),
          todoNote,
          todoItems,
          visitSupplements,
        },
      })
      setOverlay(saved)
      message.success(reportKind === 'quarter' ? '已保存本季叙述' : '已保存本月叙述')
    } catch (error) {
      message.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const buildOfflineHtml = () => {
    if (!model) return ''
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
    setExporting(true)
    try {
      const html = buildOfflineHtml()
      downloadOfflineMonthlyReportHtml(html, offlineMonthlyReportFilename(reportKey, model.copy?.filenamePrefix))
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
  } else if (!storyModel?.scoredRows?.length) {
    body = (
      <Alert
        type="warning"
        showIcon
        message={`${reportKey} 没有有效评分`}
        description={reportKind === 'quarter' ? '当季无评分时不生成空稿。请返回工作台确认数据范围与产品目录。' : '当月无评分时不生成空稿。请返回工作台确认数据范围与产品目录。'}
      />
    )
  } else if (model) {
    body = (
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

  const showEvidenceWarning = Boolean(model && canEdit && !autoEvidenceReady)
  const showDraftProgress = autoDraftStatus.reportKey === reportKey && autoDraftStatus.phase === 'running'
  const showDraftFailures = autoDraftStatus.reportKey === reportKey && autoDraftStatus.phase === 'done' && autoDraftStatus.failures.length > 0

  return (
    <div className="post-use-html-report">
      <style>{REPORT_SHARED_CSS}</style>
      <header className="post-use-html-report-toolbar">
        <Space wrap>
          <Link to={WORKBENCH_HREF}>返回工作台</Link>
          <Typography.Text strong>{reportKind === 'quarter' ? '用后即评季报' : '用后即评月报'} {reportKey || month || ''}</Typography.Text>
        </Space>
        <Space wrap>
          {model ? (
            <ReportSectionToggles
              hiddenSectionIds={hiddenSectionIds}
              showPreviousVisits={model.showPreviousVisits !== false}
              onToggleSection={onToggleSection}
            />
          ) : null}
          <Button disabled={!canEdit || !model} loading={saving} type="primary" onClick={() => void handleSave()}>
            保存
          </Button>
          <Button disabled={!model} loading={exporting} onClick={handleExportOfflineHtml}>
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
        periodLabel={storyModel?.scope?.periodLabel || reportKey}
        reportKey={reportKey}
        reportKind={reportKind === 'quarter' ? 'quarter' : 'month'}
        linkKind="report"
        canSend={canEdit && Boolean(model)}
        buildAttachment={async () => {
          if (!model) return null
          const html = buildOfflineHtml()
          return {
            filename: offlineMonthlyReportFilename(reportKey, model.copy?.filenamePrefix),
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
      <div className="post-use-html-report-sheet">
        {body}
      </div>
    </div>
  )
}
