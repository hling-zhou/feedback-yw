import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Button, Space, Spin, Typography, message } from 'antd'
import { useAuth } from '../context/AuthContext.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { SCHEMA_VERSION } from '../domain/constants.js'
import { resolveInsightPeriod } from '../domain/insightPeriod.js'
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
import { postUseVisitMonthsForPeriod } from '../lib/postUseRating/periodScope.js'
import { buildPostUseStoryModel } from '../lib/postUseRating/storyModel.js'
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
const WORKBENCH_HREF = '/workbench?tab=post_use_rating'

export default function PostUseHtmlReport() {
  const { month } = useParams()
  const { can, user } = useAuth()
  const canEdit = can('editRecord')
  const { feedbacks, adapter, settings, storageReady, feedbacksLoading } = useInsights()
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
  const [hiddenSectionIds, setHiddenSectionIds] = useState([])
  const [printAppendix, setPrintAppendix] = useState(false)

  const reportMonth = MONTH_RE.test(month || '') ? month : ''
  const reportPeriod = useMemo(
    () => (reportMonth ? resolveInsightPeriod(`period:month:${reportMonth}`, null, SCHEMA_VERSION) : null),
    [reportMonth],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!adapter || !reportMonth) {
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
          loadHtmlReportOverlay(adapter, reportMonth).catch(() => null),
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
  }, [adapter, reportMonth, feedbacks])

  const catalog = useMemo(() => getCatalogProducts(), [feedbacks])
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
  const monthReasons = useMemo(() => {
    if (!trendSnap || !reportMonth) return []
    return (trendSnap.reasons || [])
      .filter((row) => row.month === reportMonth)
      .map((row) => ({
        reason: row.reason,
        count: row.count,
        ...(row.channel != null && row.channel !== '' ? { channel: row.channel } : {}),
      }))
      .sort((a, b) => b.count - a.count)
  }, [trendSnap, reportMonth])
  const periodQuality = quality?.periods?.[reportMonth] || null

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
  ])

  const model = useMemo(() => {
    if (!reportMonth || !storyModel) return null
    return buildHtmlMonthlyReportModel({
      reportMonth,
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
    })
  }, [reportMonth, storyModel, scopedItems, allScopedItems, productNames, visits, actionItems, monthReasons, periodQuality, learnings, overlay])

  useEffect(() => {
    if (!model) return
    setJudgment(model.judgment)
    setTodoNote(model.todoNote)
    setHiddenSectionIds(model.hiddenSectionIds || [])
    setPrintAppendix(Boolean(model.printAppendix))
    setIssueNarratives(
      Object.fromEntries(
        (model.issues || []).map((issue) => [
          issue.key,
          { conclusion: issue.conclusion, action: issue.action },
        ]),
      ),
    )
  }, [model?.dataFingerprint, overlay?.updatedAt])

  const loading = !storageReady || feedbacksLoading || sideLoading

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
        month: reportMonth,
        updatedBy: user?.username || user?.id || '',
        dataFingerprint: model.dataFingerprint,
        hiddenSectionIds,
        printAppendix,
        narratives: {
          judgment,
          issues: issueNarratives,
          todoNote,
        },
      })
      setOverlay(saved)
      message.success('已保存本月叙述')
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
        hiddenSectionIds,
        exportedAt: new Date().toISOString(),
      })
      downloadOfflineMonthlyReportHtml(html, offlineMonthlyReportFilename(reportMonth))
      message.success('已导出离线 HTML，可用浏览器直接打开')
    } catch (error) {
      message.error(error?.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  let body = null
  if (!reportMonth) {
    body = (
      <Alert
        type="error"
        showIcon
        message="月份格式无效"
        description="请使用 YYYY-MM，例如 2026-06。"
      />
    )
  } else if (loading) {
    body = (
      <div className="flex justify-center py-24">
        <Spin size="large" tip="正在加载月报…" />
      </div>
    )
  } else if (!storyModel?.scoredRows?.length) {
    body = (
      <Alert
        type="warning"
        showIcon
        message={`${reportMonth} 没有有效评分`}
        description="当月无评分时不生成空稿。请返回工作台确认数据范围与产品目录。"
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
        hiddenSectionIds={hiddenSectionIds}
        onJudgmentChange={setJudgment}
        onTodoNoteChange={setTodoNote}
        onIssueChange={onIssueChange}
      />
    )
  }

  return (
    <div className="post-use-html-report">
      <header className="post-use-html-report-toolbar">
        <Space wrap>
          <Link to={WORKBENCH_HREF}>返回工作台</Link>
          <Typography.Text strong>用后即评月报 {reportMonth || month || ''}</Typography.Text>
        </Space>
        <Space wrap>
          {model ? (
            <ReportSectionToggles
              hiddenSectionIds={hiddenSectionIds}
              printAppendix={printAppendix}
              onToggleSection={onToggleSection}
              onPrintAppendixChange={setPrintAppendix}
            />
          ) : null}
          <Button disabled={!canEdit || !model} loading={saving} type="primary" onClick={() => void handleSave()}>
            保存
          </Button>
          <Button disabled={!model} loading={exporting} onClick={handleExportOfflineHtml}>
            导出离线 HTML
          </Button>
          <Button onClick={() => window.print()}>打印</Button>
        </Space>
      </header>
      <div className={`post-use-html-report-sheet${printAppendix ? '' : ' hide-appendix-print'}`}>
        {body}
      </div>
    </div>
  )
}
