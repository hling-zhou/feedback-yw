import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Button, Space, Spin, Typography, message } from 'antd'
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
import './PostUseHtmlReport.css'

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
  const [actionItems, setActionItems] = useState([])
  const [trendSnap, setTrendSnap] = useState(null)
  const [quality, setQuality] = useState(null)
  const [learnings, setLearnings] = useState([])
  const [overlay, setOverlay] = useState(null)
  const [sideLoading, setSideLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [judgment, setJudgment] = useState('')
  const [todoNote, setTodoNote] = useState('')
  const [issueNarratives, setIssueNarratives] = useState({})
  const [visitSupplements, setVisitSupplements] = useState({})
  const [statusTrends, setStatusTrends] = useState(null)
  const [hiddenSectionIds, setHiddenSectionIds] = useState([])

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
      try {
        const [v, actionsRes, trend, qualityStore, overlaySnap, learningSnap] = await Promise.all([
          loadVisitRecords(adapter),
          listActionItems({ linkedDataSources: 'post_use_rating', limit: 500 }).catch(() => ({ items: [] })),
          loadPostUseTrend(adapter).catch(() => null),
          loadPostUsePeriodQuality(adapter).catch(() => null),
          loadHtmlReportOverlay(adapter, reportKey).catch(() => null),
          loadMonthlyReportLearnings(adapter).catch(() => []),
        ])
        if (!cancelled) {
          setVisits(v)
          setActionItems(actionsRes?.items || [])
          setTrendSnap(trend)
          setQuality(qualityStore)
          setOverlay(overlaySnap)
          setLearnings(learningSnap)
        }
      } catch {
        if (!cancelled) setOverlay(null)
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

  const model = useMemo(() => {
    if (!reportKey || !storyModel) return null
    return buildHtmlMonthlyReportModel({
      reportMonth: reportKey,
      reportPeriod,
      storyModel,
      records: scopedItems,
      allRecords: allScopedItems,
      productNames,
      visits,
      actionItems,
      reasons: monthReasons,
      quality: periodQuality,
      learnings,
      overlay,
      statusTrends,
      trend: trendSnap,
    })
  }, [reportKey, reportPeriod, storyModel, scopedItems, allScopedItems, productNames, visits, actionItems, monthReasons, periodQuality, learnings, overlay, statusTrends, trendSnap])

  useEffect(() => {
    if (!model) return
    setJudgment(model.judgment)
    setTodoNote(model.todoNote)
    setHiddenSectionIds(model.hiddenSectionIds || [])
    setIssueNarratives(
      Object.fromEntries(
        (model.issues || []).map((issue) => [
          issue.key,
          { conclusion: issue.conclusion, action: issue.action },
        ]),
      ),
    )
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

  const ratingsPending =
    postUseRatingOnDemand &&
    loadMonthIds.some((periodId) => !postUseSettledPeriodIds.includes(periodId))
  const loading = !storageReady || sideLoading || ratingsPending

  const onIssueChange = (key, field, value) => {
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
          issues: issueNarratives,
          todoNote,
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

  const handleExportOfflineHtml = () => {
    if (!model) return
    setExporting(true)
    try {
      const html = buildOfflineMonthlyReportHtml({
        model,
        judgment,
        todoNote,
        issueNarratives,
        visitSupplements,
        hiddenSectionIds,
        exportedAt: new Date().toISOString(),
      })
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
        issueNarratives={issueNarratives}
        visitSupplements={visitSupplements}
        hiddenSectionIds={hiddenSectionIds}
        onJudgmentChange={setJudgment}
        onTodoNoteChange={setTodoNote}
        onIssueChange={onIssueChange}
        onVisitSupplementChange={onVisitSupplementChange}
      />
    )
  }

  return (
    <div className="post-use-html-report">
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
        </Space>
      </header>
      <div className="post-use-html-report-sheet">
        {body}
      </div>
    </div>
  )
}
