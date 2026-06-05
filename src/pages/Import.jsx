import { useState, useCallback, useMemo, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { InboxOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  List,
  Modal,
  Result,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useInsights } from '../context/InsightsContext.jsx'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { readBackgroundTaskErrorMessage } from '../lib/backgroundTaskClient.js'
import { ImportProgressAlert } from '../components/TaggingProgressAlert.jsx'
import InsightMonthPicker from '../components/InsightMonthPicker.jsx'
import { PageHeader } from './Dashboard.shared.jsx'
import { STANDARD_FIELDS } from '../lib/types.js'
import {
  parseUploadFile,
  applyColumnMap,
  applyDefaultTicketIdMapping,
  buildMappingFromHeaders,
} from '../lib/parseFile.js'
import { getPresetsForImport, SATISFACTION_CALLBACK_PRESET } from '../lib/columnPresets.js'
import { enrichTicketRecordsForImport } from '../lib/importEnrichment.js'
import { formatTicketLlmRemainRuleMessage } from '../lib/importEnrichmentStats.js'
import {
  getEnabledProducts,
  partitionRowsByProductCatalog,
} from '../lib/productCatalog.js'
import {
  isTicketSource,
  validateImportFile,
  validateRowCount,
  hashFileSha256,
  defaultBatchName,
  preferredSheetName,
  normalizeImportMonth,
} from '../lib/importUtils.js'
import {
  POST_USE_RATING_SUBTYPE_OPTIONS,
  POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK,
  isFollowUpSatisfactionImport,
} from '../domain/postUseRatingImport.js'
import {
  FOLLOW_UP_IMPORT_SESSION_LABEL,
  executeFollowUpImport,
  runFollowUpImportDryRun,
} from '../lib/followUpSatisfactionImportSession.js'
import {
  FollowUpSatisfactionColumnMapping,
  FollowUpSatisfactionImportPreview,
  formatFollowUpImportSummaryDescription,
} from '../components/import/FollowUpSatisfactionImportPreview.jsx'
import { isStubPipeline } from '../analysis/registry.js'
import { randomId } from '../lib/randomId.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { downloadFailuresCsv } from '../lib/export.js'
import { buildTaggingPreviewRows, rowHasQuoteSourceText } from '../lib/importPreview.js'
import QuoteImportPreviewTable from '../components/QuoteImportPreviewTable.jsx'
import {
  MAX_IMPORT_FILES,
  MAX_ROWS_PER_FILE,
  combineImportFileSha256,
  mergeParsedUploadFiles,
} from '../lib/importBatchFiles.js'
import { IMPORT_ALREADY_IN_PROGRESS_TIP } from '../lib/importSession.js'

/** @typedef {import('../lib/importBatchFiles.js').ParsedUploadFile} ParsedUploadFile */

const STEPS = ['来源与月份', '上传文件', '列映射', '预览确认', '导入完成']

const MERGE_OPTIONS = ['处理意见', '追加信息', '归档意见']

const SOURCE_OPTIONS = DATA_SOURCE_TYPES.map((value) => ({
  value,
  label: isStubPipeline(value)
    ? `${DATA_SOURCE_LABELS[value]}（Pipeline 未实现 · 仅导入）`
    : DATA_SOURCE_LABELS[value],
}))

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

export default function Import({ embedded = false }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialSource = searchParams.get('source')
  const initialSubType = searchParams.get('subType')
  const {
    addFeedbacks,
    adapter,
    beginImportSession,
    prepareSharedBackgroundTask,
    setImportSessionProgress,
    endImportSession,
    notifyImportFinished,
    settings,
    setTeamSettings,
    reloadAllConfigs,
    syncProductCatalogToTaxonomy,
    runPipeline,
    listPipelineDescriptors,
    rebuildSnapshotsForImportMonth,
    storageReady,
    periodsLoading,
    periods,
    importSession,
    syncSharedDataFromServer,
  } = useInsights()
  const { importBlocked, importBlockedTip } = useSharedBackgroundTaskBlock()

  const [dataSourceType, setDataSourceType] = useState(() => {
    if (initialSource && DATA_SOURCE_TYPES.includes(initialSource)) {
      return /** @type {import('../domain/enums.js').DataSourceType} */ (initialSource)
    }
    return 'complaint_ticket'
  })
  const [postUseRatingSubType, setPostUseRatingSubType] = useState(() => {
    if (initialSubType === 'satisfaction_callback' || initialSubType === 'standalone') {
      return initialSubType
    }
    return POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK
  })
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [columnMap, setColumnMap] = useState({})
  const [rawTextMerge, setRawTextMerge] = useState([])
  const [loading, setLoading] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [uploadFiles, setUploadFiles] = useState(/** @type {ParsedUploadFile[]} */ ([]))
  const [rowSources, setRowSources] = useState(
    /** @type {{ fileName: string; sheetName: string }[]} */ ([]),
  )
  const [fileSha256, setFileSha256] = useState('')
  const [sheetNames, setSheetNames] = useState([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [activePreset, setActivePreset] = useState(null)
  const [importMonth, setImportMonth] = useState(currentMonth)
  const [batchName, setBatchName] = useState(() =>
    defaultBatchName('complaint_ticket', currentMonth()),
  )
  const [importResult, setImportResult] = useState(
    /** @type {null | { run: import('../domain/analysisRun.js').AnalysisRun; records: object[]; failures: import('../domain/analysisRun.js').AnalysisRunFailure[]; skipped: number; dataMonth?: string; dataSourceType?: string; taggingWarnings?: string[]; enrichmentStats?: import('../lib/importEnrichmentStats.js').ImportEnrichmentStats; ingest?: { added: number; skippedDuplicates: number; totalAfter: number } }} */ (
      null
    ),
  )
  /** @type {[import('../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary | null, Function]} */
  const [followUpPreview, setFollowUpPreview] = useState(null)
  const [followUpPreviewError, setFollowUpPreviewError] = useState('')
  const [followUpPreviewLoading, setFollowUpPreviewLoading] = useState(false)
  /** @type {[null | { summary: import('../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary; dataMonth: string }, Function]} */
  const [followUpImportResult, setFollowUpImportResult] = useState(null)

  const importMonthDisplay = useMemo(() => {
    const normalized = normalizeImportMonth(importMonth)
    if (!normalized) return importMonth?.trim() || '未选择'
    const [y, m] = normalized.split('-')
    return `${y}年${Number(m)}月（${normalized}）`
  }, [importMonth])

  const ticketSource = isTicketSource(dataSourceType)
  const followUpImport = isFollowUpSatisfactionImport(dataSourceType, postUseRatingSubType)
  const isConsultation = dataSourceType === 'consultation_ticket'
  const sourcePresets = useMemo(
    () => getPresetsForImport(dataSourceType, postUseRatingSubType),
    [dataSourceType, postUseRatingSubType],
  )
  const mappingOptions = useMemo(
    () => ({ postUseRatingSubType }),
    [postUseRatingSubType],
  )
  const pipelineDesc = useMemo(
    () => listPipelineDescriptors().find((d) => d.dataSourceType === dataSourceType),
    [dataSourceType, listPipelineDescriptors],
  )

  useEffect(() => {
    setBatchName((prev) => {
      if (!prev || /^\d{4}-\d{2}/.test(prev)) {
        return defaultBatchName(dataSourceType, importMonth)
      }
      return prev
    })
  }, [dataSourceType, importMonth])

  const resetFileState = useCallback(() => {
    setHeaders([])
    setRows([])
    setRowSources([])
    setColumnMap({})
    setRawTextMerge([])
    setUploadFiles([])
    setFileSha256('')
    setSheetNames([])
    setSelectedSheet('')
    setActivePreset(null)
    setImportResult(null)
    setFollowUpPreview(null)
    setFollowUpPreviewError('')
    setFollowUpImportResult(null)
  }, [])

  const parseFileToEntry = useCallback(
    /**
     * @param {File} file
     * @param {string} [sheetName]
     */
    async (file, sheetName) => {
      const fileCheck = validateImportFile(file)
      if (!fileCheck.ok) throw new Error(fileCheck.message)

      const sha256 = await hashFileSha256(file)
      const first = await parseUploadFile(file)
      if (!first.headers.length || !first.rows.length) {
        throw new Error('文件为空或无法解析')
      }

      const names = first.sheetNames?.length ? first.sheetNames : []
      const selected =
        sheetName || (names.length ? preferredSheetName(dataSourceType, names) : '') || ''

      let headers = first.headers
      let rows = first.rows

      if (names.length && selected) {
        const parsed = await parseUploadFile(file, { sheetName: selected })
        if (!parsed.headers.length || !parsed.rows.length) {
          throw new Error(`工作表「${selected}」为空`)
        }
        headers = parsed.headers
        rows = parsed.rows
      }

      const rowCheck = validateRowCount(rows.length)
      if (!rowCheck.ok) throw new Error(`${file.name}：${rowCheck.message}`)

      return /** @type {ParsedUploadFile} */ ({
        id: randomId(),
        file,
        sha256,
        sheetNames: names,
        selectedSheet: selected,
        headers,
        rows,
      })
    },
    [dataSourceType],
  )

  const addUploadFile = useCallback(
    async (file) => {
      if (uploadFiles.length >= MAX_IMPORT_FILES) {
        setError(`最多同时上传 ${MAX_IMPORT_FILES} 个文件`)
        return
      }
      if (
        uploadFiles.some(
          (f) => f.file.name === file.name && f.file.size === file.size && f.file.lastModified === file.lastModified,
        )
      ) {
        setError(`「${file.name}」已在列表中`)
        return
      }
      setError('')
      setLoading(true)
      try {
        const entry = await parseFileToEntry(file)
        setUploadFiles((prev) => [...prev, entry])
      } catch (e) {
        setError(e.message || '解析失败')
      } finally {
        setLoading(false)
      }
    },
    [uploadFiles, parseFileToEntry],
  )

  const removeUploadFile = useCallback((id) => {
    setUploadFiles((prev) => prev.filter((f) => f.id !== id))
    setError('')
  }, [])

  const changeUploadFileSheet = useCallback(
    async (id, sheetName) => {
      const entry = uploadFiles.find((f) => f.id === id)
      if (!entry || !sheetName) return
      setError('')
      setLoading(true)
      try {
        const next = await parseFileToEntry(entry.file, sheetName)
        setUploadFiles((prev) => prev.map((f) => (f.id === id ? { ...next, id } : f)))
      } catch (e) {
        setError(e.message || '切换工作表失败')
      } finally {
        setLoading(false)
      }
    },
    [uploadFiles, parseFileToEntry],
  )

  const proceedToColumnMapping = useCallback(async () => {
    if (!uploadFiles.length) {
      setError('请至少上传一个文件')
      return
    }
    setError('')
    setLoading(true)
    try {
      const merged = mergeParsedUploadFiles(uploadFiles)
      const mapping = buildMappingFromHeaders(merged.headers, dataSourceType, mappingOptions)
      if (followUpImport) {
        if (!mapping.preset || mapping.preset.id !== SATISFACTION_CALLBACK_PRESET.id) {
          throw new Error('表头需包含「回访工单编号」与「原工单编号」（满意度回访记录格式）')
        }
      }
      setHeaders(merged.headers)
      setRows(merged.rows)
      setRowSources(merged.rowSources)
      setColumnMap(mapping.columnMap)
      setRawTextMerge(mapping.rawTextMerge)
      setActivePreset(mapping.preset)
      setFileSha256(combineImportFileSha256(uploadFiles.map((f) => f.sha256)))
      setSheetNames(uploadFiles.length === 1 ? uploadFiles[0].sheetNames : [])
      setSelectedSheet(uploadFiles.length === 1 ? uploadFiles[0].selectedSheet : '')
      setStep(2)
    } catch (e) {
      setError(e.message || '合并文件失败')
    } finally {
      setLoading(false)
    }
  }, [uploadFiles, dataSourceType, followUpImport, mappingOptions])

  const uploadTotalRows = useMemo(
    () => uploadFiles.reduce((n, f) => n + f.rows.length, 0),
    [uploadFiles],
  )

  const onSourceChange = (value) => {
    setDataSourceType(value)
    if (value === 'post_use_rating') {
      setPostUseRatingSubType(POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK)
    }
    resetFileState()
    setStep(0)
    setError('')
  }

  const onPostUseRatingSubTypeChange = (value) => {
    setPostUseRatingSubType(value)
    resetFileState()
    setStep(0)
    setError('')
  }

  const onSheetChange = async (sheetName) => {
    if (uploadFiles.length !== 1 || !sheetName) return
    setError('')
    setLoading(true)
    try {
      const entry = uploadFiles[0]
      const next = await parseFileToEntry(entry.file, sheetName)
      const updated = [{ ...next, id: entry.id }]
      setUploadFiles(updated)
      const merged = mergeParsedUploadFiles(updated)
      const mapping = buildMappingFromHeaders(merged.headers, dataSourceType, mappingOptions)
      setHeaders(merged.headers)
      setRows(merged.rows)
      setRowSources(merged.rowSources)
      setColumnMap(mapping.columnMap)
      setRawTextMerge(mapping.rawTextMerge)
      setActivePreset(mapping.preset)
      setSelectedSheet(sheetName)
    } catch (e) {
      setError(e.message || '切换工作表失败')
    } finally {
      setLoading(false)
    }
  }

  const applyPreset = (preset) => {
    const map = { ...preset.columnMap }
    for (const key of Object.keys(map)) {
      if (!headers.includes(map[key])) delete map[key]
    }
    setColumnMap(applyDefaultTicketIdMapping(headers, map, dataSourceType))
    setRawTextMerge((preset.rawTextMerge || []).filter((c) => headers.includes(c)))
    setActivePreset(preset)
  }

  const mappedAll = useMemo(() => {
    if (step < 2) return []
    return applyColumnMap(rows, columnMap, rawTextMerge)
  }, [step, rows, columnMap, rawTextMerge])

  const catalogPartition = useMemo(() => {
    if (step < 3) {
      return {
        inScope: [],
        skipped: [],
        stats: {
          total: rows.length,
          accepted: rows.length,
          skipped: 0,
          enabledProductNames: ticketSource
            ? getEnabledProducts()
                .map((p) => p.name)
                .join('、')
            : '—',
        },
      }
    }
    if (!ticketSource) {
      const valid = mappedAll.filter(
        (r) =>
          (r.handlingText || r.rawText || r.commentText || r.openText || r.body)?.trim(),
      )
      return {
        inScope: valid,
        skipped: mappedAll.filter((r) => !valid.includes(r)),
        stats: {
          accepted: valid.length,
          skipped: mappedAll.length - valid.length,
          enabledProductNames: '—',
        },
      }
    }
    return partitionRowsByProductCatalog(mappedAll)
  }, [step, mappedAll, ticketSource, rows.length])

  const canImport = ticketSource
    ? (columnMap.handlingText || columnMap.rawText) && catalogPartition.inScope.length > 0
    : followUpImport
      ? Boolean(
          followUpPreview &&
            !followUpPreviewLoading &&
            !followUpPreviewError &&
            followUpPreview.appliedRowCount > 0,
        )
      : catalogPartition.inScope.length > 0

  const canProceedFromColumnMapping = followUpImport
    ? activePreset?.id === SATISFACTION_CALLBACK_PRESET.id
    : ticketSource
      ? Boolean(columnMap.rawText || columnMap.handlingText)
      : true

  const quotePreviewSourceRows = useMemo(() => {
    if (step < 2) return []
    if (ticketSource) {
      try {
        return partitionRowsByProductCatalog(mappedAll).inScope
      } catch {
        return []
      }
    }
    return mappedAll.filter(rowHasQuoteSourceText)
  }, [step, mappedAll, ticketSource, columnMap, rawTextMerge])

  const taggingPreviewRows = useMemo(() => {
    if (step < 2) return []
    return buildTaggingPreviewRows(quotePreviewSourceRows, {
      dataSourceType,
      settings,
      limit: 3,
    })
  }, [step, quotePreviewSourceRows, dataSourceType, settings])

  const enabledProducts = getEnabledProducts()

  const toggleMerge = (col) => {
    setRawTextMerge((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    )
  }

  const reportProgress = useCallback((text) => {
    setImportProgress(text)
    setImportSessionProgress(text)
  }, [setImportSessionProgress])

  useEffect(() => {
    if (step !== 3 || !followUpImport || !rows.length || !storageReady) return
    let cancelled = false
    setFollowUpPreviewLoading(true)
    setFollowUpPreviewError('')
    setFollowUpPreview(null)
    void (async () => {
      try {
        const preview = await runFollowUpImportDryRun({
          adapter,
          rows,
          importMonth,
          periods,
        })
        if (!cancelled) setFollowUpPreview(preview)
      } catch (err) {
        if (!cancelled) {
          setFollowUpPreviewError(
            readBackgroundTaskErrorMessage(err) || err.message || '预览失败',
          )
        }
      } finally {
        if (!cancelled) setFollowUpPreviewLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [step, followUpImport, rows, importMonth, periods, adapter, storageReady])

  const doFollowUpImport = async () => {
    setLoading(true)
    setError('')
    let sessionStarted = false
    let shouldSyncAfterImport = false
    try {
      if (importSession.active) {
        throw new Error(IMPORT_ALREADY_IN_PROGRESS_TIP)
      }
      if (importBlocked && !importSession.active) {
        throw new Error(importBlockedTip || '当前无法导入')
      }
      if (!storageReady) {
        throw new Error(
          periodsLoading
            ? '本地数据存储正在初始化，请稍候几秒后重试'
            : '本地数据存储未就绪，请刷新页面后重试',
        )
      }
      if (!followUpPreview?.appliedRowCount) {
        throw new Error('没有可导入的匹配行')
      }

      await prepareSharedBackgroundTask('import', {
        progress: '正在导入满意度回访…',
        meta: { importKind: 'followUp', importMonth: normalizeImportMonth(importMonth) },
      })
      beginImportSession({
        batchName: FOLLOW_UP_IMPORT_SESSION_LABEL,
        progress: '正在导入满意度回访…',
        dataMonth: normalizeImportMonth(importMonth),
        kind: 'analysis',
      })
      sessionStarted = true
      reportProgress('正在匹配并写入回访数据…')

      const { summary, dataMonth, shouldSync } = await executeFollowUpImport({
        adapter,
        rows,
        importMonth,
        periods,
        onUploadProgress: (uploaded, total) => {
          reportProgress(`正在保存（${uploaded}/${total}）…`)
        },
      })
      shouldSyncAfterImport = shouldSync
      if (shouldSyncAfterImport) {
        reportProgress('正在同步数据…')
      }

      setFollowUpImportResult({ summary, dataMonth })
      setStep(4)
      if (summary.updatedRecordCount === 0) {
        setError('没有工单被更新，请检查未匹配清单')
      }
    } catch (e) {
      setError(readBackgroundTaskErrorMessage(e) || e.message || '导入失败')
    } finally {
      if (sessionStarted) endImportSession()
      if (shouldSyncAfterImport) {
        await syncSharedDataFromServer({ notify: false })
      }
      setLoading(false)
      setImportProgress('')
    }
  }

  const confirmFollowUpImport = () => {
    if (!followUpPreview?.appliedRowCount && !followUpPreview?.unmatched.length) {
      setError('没有可导入的数据行')
      return
    }
    Modal.confirm({
      title: '确认导入满意度回访？',
      content: (
        <>
          将按<strong>原工单号</strong>匹配投诉/咨询工单并写入回访满意度；同回访工单号重复导入将覆盖更新。
          <br />
          预计写入 <strong>{followUpPreview?.appliedRowCount ?? 0}</strong> 行，更新工单{' '}
          <strong>{followUpPreview?.updatedRecordCount ?? 0}</strong> 条。
        </>
      ),
      okText: '确认导入',
      cancelText: '取消',
      onOk: () => doFollowUpImport(),
    })
  }

  const doImport = async (forceDuplicate = false) => {
    setLoading(true)
    setError('')
    let importFinishedNotified = false
    try {
      if (importSession.active) {
        throw new Error(IMPORT_ALREADY_IN_PROGRESS_TIP)
      }
      if (importBlocked && !importSession.active) {
        throw new Error(importBlockedTip || '当前无法导入')
      }
      if (!storageReady) {
        throw new Error(
          periodsLoading
            ? '本地数据存储正在初始化，请稍候几秒后重试'
            : '本地数据存储未就绪，请刷新页面后重试',
        )
      }
      await reloadAllConfigs()
      await syncProductCatalogToTaxonomy()
      const mapped = applyColumnMap(rows, columnMap, rawTextMerge).map((r, i) => ({
        ...r,
        importFileName: rowSources[i]?.fileName,
        importSheetName: rowSources[i]?.sheetName || undefined,
      }))
      const partition = ticketSource
        ? partitionRowsByProductCatalog(mapped)
        : {
            inScope: mapped.filter(
              (r) =>
                (r.handlingText || r.rawText || r.commentText || r.openText || r.body)?.trim(),
            ),
            skipped: [],
            stats: { enabledProductNames: '—' },
          }
      const { inScope, skipped, stats } = partition

      if (inScope.length === 0) {
        throw new Error(
          ticketSource
            ? `没有符合目标产品范围的工单。当前仅分析：${stats.enabledProductNames || '（未配置）'}`
            : '没有可导入的有效数据行',
        )
      }

      const dataMonth = normalizeImportMonth(importMonth)
      if (!dataMonth) {
        throw new Error('请选择有效的数据月份（YYYY-MM）')
      }

      await prepareSharedBackgroundTask('import', {
        progress: '正在准备分析…',
        meta: {
          dataMonth,
          batchName: batchName?.trim() || defaultBatchName(dataSourceType, dataMonth),
          dataSourceType,
        },
      })

      beginImportSession({
        progress: '正在准备分析…',
        dataMonth,
        batchName: batchName?.trim() || defaultBatchName(dataSourceType, dataMonth),
        dataSourceType,
      })
      reportProgress('正在准备分析…')

      const batchId = `${dataMonth}-${Date.now()}`
      const importedAt = new Date().toISOString()
      const fileLabel =
        uploadFiles.length > 1
          ? `${uploadFiles.length} 个文件`
          : uploadFiles[0]?.file.name || '导入文件'
      const batchMeta = {
        importBatchId: batchId,
        importBatchName:
          batchName?.trim() ||
          `${defaultBatchName(dataSourceType, dataMonth)}（${fileLabel}）`,
        importMonth: dataMonth,
        fileSha256,
        force: forceDuplicate,
        settings,
      }

      inScope.forEach((row) => {
        row.importMonth = dataMonth
        row.importBatchId = batchId
        row.importBatchName = batchMeta.importBatchName
        row.importedAt = importedAt
      })

      reportProgress(`正在规则初标 (0/${inScope.length})…`)

      let records
      let failures
      let run
      /** @type {string[]} */
      let taggingWarnings = []
      /** @type {import('../lib/importEnrichmentStats.js').ImportEnrichmentStats | undefined} */
      let enrichmentStats

      if (ticketSource) {
        const result = await runPipeline(dataSourceType, inScope, batchMeta)
        run = result.run
        failures = result.failures
        records = result.records

        if (!records.length) {
          const sample = failures
            .slice(0, 3)
            .map((f) => `第 ${f.rowIndex + 1} 行：${f.message}`)
            .join('；')
          throw new Error(
            `分析未产生可导入记录（${failures.length} 行失败${sample ? `：${sample}` : ''}）。请检查产品目录、列映射与处理意见列。`,
          )
        }

        reportProgress(`正在增强打标 (0/${records.length})…`)
        const enriched = await enrichTicketRecordsForImport(
          records,
          settings,
          (label, done, total) => {
            if (total != null && total > 0) {
              reportProgress(`正在${label} (${done ?? 0}/${total})…`)
            } else {
              reportProgress(`正在${label}…`)
            }
          },
        )
        records = enriched.records
        taggingWarnings = enriched.warnings
        enrichmentStats = enriched.enrichmentStats
      } else {
        const result = await runPipeline(dataSourceType, inScope, batchMeta)
        run = result.run
        failures = result.failures
        records = result.records.map((r) => ({
          ...r,
          importMonth: r.importMonth || dataMonth,
          importBatchId: r.importBatchId || batchId,
          importBatchName: r.importBatchName || batchMeta.importBatchName,
          importFileName: r.importFileName,
          importSheetName: r.importSheetName || undefined,
          importedAt: r.importedAt || importedAt,
        }))
        if (!records.length) {
          const sample = failures
            .slice(0, 3)
            .map((f) => `第 ${f.rowIndex + 1} 行：${f.message}`)
            .join('；')
          throw new Error(
            `分析未产生可导入记录${sample ? `：${sample}` : ''}`,
          )
        }
      }

      reportProgress(`正在写入服务器 (0/${records.length})…`)
      const ingest = await addFeedbacks(records, {
        onUploadProgress: (uploaded, total) => {
          reportProgress(`正在写入服务器 (${uploaded}/${total})…`)
        },
      })

      try {
        reportProgress('正在生成该数据月份的洞察快照…')
        await rebuildSnapshotsForImportMonth(dataMonth, records)
      } catch (snapErr) {
        console.warn('[import] snapshot rebuild after import:', snapErr)
      }

      notifyImportFinished({
        dataMonth,
        dataSourceType,
        added: ingest.added,
        skippedDuplicates: ingest.skippedDuplicates,
        failures: failures.length,
        skippedProducts: skipped.length,
        batchName: batchMeta.importBatchName,
        ticketLlmFailed: enrichmentStats?.ticketLlmFailed ?? 0,
      })
      importFinishedNotified = true

      setImportResult({
        run,
        records,
        failures,
        skipped: skipped.length,
        dataMonth,
        dataSourceType,
        taggingWarnings,
        enrichmentStats,
        ingest,
      })
      setStep(4)
    } catch (e) {
      if (e?.code === 'DUPLICATE_RUN') {
        const ok = window.confirm(
          uploadFiles.length > 1
            ? '24 小时内已导入过相同文件组合。是否仍要重新分析并导入？'
            : '24 小时内已导入过相同文件。是否仍要重新分析并导入？',
        )
        if (ok) {
          await doImport(true)
          return
        }
        setError('已取消：相同文件近期已完成分析')
      } else {
        setError(readBackgroundTaskErrorMessage(e) || e.message || '导入失败')
      }
    } finally {
      if (!importFinishedNotified) {
        endImportSession()
      }
      setLoading(false)
      setImportProgress('')
    }
  }

  const importBusy = loading || importSession.active

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="数据导入"
          desc="选择数据来源与数据月份；投诉/咨询走打标流水线，用后即评 · 满意度回访按原工单号补全已有工单"
        />
      )}

      <Steps
        className="page-section"
        current={step}
        items={STEPS.map((title) => ({ title }))}
      />

      {error && <Alert className="page-section-sm" type="error" showIcon title={error} />}
      {importBlocked && !importSession.active && (
        <Alert
          className="page-section-sm"
          type="warning"
          showIcon
          title="暂无法导入"
          description={importBlockedTip}
        />
      )}
      {importSession.active && (
        <ImportProgressAlert
          progress={importSession.progress || importProgress}
          dataMonth={importSession.dataMonth}
        />
      )}
      {loading && !importSession.active && (
        <Alert
          className="page-section-sm"
          type="info"
          showIcon
          title="数据导入进行中"
          description="可切换至其他页面，导入会在后台继续；离开本页前会提示确认，完成后将收到全局通知。"
        />
      )}

      {step === 0 && (
        <Card className="page-section">
          <Typography.Title level={5} className="!mb-4">
            数据来源与数据时间
          </Typography.Title>
          <div className="page-grid-2">
            <div>
              <Typography.Text strong className="mb-1 block text-xs">
                数据来源
              </Typography.Text>
              <Select
                className="w-full"
                value={dataSourceType}
                options={SOURCE_OPTIONS}
                onChange={onSourceChange}
              />
              {dataSourceType === 'post_use_rating' && (
                <div className="mt-3">
                  <Typography.Text strong className="mb-1 block text-xs">
                    二级分类
                  </Typography.Text>
                  <Select
                    className="w-full"
                    value={postUseRatingSubType}
                    options={POST_USE_RATING_SUBTYPE_OPTIONS}
                    onChange={onPostUseRatingSubTypeChange}
                  />
                  {followUpImport && (
                    <Typography.Text type="secondary" className="mt-2 block text-xs">
                      满意度回访不新增独立记录，按原工单号补全投诉/咨询工单的回访满意度。
                    </Typography.Text>
                  )}
                </div>
              )}
              {pipelineDesc && !followUpImport && (
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  流水线：{pipelineDesc.label}（v{pipelineDesc.pipelineVersion}）
                </Typography.Text>
              )}
            </div>
            <div>
              <Typography.Text strong className="mb-1 block text-xs">
                数据月份（数据时间）
              </Typography.Text>
              <InsightMonthPicker
                className="w-full"
                value={importMonth}
                onChange={setImportMonth}
              />
              <Typography.Text type="secondary" className="mt-2 block text-xs">
                任意月份均可导入；数据归属以上方「数据月份」为准，不会随工作台当前周期改变。
              </Typography.Text>
              <Typography.Text type="secondary" className="mt-1 block text-[10px]">
                在工作台切换到对应月/季/年后即可查看该批数据的洞察（按数据时间匹配）。
              </Typography.Text>
            </div>
          </div>
          {isStubPipeline(dataSourceType) && !followUpImport && (
            <Alert
              className="page-section-sm"
              type="warning"
              showIcon
              title={`「${DATA_SOURCE_LABELS[dataSourceType]}」Pipeline 未实现`}
              description="可正常导入并在「反馈库」查看明细；工作台不会展示该来源的专项图表与指标（避免空图表误导）。完整分析能力将在后续版本提供。"
            />
          )}
          <div className="page-section">
            <Button type="primary" onClick={() => setStep(1)}>
              下一步：上传文件
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card className="page-section">
          <Alert
            className="mb-4"
            type="info"
            showIcon
            title={
              <>
                当前来源：<Tag>{DATA_SOURCE_LABELS[dataSourceType]}</Tag>
                {dataSourceType === 'post_use_rating' && (
                  <Tag>
                    {POST_USE_RATING_SUBTYPE_OPTIONS.find((o) => o.value === postUseRatingSubType)?.label}
                  </Tag>
                )}
                数据月份：<Tag color="blue">{importMonthDisplay}</Tag>
              </>
            }
            description={
              followUpImport
                ? '满意度回访仅支持单文件上传；需含「回访工单编号」「原工单编号」等列。'
                : '可一次选择最多 5 个结构相同的文件；单文件 ≤20MB、≤5000 行，合并后总行数 ≤25000。'
            }
          />
          <Upload.Dragger
            accept=".csv,.xlsx,.xls"
            multiple={!followUpImport}
            maxCount={followUpImport ? 1 : MAX_IMPORT_FILES}
            showUploadList={false}
            disabled={
              importBusy ||
              (!followUpImport && uploadFiles.length >= MAX_IMPORT_FILES) ||
              (followUpImport && uploadFiles.length >= 1)
            }
            beforeUpload={(file) => {
              if (followUpImport && uploadFiles.length >= 1) {
                setError('满意度回访导入仅支持单文件')
                return Upload.LIST_IGNORE
              }
              if (uploadFiles.length >= MAX_IMPORT_FILES) {
                setError(`最多同时上传 ${MAX_IMPORT_FILES} 个文件`)
                return Upload.LIST_IGNORE
              }
              void addUploadFile(file)
              return false
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">
              {followUpImport ? '拖拽或点击选择满意度回访文件' : '拖拽或点击选择文件（可多选）'}
            </p>
            <p className="ant-upload-hint">
              已添加 {uploadFiles.length}/{MAX_IMPORT_FILES} 个 · 合计约 {uploadTotalRows} 行
            </p>
            <Button
              type="primary"
              className="page-section-sm"
              loading={importBusy}
              disabled={uploadFiles.length >= MAX_IMPORT_FILES || importBusy}
            >
              添加文件
            </Button>
          </Upload.Dragger>

          {uploadFiles.length > 0 && (
            <List
              className="page-section-sm"
              size="small"
              bordered
              dataSource={uploadFiles}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="del"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeUploadFile(item.id)}
                    />,
                  ]}
                >
                  <List.Item.Meta
                    title={item.file.name}
                    description={
                      <Space orientation="vertical" size={4} className="w-full">
                        <Typography.Text type="secondary" className="text-xs">
                          {item.rows.length} 行 · SHA256 {item.sha256.slice(0, 8)}…
                        </Typography.Text>
                        {item.sheetNames.length > 1 && (
                          <Select
                            size="small"
                            className="max-w-md"
                            value={item.selectedSheet}
                            options={item.sheetNames.map((n) => ({ label: n, value: n }))}
                            onChange={(sheet) => changeUploadFileSheet(item.id, sheet)}
                            disabled={importBusy}
                          />
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}

          <div className="page-section-sm flex flex-wrap gap-2">
            <Button onClick={() => setStep(0)}>上一步</Button>
            <Button
              type="primary"
              disabled={!uploadFiles.length || importBusy}
              onClick={() => void proceedToColumnMapping()}
            >
              下一步：列映射（{uploadFiles.length} 个文件，{uploadTotalRows} 行）
            </Button>
            {ticketSource && (
              <a href="/sample-tickets.csv" download className="text-xs text-brand-600 leading-8">
                下载投诉工单样例 CSV
              </a>
            )}
          </div>
        </Card>
      )}

      {step >= 2 && step <= 3 && (
        <div className="page-section-sm space-y-3">
          {uploadFiles.length > 1 && (
            <Alert
              type="info"
              showIcon
              title={`已合并 ${uploadFiles.length} 个文件，共 ${rows.length} 行`}
              description={uploadFiles.map((f) => f.file.name).join('、')}
            />
          )}
          {uploadFiles.length === 1 && sheetNames.length > 1 && (
            <Card>
              <Typography.Text strong className="text-sm">
                选择工作表（当前 {rows.length} 行）
              </Typography.Text>
              <Select
                className="mt-2 block max-w-md"
                value={selectedSheet}
                options={sheetNames.map((n) => ({ label: n, value: n }))}
                onChange={onSheetChange}
                disabled={importBusy}
              />
            </Card>
          )}
          {activePreset && (
            <Alert
              type="info"
              showIcon
              title={`已识别为「${activePreset.name}」格式`}
              description={activePreset.description}
            />
          )}
        </div>
      )}

      {step === 2 && (
        <div className="page-section space-y-5">
          <Card>
            <Typography.Title level={5} className="!mb-0">
              列映射
            </Typography.Title>
            {followUpImport ? (
              <div className="page-section-sm">
                <FollowUpSatisfactionColumnMapping preset={activePreset} headers={headers} />
              </div>
            ) : (
              <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span />
              <Space wrap>
                {sourcePresets.map((p) => (
                  <Button key={p.id} size="small" onClick={() => applyPreset(p)}>
                    套用：{p.name}
                  </Button>
                ))}
              </Space>
            </div>
            {ticketSource && (
              <Typography.Text type="secondary" className="mt-1 block text-xs">
                仅分析目标产品：{enabledProducts.map((p) => p.name).join('、') || '（未配置）'}
              </Typography.Text>
            )}
            {rows.length > 0 && (
              <Alert
                className="!mt-3"
                type="info"
                showIcon
                title={`共 ${rows.length} 行 · 列映射变更时下方实时刷新打标语料样例（不做完整打标）`}
              />
            )}
            <QuoteImportPreviewTable
              rows={taggingPreviewRows}
              emptyText={
                ticketSource && !columnMap.rawText && !columnMap.handlingText
                  ? '请先映射受理内容或处理意见列'
                  : '暂无可用样例行'
              }
            />
            {isConsultation && (
              <Alert
                className="!mt-3"
                type="info"
                showIcon
                title="咨询工单导入说明"
                description="导入完成后请到「洞察工作台 → 咨询工单」查看；在工作台将周期切换到与本批「数据月份」一致的月份即可看到分析。"
              />
            )}
            <div className="page-section-sm page-grid-2">
              {STANDARD_FIELDS.filter((f) =>
                ticketSource ? true : ['createdAt', 'productSpec', 'rawText', 'handlingText', 'ticketId', 'source'].includes(f.key),
              ).map(({ key, label, required, hint }) => (
                <div key={key}>
                  <Typography.Text strong className="mb-1 block text-xs">
                    {label}
                    {required && ticketSource && <span className="text-red-500"> *</span>}
                  </Typography.Text>
                  {hint && (
                    <Typography.Text type="secondary" className="mb-1 block text-[11px] leading-snug">
                      {hint}
                    </Typography.Text>
                  )}
                  <Select
                    className="w-full"
                    value={columnMap[key] || ''}
                    options={[
                      { label: '— 不映射 —', value: '' },
                      ...headers.map((h) => ({ label: h, value: h })),
                    ]}
                    onChange={(value) => setColumnMap((m) => ({ ...m, [key]: value }))}
                    showSearch
                    optionFilterProp="label"
                  />
                </div>
              ))}
              {!ticketSource && (
                <>
                  <div>
                    <Typography.Text strong className="mb-1 block text-xs">
                      评价/评论列
                    </Typography.Text>
                    <Select
                      className="w-full"
                      value={columnMap.commentText || ''}
                      options={[
                        { label: '— 不映射 —', value: '' },
                        ...headers.map((h) => ({ label: h, value: h })),
                      ]}
                      onChange={(value) => setColumnMap((m) => ({ ...m, commentText: value }))}
                    />
                  </div>
                  <div>
                    <Typography.Text strong className="mb-1 block text-xs">
                      开放回答列
                    </Typography.Text>
                    <Select
                      className="w-full"
                      value={columnMap.openText || ''}
                      options={[
                        { label: '— 不映射 —', value: '' },
                        ...headers.map((h) => ({ label: h, value: h })),
                      ]}
                      onChange={(value) => setColumnMap((m) => ({ ...m, openText: value }))}
                    />
                  </div>
                </>
              )}
            </div>
            {ticketSource && (
              <div className="mt-5 border-t border-ink-100 pt-4">
                <Typography.Text strong className="text-xs">
                  合并到主文本的附加列
                </Typography.Text>
                <Space wrap className="mt-2">
                  {MERGE_OPTIONS.filter((c) => headers.includes(c)).map((col) => (
                    <Checkbox
                      key={col}
                      checked={rawTextMerge.includes(col)}
                      onChange={() => toggleMerge(col)}
                    >
                      {col}
                    </Checkbox>
                  ))}
                </Space>
              </div>
            )}
              </>
            )}
          </Card>
          <Space>
            <Button onClick={() => setStep(1)}>上一步</Button>
            <Button
              type="primary"
              disabled={!canProceedFromColumnMapping}
              onClick={() => setStep(3)}
            >
              下一步：预览
            </Button>
          </Space>
        </div>
      )}

      {step === 3 && (
        <div className="page-section space-y-5">
          <Card>
            <Typography.Title level={5} className="!mb-0">
              预览确认
            </Typography.Title>
            {followUpImport ? (
              <>
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  按原工单号匹配投诉/咨询工单并补全回访满意度；不会新建用后即评独立记录，也不会触发打标流水线。
                </Typography.Text>
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  数据月份：{importMonthDisplay} · 来源：{DATA_SOURCE_LABELS[dataSourceType]} ·
                  二级分类：满意度回访
                </Typography.Text>
                <div className="page-section-sm">
                  <FollowUpSatisfactionImportPreview
                    preview={followUpPreview}
                    loading={followUpPreviewLoading}
                    error={followUpPreviewError}
                  />
                </div>
              </>
            ) : (
              <>
            <Typography.Text type="secondary" className="mt-1 block text-xs">
              下方展示打标语料样例（最多 3 条）。确认导入后将先完成规则初标（客户请求、需求痛点、四维、优化建议），再依次增强：请求场景与问题类型（本地）→ 客户请求/需求痛点/优化建议（配置 API Key 时 LLM）→ 请求场景与问题类型（LLM 语料，默认开）→ 用户旅程 → 用户情绪。
            </Typography.Text>
            <Typography.Text type="secondary" className="mt-1 block text-xs">
              数据月份：{importMonthDisplay} · 来源：{DATA_SOURCE_LABELS[dataSourceType]}
            </Typography.Text>
            <div className="page-section-sm page-grid-2">
              <div>
                <Typography.Text strong className="mb-1 block text-xs">
                  数据月份
                </Typography.Text>
                <InsightMonthPicker
                  className="w-full"
                  value={importMonth}
                  onChange={setImportMonth}
                />
              </div>
              <div>
                <Typography.Text strong className="mb-1 block text-xs">
                  导入批次名称
                </Typography.Text>
                <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} />
              </div>
            </div>
            <QuoteImportPreviewTable
              rows={taggingPreviewRows}
              emptyText="无样例行（请检查列映射与产品范围）"
            />
              </>
            )}
          </Card>
          <Space>
            <Button onClick={() => setStep(2)}>上一步</Button>
            {followUpImport ? (
              <Button
                type="primary"
                disabled={!canImport || !storageReady || importBlocked || importBusy}
                loading={importBusy || followUpPreviewLoading}
                onClick={confirmFollowUpImport}
              >
                {importBusy
                  ? importProgress || '导入中…'
                  : followUpPreviewLoading
                    ? '预览加载中…'
                    : `确认导入回访 ${followUpPreview?.appliedRowCount ?? 0} 行`}
              </Button>
            ) : (
              <Button
                type="primary"
                disabled={!canImport || !storageReady || importBlocked || importBusy}
                loading={importBusy}
                onClick={() => doImport(false)}
              >
                {importBusy
                  ? importProgress || '导入中…'
                  : !storageReady
                    ? '存储初始化中…'
                    : `确认导入并打标 ${catalogPartition.stats.accepted} 条`}
              </Button>
            )}
          </Space>
        </div>
      )}

      {step === 4 && followUpImportResult && (
        <Card className="page-section">
          <Result
            status={followUpImportResult.summary.updatedRecordCount > 0 ? 'success' : 'warning'}
            title="满意度回访导入完成"
            subTitle={formatFollowUpImportSummaryDescription(followUpImportResult.summary)}
            extra={
              <Space wrap>
                <Button type="primary" onClick={() => navigate('/workbench?tab=post_use_rating')}>
                  打开洞察工作台
                </Button>
                <Button
                  onClick={() =>
                    navigate(
                      `/feedbacks?followUp=has&month=${followUpImportResult.dataMonth || importMonth}`,
                    )
                  }
                >
                  查看有回访的工单
                </Button>
                {followUpImportResult.summary.unmatched.length > 0 && (
                  <Button
                    onClick={() =>
                      downloadUnmatchedFollowUpCsv(followUpImportResult.summary.unmatched)
                    }
                  >
                    下载未匹配 CSV
                  </Button>
                )}
                <Button
                  onClick={() => {
                    resetFileState()
                    setFollowUpImportResult(null)
                    setStep(0)
                    setError('')
                  }}
                >
                  继续导入
                </Button>
              </Space>
            }
          />
          <Typography.Text type="secondary" className="block text-center text-xs">
            数据月份 {followUpImportResult.dataMonth} · 已补全投诉/咨询工单回访字段
          </Typography.Text>
        </Card>
      )}

      {step === 4 && importResult && (
        <Card className="page-section">
          <Result
            status={
              importResult.run.status === 'succeeded'
                ? 'success'
                : importResult.run.status === 'partial_failed'
                  ? 'warning'
                  : 'error'
            }
            title="导入完成"
            subTitle={
              <>
                分析产出 {importResult.records.length} 条
                {importResult.run.total > importResult.records.length &&
                  `（共 ${importResult.run.total} 行，${importResult.run.failureCount} 行未产出记录）`}
                {importResult.ingest != null && (
                  <>
                    {' '}
                    · 本次新增入库 {importResult.ingest.added} 条
                    {importResult.ingest.skippedDuplicates > 0 &&
                      `（与库内重复跳过 ${importResult.ingest.skippedDuplicates} 条）`}
                    {' '}
                    · 库内合计 {importResult.ingest.totalAfter} 条
                  </>
                )}
                {importResult.failures.length > 0 &&
                  ` · 失败 ${importResult.failures.length} 条`}
                {importResult.skipped > 0 && ` · 跳过非目标产品 ${importResult.skipped} 条`}
              </>
            }
            extra={
              <Space wrap>
                <Button
                  type="primary"
                  onClick={() =>
                    navigate(
                      `/workbench?tab=${importResult.dataSourceType || dataSourceType}`
                    )
                  }
                >
                  打开洞察工作台
                </Button>
                <Button
                  onClick={() =>
                    navigate(
                      `/feedbacks?source=${importResult.dataSourceType || dataSourceType}&month=${importResult.dataMonth || importMonth}`,
                    )
                  }
                >
                  查看反馈库
                </Button>
                {importResult.failures.length > 0 && (
                  <Button onClick={() => downloadFailuresCsv(importResult.failures)}>
                    下载失败报告 CSV
                  </Button>
                )}
                <Button
                  onClick={() => {
                    resetFileState()
                    setStep(0)
                    setError('')
                  }}
                >
                  继续导入
                </Button>
              </Space>
            }
          />
          <Typography.Text type="secondary" className="block text-center text-xs">
            数据月份 {importResult.dataMonth} · 已写入反馈库并完成打标 · 已刷新该月洞察快照 · Run ID：
            {importResult.run.id}
          </Typography.Text>
          {importResult.enrichmentStats && (
            <Typography.Text type="secondary" className="block text-center text-xs">
              LLM 增强：工单完成 {importResult.enrichmentStats.ticketLlmCompleted} 条
              {importResult.enrichmentStats.ticketLlmFailed > 0
                ? `，未完成 ${importResult.enrichmentStats.ticketLlmFailed} 条`
                : ''}
              ；旅程 LLM {importResult.enrichmentStats.journeyLlmCompleted} 条
              {importResult.enrichmentStats.journeySkippedByGating > 0
                ? `，门控跳过 ${importResult.enrichmentStats.journeySkippedByGating} 条`
                : ''}
            </Typography.Text>
          )}
          {importResult.enrichmentStats?.ticketLlmFailed > 0 && (
            <Alert
              className="page-section-sm"
              type="warning"
              showIcon
              title="部分工单 LLM 增强未生效"
              description={formatTicketLlmRemainRuleMessage(importResult.enrichmentStats.ticketLlmFailed)}
            />
          )}
          {(() => {
            const ticketLlmWarning = formatTicketLlmRemainRuleMessage(
              importResult.enrichmentStats?.ticketLlmFailed ?? 0,
            )
            const otherTaggingWarnings =
              importResult.taggingWarnings?.filter((w) => w !== ticketLlmWarning) ?? []
            if (!otherTaggingWarnings.length) return null
            return (
              <Alert
                className="page-section-sm"
                type="warning"
                showIcon
                title="部分打标步骤未完全成功"
                description={
                  <ul className="mb-0 list-disc pl-5">
                    {otherTaggingWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                }
              />
            )
          })()}
          {importResult.dataSourceType === 'consultation_ticket' && (
            <Alert
              className="page-section-sm"
              type="success"
              showIcon
              title="查看咨询工单分析"
              description={`工作台左侧选择「咨询工单」Tab 查看图表。导入时已自动刷新 ${importResult.dataMonth} 洞察快照；若周期与工作台不一致，请切换周期后查看。反馈库中已有 ${importResult.records.length} 条咨询工单。`}
            />
          )}
        </Card>
      )}
    </div>
  )
}
