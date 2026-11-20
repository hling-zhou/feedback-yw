import { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Link, useParams } from 'react-router-dom'
import { Alert, Button, Checkbox, Space, Spin, Typography, message } from 'antd'
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
import { listReportIssueLinks } from '../lib/postUseRating/reportClient.js'
import { loadVisitRecords } from '../lib/postUseRating/visitRecords.js'
import { postUsePeriodMonths, postUseVisitMonthsForPeriod } from '../lib/postUseRating/periodScope.js'
import { clipDepartmentStatusTrends, normalizeDepartmentStatusTrends, rollupCompanyMetrics } from '../lib/postUseRating/statusTrends.js'
import { buildPostUseReportV2Model, validatePostUseReportV2 } from '../lib/postUseRating/reportV2Model.js'
import { catalogProductNames } from '../lib/postUseRating/reportEvidence.js'
import { REPORT_SECTION_APPENDIX, REPORT_SECTION_PREVIOUS_VISITS, REPORT_SECTION_PRODUCTS, REPORT_SECTION_TODO } from '../lib/postUseRating/htmlReportModel.js'
import { REPORT_V2_CSS } from '../lib/postUseRating/reportV2Styles.js'
import { generatePostUseReportV2Narrative } from '../lib/postUseRating/reportV2Narrative.js'
import { loadHtmlReportOverlay, saveHtmlReportOverlay } from '../lib/postUseRating/htmlReportOverlay.js'
// 11-20 拍板：旧版报告彻底下线——页面收敛为 V2 单形态（原 V1 分支/legacyModel/学习笔记全删）
import { downloadOfflineMonthlyReportHtml, offlineMonthlyReportFilename } from '../lib/postUseRating/htmlReportOffline.js'
import PostUseHtmlReportV2Document from '../components/workbench/PostUseHtmlReportV2Document.jsx'
import SendMailModal from '../components/mail/SendMailModal.jsx'
import { MAIL_PRESET_REPORT } from '../domain/mail.js'
import { textToBase64 } from '../lib/mailClient.js'
import './PostUseHtmlReport.css'
import { REPORT_SHARED_CSS } from '../lib/postUseRating/reportSharedStyles.js'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const QUARTER_RE = /^\d{4}-Q[1-4]$/
const WORKBENCH_HREF = '/workbench?tab=post_use_rating'

/**
 * 11-20 V1 下线：ReportSectionToggles 由已删的 PostUseHtmlReportDocument.jsx 迁入本页
 *（V2 报告区块显隐开关，V1/V2 共用件随 V1 文档删除迁移保活）。
 */
function ReportSectionToggles({ hiddenSectionIds, onToggleSection, showPreviousVisits = true }) {
  const hidden = new Set(hiddenSectionIds || [])
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Checkbox
        checked={!hidden.has(REPORT_SECTION_PRODUCTS)}
        onChange={(event) => onToggleSection(REPORT_SECTION_PRODUCTS, event.target.checked)}
      >
        显示分产品情况
      </Checkbox>
      <Checkbox
        checked={!hidden.has(REPORT_SECTION_TODO)}
        onChange={(event) => onToggleSection(REPORT_SECTION_TODO, event.target.checked)}
      >
        显示待办事项及进展
      </Checkbox>
      {showPreviousVisits ? (
        <Checkbox
          checked={!hidden.has(REPORT_SECTION_PREVIOUS_VISITS)}
          onChange={(event) => onToggleSection(REPORT_SECTION_PREVIOUS_VISITS, event.target.checked)}
        >
          显示上期回访补充
        </Checkbox>
      ) : null}
      <Checkbox
        checked={!hidden.has(REPORT_SECTION_APPENDIX)}
        onChange={(event) => onToggleSection(REPORT_SECTION_APPENDIX, event.target.checked)}
      >
        显示附录
      </Checkbox>
    </div>
  )
}

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

/**
 * 11-20 拍板：旧版（V1）报告彻底下线——组件收敛为 V2 单形态。
 * 历史 URL /workbench/post-use-report/:month 已从路由移除（不重定向，彻底 404）。
 */
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
  const [autoDraftStatus, setAutoDraftStatus] = useState({ reportKey: '', phase: 'idle', completed: 0, total: 0, failures: [] })
  const autoDraftRunRef = useRef(null)
  const manualIssueFieldsRef = useRef({})
  const overlayRef = useRef(null)
  const activeReportRef = useRef('')
  const [actionItems, setActionItems] = useState([])
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
  // 11-20 拍板：loading 态加"已运行 Xs"计时——LLM 批慢/挂死一目了然（半开挂死真机实证）
  const [narrativeElapsed, setNarrativeElapsed] = useState(0)
  // 11-19 拍板：未保存报告打开时自动触发一次 LLM 优化（三批）。ref 防重：同报告+同数据指纹
  // 只自动跑一次，失败不重试（用户可手动点按钮）；已保存报告永不自动触发（显示上次结果）。
  const narrativeAutoRunRef = useRef('')
  overlayRef.current = overlay

  const route = useMemo(() => resolveReportRoute(month), [month])
  const reportKey = route?.key || ''
  activeReportRef.current = reportKey
  const reportKind = route?.kind || ''
  const reportPeriod = route?.period || null
  const regenerating = regeneratingKey === reportKey && Boolean(reportKey)
  const savedV2Snapshot = !regenerating && overlay?.snapshot?.reportKey === reportKey
  const loadMonthIds = useMemo(() => {
    if (!reportPeriod) return []
    const months = new Set(postUsePeriodMonths(reportPeriod))
    const previous = resolvePreviousInsightPeriod(reportPeriod)
    for (const item of postUsePeriodMonths(previous)) months.add(item)
    return [...months].map((item) => `period:month:${item}`)
  }, [reportPeriod])

  useEffect(() => {
    if (!storageReady || !loadMonthIds.length) return undefined
    if (loadedReportKey !== reportKey || savedV2Snapshot) return undefined
    for (const periodId of loadMonthIds) void loadPostUseRatingForPeriod(periodId)
    return undefined
  }, [storageReady, loadMonthIds, loadPostUseRatingForPeriod, postUseCacheGeneration, loadedReportKey, reportKey, savedV2Snapshot])

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
        const overlaySnap = await requiredForAi(loadHtmlReportOverlay(adapter, reportKey), null)
        if (!completeForAi) throw new Error('已保存报告读取失败，请刷新重试。')
        if (overlaySnap?.snapshot && !regenerating) {
          if (!cancelled) {
            setOverlay(overlaySnap)
            setStatusTrendsReady(true)
            setLoadedReportKey(reportKey)
            setAutoEvidenceReady(true)
          }
          return
        }
        const [v, actionsRes, traceRows, links] = await Promise.all([
          loadVisitRecords(adapter),
          requiredForAi(listActionItems({ linkedDataSources: 'post_use_rating', limit: 500 }), { items: [] }),
          requiredForAi(listAllPostUseJiraItems(), []),
          requiredForAi(listReportIssueLinks(), []),
        ])
        if (!cancelled) {
          if (!completeForAi) {
            setSideLoadError({ reportKey, message: '报告所需的回访、溯源或行动数据未完整加载，请刷新重试。' })
            setLoadedReportKey('')
            return
          }
          setVisits(v)
          setTraces(traceRows)
          setIssueLinks(links)
          setActionItems(actionsRes?.items || [])
          setOverlay(overlaySnap)
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
  }, [adapter, reportKey, reportKind, regenerating])

  const endMonth = useMemo(
    () => (reportPeriod ? postUsePeriodMonths(reportPeriod).at(-1) || '' : ''),
    [reportPeriod],
  )

  useEffect(() => {
    if (loadedReportKey !== reportKey || savedV2Snapshot) {
      setStatusTrendsReady(savedV2Snapshot)
      return undefined
    }
    if (!adapter || typeof adapter.listPostUseStatusTrends !== 'function' || !endMonth) {
      setStatusTrends(null)
      setStatusTrendsReady(true)
      if (endMonth) setSideLoadError({ reportKey, message: '报告历史趋势服务不可用，请刷新重试。' })
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
          setSideLoadError({ reportKey, message: '报告历史趋势计算失败，请刷新重试。' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, endMonth, reportKey, postUseCacheGeneration, loadedReportKey, savedV2Snapshot])

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
  // 11-20 V1 下线：monthReasons/periodQuality/trendSnap/learnings 为 V1 legacyModel 专属输入，随下线移除

  const remoteCompanyMetrics = useMemo(
    () => Array.isArray(statusTrends?.companyMetrics)
      ? rollupCompanyMetrics(statusTrends.companyMetrics, reportPeriod)
      : null,
    [statusTrends, reportPeriod],
  )
  const useRemoteCompany = Number(remoteCompanyMetrics?.totalSample) > 0

  const ratingsPending = !savedV2Snapshot &&
    postUseRatingOnDemand &&
    loadMonthIds.some((periodId) => !postUseSettledPeriodIds.includes(periodId))

  // 11-20 V1 下线：唯一文档模型 = V2（原 V1 legacyModel 分支删除）
  const model = /** @type {any} */ (useMemo(() => {
    if (!reportKey || !storageReady || sideLoading || loadedReportKey !== reportKey) return null
    if (savedV2Snapshot) return overlay.snapshot
    if (ratingsPending || !statusTrendsReady) return null
    return buildPostUseReportV2Model({
      reportKey, reportKind, reportPeriod,
      records: scopedItems,
      companyRecords: items,
      allRecords: allScopedItems,
      allCompanyRecords: (feedbacks || []).filter((record) => record.dataSourceType === 'post_use_rating'),
      visits, traces, issueLinks, actionItems, statusTrends, overlay,
      // 11-19 按对象剔除：目录产品名+规格别名清单，供矛盾防御判"不满对象是否在产品范围内"
      catalogNames: catalogProductNames(catalog),
    })
  }, [reportKey, reportKind, reportPeriod, storageReady, ratingsPending, sideLoading, loadedReportKey, scopedItems, items, allScopedItems, feedbacks, visits, traces, issueLinks, actionItems, overlay, statusTrends, statusTrendsReady, savedV2Snapshot]))

  useEffect(() => {
    if (!model) return
    setJudgment(model.judgment)
    setTodoNote(model.todoNote)
    setTodoItems(overlay?.narratives?.todoItems || model.todoRows || [])
    setHiddenSectionIds(overlay?.hiddenSectionIds || model.hiddenSectionIds || [])
    setIssueNarratives(Object.fromEntries(model.products.map((product) => [
      `product:${product.name}`,
      overlay?.narratives?.issues?.[`product:${product.name}`] || { conclusion: '', action: '' },
    ])))
    setActionOverrides(overlay?.narratives?.actionOverrides || {})
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
    // 11-20 V1 下线：autoDraft（V1 产品文字稿自动生成队列）随 legacyModel 一并移除
    if (autoDraftRunRef.current) autoDraftRunRef.current.cancelled = true
    autoDraftRunRef.current = null
    setAutoDraftStatus((prev) => prev.phase === 'running' ? { reportKey: '', phase: 'idle', completed: 0, total: 0, failures: [] } : prev)
  }, [])

  useEffect(() => () => {
    if (autoDraftRunRef.current) autoDraftRunRef.current.cancelled = true
  }, [])

  // 11-19 拍板：未保存报告打开 → 自动触发一次 LLM 优化。守卫：仅 V2 + 未保存（无 overlay.snapshot）
  // + 数据齐 + LLM 可用 + 有编辑权；同报告同数据指纹只跑一次（narrativeAutoRunRef 幂等键）。
  // 已保存报告（重开/保存后）不触发——显示上次结果，需手动点「重新 LLM 优化」。
  useEffect(() => {
    if (!model || !canEdit || !autoEvidenceReady || !isLlmAvailable(settings)) return
    if (overlay?.snapshot) return
    const autoKey = `${reportKey}\0${model.dataFingerprint || ''}`
    if (narrativeAutoRunRef.current === autoKey || narrativeAutoRunRef.current === 'failed:' + autoKey) return
    narrativeAutoRunRef.current = autoKey
    void handleGenerateV2Narrative().catch(() => {
      // 自动触发失败：标记该键已试过，本次会话不再自动重试（防失败风暴）；手动按钮仍可用
      narrativeAutoRunRef.current = 'failed:' + autoKey
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleGenerateV2Narrative 引用同批 state；autoKey 已含指纹防重复
  }, [model, canEdit, autoEvidenceReady, settings, overlay?.snapshot, reportKey])

  const loading = !storageReady || sideLoading || ratingsPending || !statusTrendsReady
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

  // 11-19 拍板：责任人未指定阻断保存/导出/发邮件——校验含页面当前编辑中的待办（未保存也能拦住）
  const v2Validation = model ? validatePostUseReportV2(model, actionOverrides, todoItems) : []

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
    if (!model || !canEdit) return
    const requestedKey = reportKey
    setNarrativeGenerating(true)
    // 11-20 计时器：每秒刷新已运行秒数；结束时清理（finally 兜底防泄漏）
    setNarrativeElapsed(0)
    const startedAt = Date.now()
    const elapsedTimer = setInterval(() => setNarrativeElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
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
      // L2 细类覆盖表（11-19 L1/L2 体系）：与 L1 同机制合入 overlay；保存随 narratives 落库
      if (draft.themeL2Labels && Object.keys(draft.themeL2Labels).length) {
        setOverlay((prev) => ({
          ...(prev || {}),
          narratives: { ...(prev?.narratives || {}), themeL2Labels: {
            ...(prev?.narratives?.themeL2Labels || {}),
            ...draft.themeL2Labels,
          } },
        }))
      }
      // 两档剔除·LLM verdicts（11-19）：合入 overlay 触发模型重算（正则优先、LLM 补充）；
      // 保存时随 narratives.evidenceVerdicts 落库，下次打开不再重跑。
      if (draft.evidenceVerdicts && Object.keys(draft.evidenceVerdicts).length) {
        setOverlay((prev) => ({
          ...(prev || {}),
          narratives: { ...(prev?.narratives || {}), evidenceVerdicts: {
            ...(prev?.narratives?.evidenceVerdicts || {}),
            ...draft.evidenceVerdicts,
          } },
        }))
      }
      message.success('报告文案草稿已生成，请复核后保存')
    } catch (error) {
      message.error(error?.message || '报告文案生成失败')
    } finally {
      clearInterval(elapsedTimer)
      setNarrativeGenerating(false)
    }
  }

  const handleSave = async () => {
    if (!canEdit || !model) return
    if (v2Validation.length) {
      message.error(`保存前请处理 ${v2Validation.length} 项校验差异`)
      return
    }
    setSaving(true)
    try {
      const saved = await saveHtmlReportOverlay(adapter, {
        month: reportKey,
        updatedBy: user?.username || user?.id || '',
        dataFingerprint: model.dataFingerprint,
        snapshot: { ...model, todoRows: todoItems, hiddenSectionIds },
        hiddenSectionIds,
        narratives: {
          judgment,
          issues: issueNarratives,
          todoNote,
          todoItems,
          actionOverrides,
          themeGroupLabels: overlay?.narratives?.themeGroupLabels || {},
          themeL2Labels: overlay?.narratives?.themeL2Labels || {},
          evidenceVerdicts: overlay?.narratives?.evidenceVerdicts || {},
          visitSupplements,
        },
      })
      setOverlay(saved)
      setRegeneratingKey('')
      message.success('已保存本期报告，其他用户打开将直接显示此版本')
    } catch (error) {
      message.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const buildOfflineHtml = () => {
    if (!model) return ''
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

  const handleExportOfflineHtml = () => {
    if (!model) return
    if (v2Validation.length) {
      message.error(`导出前请处理 ${v2Validation.length} 项校验差异`)
      return
    }
    setExporting(true)
    try {
      const html = buildOfflineHtml()
      downloadOfflineMonthlyReportHtml(html, offlineMonthlyReportFilename(reportKey, '用后即评' + (reportKind === 'quarter' ? '季报' : '月报')))
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
  } else if (!model?.kpis?.totalSample) {
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
    )
  }

  const showEvidenceWarning = false
  const showDraftProgress = autoDraftStatus.reportKey === reportKey && autoDraftStatus.phase === 'running'
  const showDraftFailures = autoDraftStatus.reportKey === reportKey && autoDraftStatus.phase === 'done' && autoDraftStatus.failures.length > 0

  return (
    <div className="post-use-html-report">
      <style>{`${REPORT_SHARED_CSS}\n${REPORT_V2_CSS}`}</style>
      <header className="post-use-html-report-toolbar">
        <Space wrap>
          <Link to={WORKBENCH_HREF}>返回工作台</Link>
          <Typography.Text strong>{reportKind === 'quarter' ? '用后即评季报' : '用后即评月报'} {reportKey || month || ''}</Typography.Text>
        </Space>
        <Space wrap>
          {model ? (
            <ReportSectionToggles
              hiddenSectionIds={hiddenSectionIds}
              showPreviousVisits={reportKind === 'month'}
              onToggleSection={onToggleSection}
            />
          ) : null}
          {model && overlay?.snapshot && !regenerating && canEdit ? (
            <Button onClick={() => { setLoadedReportKey(''); setRegeneratingKey(reportKey) }}>
              重新生成草稿
            </Button>
          ) : null}
          {model && canEdit ? (
            <Button disabled={!isLlmAvailable(settings)} loading={narrativeGenerating} onClick={() => void handleGenerateV2Narrative()}>
              {/* 11-19 拍板：按钮常驻（不再只未保存态显示）；已保存报告显示"重新 LLM 优化"， */}
              {/* 未保存显示"LLM 优化"。重开后默认展示上次保存结果，需要时手动重新触发。 */}
              {/* 11-20 计时提示：运行中显示已运行秒数，慢/挂死一目了然 */}
              {overlay?.snapshot ? '重新 LLM 优化' : 'LLM 优化'}
              {narrativeGenerating ? `（已运行 ${narrativeElapsed}s）` : ''}
            </Button>
          ) : null}
          {model ? <Typography.Text type="secondary" className="text-xs">
            {overlay?.snapshot && !regenerating ? `已保存 · ${overlay.updatedAt || ''}` : '未保存草稿 · 请复核后保存'}
          </Typography.Text> : null}
          <Button disabled={!canEdit || !model} loading={saving} type="primary" onClick={() => void handleSave()}>
            保存
          </Button>
          <Button disabled={!model || v2Validation.length > 0} loading={exporting} onClick={handleExportOfflineHtml}>
            导出离线 HTML
          </Button>
          <Button
            disabled={!canEdit || !model || v2Validation.length > 0}
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
        periodLabel={reportPeriod?.label || reportKey}
        reportKey={reportKey}
        reportKind={reportKind === 'quarter' ? 'quarter' : 'month'}
        reportVersion="v2"
        linkKind="report"
        canSend={canEdit && Boolean(model) && v2Validation.length === 0}
        buildAttachment={async () => {
          if (!model) return null
          const html = buildOfflineHtml()
          return {
            filename: offlineMonthlyReportFilename(reportKey, '用后即评' + (reportKind === 'quarter' ? '季报' : '月报')),
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
      {model && v2Validation.length ? <div className="post-use-html-report-status no-print">
        <Alert type="warning" showIcon message="新版报告导出校验待处理" description={v2Validation.join('；')} />
      </div> : null}
      <div className="post-use-html-report-sheet">
        {body}
      </div>
    </div>
  )
}
