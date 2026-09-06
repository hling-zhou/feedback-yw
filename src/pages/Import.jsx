import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
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
  IMPORT_PARSE_ERROR_CODES,
  PRIMARY_TICKET_ID_HEADERS,
} from '../lib/parseFile.js'
import {
  getPresetsForImport,
  SATISFACTION_CALLBACK_PRESET,
  POST_USE_CUSTOMER_VISIT_PRESET,
} from '../lib/columnPresets.js'
import { enrichTicketRecordsForImport } from '../lib/importEnrichment.js'
import { formatTicketLlmRemainRuleMessage } from '../lib/importEnrichmentStats.js'
import { filterDuplicateImportRows } from '../lib/importDedupe.js'
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
  MAX_FILE_BYTES,
} from '../lib/importUtils.js'
import {
  POST_USE_RATING_SUBTYPE_OPTIONS,
  POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE,
  isFollowUpSatisfactionImport,
  isPostUseChannelBundleImport,
  isCustomerVisitImport,
  isPostUseRatingLibraryRecord,
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
import PostUseChannelBundleImport from '../components/import/PostUseChannelBundleImport.jsx'
import {
  executePostUseChannelImport,
  formatPostUseChannelImportProgress,
  previewPostUseChannelImport,
  POST_USE_CHANNEL_IMPORT_SESSION_LABEL,
} from '../lib/postUseRating/importSession.js'
import {
  executeCustomerVisitImport,
  runCustomerVisitImportDryRun,
} from '../lib/postUseRating/customerVisitImport.js'

const CUSTOMER_VISIT_IMPORT_SESSION_LABEL = '客服回访导入'
import { isApiStorageAdapter } from '../storage/feedbackStore.js'
import { isStubPipeline } from '../analysis/registry.js'
import { randomId } from '../lib/randomId.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { downloadFailuresCsv } from '../lib/export.js'
import { buildTaggingPreviewRows, rowHasQuoteSourceText } from '../lib/importPreview.js'
import QuoteImportPreviewTable from '../components/QuoteImportPreviewTable.jsx'
import {
  MAX_IMPORT_FILES,
  MAX_ROWS_PER_FILE,
  MAX_ROWS_BATCH_TOTAL,
  combineImportFileSha256,
  mergeParsedUploadFiles,
} from '../lib/importBatchFiles.js'
import { displayImportFileName, parseImportFileNamePassword } from '../lib/importFilePassword.js'
import { IMPORT_ALREADY_IN_PROGRESS_TIP } from '../lib/importSession.js'

/** @typedef {import('../lib/importBatchFiles.js').ParsedUploadFile} ParsedUploadFile */

const STEPS = ['来源与月份', '上传文件', '列映射', '预览确认', '导入完成']
/** 用后即评双渠道：无列映射，预览确认独立成步 */
const STEPS_POST_USE = ['来源与月份', '上传文件', '预览确认', '导入完成']

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

/**
 * @param {File} file
 */
function channelFileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

/**
 * @param {unknown} err
 */
function isPasswordPromptError(err) {
  const code = err && typeof err === 'object' ? /** @type {{ code?: string }} */ (err).code : ''
  return (
    code === IMPORT_PARSE_ERROR_CODES.PASSWORD_REQUIRED ||
    code === IMPORT_PARSE_ERROR_CODES.PASSWORD_INCORRECT
  )
}

export default function Import({ embedded = false }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialSource = searchParams.get('source')
  const initialSubType = searchParams.get('subType')
  const importUrlKey = `${initialSource || ''}|${initialSubType || ''}`
  const appliedImportUrlRef = useRef(importUrlKey)
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
    feedbacks,
  } = useInsights()
  const { importBlocked, importBlockedTip } = useSharedBackgroundTaskBlock()

  const [dataSourceType, setDataSourceType] = useState(() => {
    if (initialSource && DATA_SOURCE_TYPES.includes(initialSource)) {
      return /** @type {import('../domain/enums.js').DataSourceType} */ (initialSource)
    }
    return 'complaint_ticket'
  })
  const [postUseRatingSubType, setPostUseRatingSubType] = useState(() => {
    const fromUrl = POST_USE_RATING_SUBTYPE_OPTIONS.find((o) => o.value === initialSubType)
    return fromUrl ? fromUrl.value : POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE
  })
  const [step, setStep] = useState(0)
  /** @type {[null | { recordCount: number; counts?: object; deletedPrior?: number; importBatchId?: string }, Function]} */
  const [channelBundleResult, setChannelBundleResult] = useState(null)
  /** @type {[File[], Function]} */
  const [channelSmsFiles, setChannelSmsFiles] = useState([])
  /** @type {[File[], Function]} */
  const [channelWebFiles, setChannelWebFiles] = useState([])
  const [channelPreview, setChannelPreview] = useState(null)
  const [channelPreviewBusy, setChannelPreviewBusy] = useState(false)
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
    /** @type {null | { run: import('../domain/analysisRun.js').AnalysisRun; records: object[]; failures: import('../domain/analysisRun.js').AnalysisRunFailure[]; skipped: number; dataMonth?: string; dataSourceType?: string; taggingWarnings?: string[]; enrichmentStats?: import('../lib/importEnrichmentStats.js').ImportEnrichmentStats; ingest?: { added: number; updated?: number; skippedDuplicates: number; totalAfter: number } }} */ (
      null
    ),
  )
  /** @type {[import('../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary | null, Function]} */
  const [followUpPreview, setFollowUpPreview] = useState(null)
  const [followUpPreviewError, setFollowUpPreviewError] = useState('')
  const [followUpPreviewLoading, setFollowUpPreviewLoading] = useState(false)
  /** @type {[null | { summary: import('../lib/followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary; dataMonth: string }, Function]} */
  const [followUpImportResult, setFollowUpImportResult] = useState(null)
  /** @type {[ReturnType<typeof runCustomerVisitImportDryRun> | null, Function]} */
  const [customerVisitPreview, setCustomerVisitPreview] = useState(null)
  const [customerVisitPreviewError, setCustomerVisitPreviewError] = useState('')
  const [customerVisitPreviewLoading, setCustomerVisitPreviewLoading] = useState(false)
  /** @type {[null | { dry: ReturnType<typeof runCustomerVisitImportDryRun>; dataMonth: string }, Function]} */
  const [customerVisitImportResult, setCustomerVisitImportResult] = useState(null)
  const [passwordPrompt, setPasswordPrompt] = useState({
    open: false,
    file: /** @type {File | null} */ (null),
    fileId: '',
    sheetName: '',
    password: '',
    error: '',
    purpose: /** @type {'upload' | 'channel'} */ ('upload'),
  })
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const channelPasswordsRef = useRef(/** @type {Record<string, string>} */ ({}))
  const goChannelBundlePreviewRef = useRef(async () => {})

  const importMonthDisplay = useMemo(() => {
    const normalized = normalizeImportMonth(importMonth)
    if (!normalized) return importMonth?.trim() || '未选择'
    const [y, m] = normalized.split('-')
    return `${y}年${Number(m)}月（${normalized}）`
  }, [importMonth])

  const ticketSource = isTicketSource(dataSourceType)
  const followUpImport = isFollowUpSatisfactionImport(dataSourceType, postUseRatingSubType)
  const customerVisitImport = isCustomerVisitImport(dataSourceType, postUseRatingSubType)
  const channelBundleImport = isPostUseChannelBundleImport(dataSourceType, postUseRatingSubType)
  const singleFileEnrichImport = followUpImport
  const stepItems = useMemo(() => {
    if (channelBundleImport) return STEPS_POST_USE.map((title) => ({ title }))
    return STEPS.map((title) => ({ title }))
  }, [channelBundleImport])
  const stepsCurrent = useMemo(() => {
    if (!channelBundleImport) return step
    // 0 来源 → 1 上传 → 2 预览确认 → 完成（内部仍用 step===4，映射到 UI 第 4 步）
    if (step >= 4) return 3
    if (step <= 0) return 0
    if (step === 1) return 1
    return 2
  }, [channelBundleImport, step])
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
    setCustomerVisitPreview(null)
    setCustomerVisitPreviewError('')
    setCustomerVisitImportResult(null)
    setChannelBundleResult(null)
    setChannelSmsFiles([])
    setChannelWebFiles([])
    setChannelPreview(null)
    setChannelPreviewBusy(false)
    channelPasswordsRef.current = {}
  }, [])

  const writeImportSourceToUrl = useCallback(
    (source, subType) => {
      const nextSubType =
        source === 'post_use_rating' ? subType || POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE : ''
      appliedImportUrlRef.current = `${source}|${nextSubType}`
      const next = new URLSearchParams(searchParams)
      next.set('source', source)
      if (source === 'post_use_rating') {
        next.set('subType', nextSubType)
      } else {
        next.delete('subType')
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (appliedImportUrlRef.current === importUrlKey) return
    appliedImportUrlRef.current = importUrlKey
    if (!initialSource || !DATA_SOURCE_TYPES.includes(initialSource)) return
    const nextSource = /** @type {import('../domain/enums.js').DataSourceType} */ (initialSource)
    setDataSourceType(nextSource)
    if (nextSource === 'post_use_rating') {
      const fromUrl = POST_USE_RATING_SUBTYPE_OPTIONS.find((item) => item.value === initialSubType)
      setPostUseRatingSubType(fromUrl ? fromUrl.value : POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE)
    }
    resetFileState()
    setStep(0)
    setError('')
  }, [importUrlKey, initialSource, initialSubType, resetFileState])


  const parseFileToEntry = useCallback(
    /**
     * @param {File} file
     * @param {string} [sheetName]
     * @param {string} [password]
     */
    async (file, sheetName, password) => {
      const fileCheck = validateImportFile(file)
      if (!fileCheck.ok) throw new Error(fileCheck.message)

      const fromName = parseImportFileNamePassword(file.name)
      const resolvedPassword = password || fromName.password || undefined
      const headerMarker = isTicketSource(dataSourceType) ? PRIMARY_TICKET_ID_HEADERS[0] : undefined
      const sha256 = await hashFileSha256(file)
      const first = await parseUploadFile(file, { password: resolvedPassword, headerMarker })
      if (!first.headers.length || !first.rows.length) {
        throw new Error('文件为空或无法解析')
      }

      const names = first.sheetNames?.length ? first.sheetNames : []
      const selected =
        sheetName || (names.length ? preferredSheetName(dataSourceType, names) : '') || ''

      let headers = first.headers
      let rows = first.rows

      if (names.length && selected) {
        const parsed = await parseUploadFile(file, {
          sheetName: selected,
          password: resolvedPassword,
          headerMarker,
        })
        if (!parsed.headers.length || !parsed.rows.length) {
          throw new Error(`工作表「${selected}」为空`)
        }
        headers = parsed.headers
        rows = parsed.rows
      }

      const rowCheck = validateRowCount(rows.length)
      if (!rowCheck.ok) throw new Error(`${fromName.displayName}：${rowCheck.message}`)

      return /** @type {ParsedUploadFile} */ ({
        id: randomId(),
        file,
        sha256,
        sheetNames: names,
        selectedSheet: selected,
        headers,
        rows,
        requiresPassword: Boolean(resolvedPassword),
        password: resolvedPassword,
      })
    },
    [dataSourceType],
  )

  const openPasswordPrompt = useCallback(
    (file, fileId = '', sheetName = '', purpose = 'upload', error = '') => {
      setPasswordPrompt({
        open: true,
        file,
        fileId,
        sheetName,
        password: '',
        error,
        purpose,
      })
    },
    [],
  )

  const closePasswordPrompt = useCallback(() => {
    setPasswordPrompt({
      open: false,
      file: null,
      fileId: '',
      sheetName: '',
      password: '',
      error: '',
      purpose: 'upload',
    })
    setPasswordSubmitting(false)
  }, [])

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
        setError(`「${displayImportFileName(file.name)}」已在列表中`)
        return
      }
      setError('')
      setLoading(true)
      try {
        const entry = await parseFileToEntry(file)
        setUploadFiles((prev) => [...prev, entry])
      } catch (e) {
        if (isPasswordPromptError(e)) {
          openPasswordPrompt(
            file,
            '',
            '',
            'upload',
            e?.code === IMPORT_PARSE_ERROR_CODES.PASSWORD_INCORRECT ? e.message : '',
          )
        } else {
          setError(e.message || '解析失败')
        }
      } finally {
        setLoading(false)
      }
    },
    [uploadFiles, parseFileToEntry, openPasswordPrompt],
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
        const next = await parseFileToEntry(entry.file, sheetName, entry.password)
        setUploadFiles((prev) => prev.map((f) => (f.id === id ? { ...next, id } : f)))
      } catch (e) {
        if (isPasswordPromptError(e)) {
          openPasswordPrompt(entry.file, id, sheetName, 'upload')
        } else {
          setError(e.message || '切换工作表失败')
        }
      } finally {
        setLoading(false)
      }
    },
    [uploadFiles, parseFileToEntry, openPasswordPrompt],
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
      if (customerVisitImport) {
        if (!mapping.preset || mapping.preset.id !== POST_USE_CUSTOMER_VISIT_PRESET.id) {
          throw new Error(
            '表头需包含客服部回访模板列：数据月份、客户名称、客户编码、产品名称、回访结果、内部评估',
          )
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
  }, [uploadFiles, dataSourceType, followUpImport, customerVisitImport, mappingOptions])

  const uploadTotalRows = useMemo(
    () => uploadFiles.reduce((n, f) => n + f.rows.length, 0),
    [uploadFiles],
  )

  const onSourceChange = (value) => {
    setDataSourceType(value)
    const nextSubType =
      value === 'post_use_rating' ? POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE : postUseRatingSubType
    if (value === 'post_use_rating') {
      setPostUseRatingSubType(POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE)
    }
    resetFileState()
    setStep(0)
    setError('')
    writeImportSourceToUrl(value, nextSubType)
  }

  const onPostUseRatingSubTypeChange = (value) => {
    setPostUseRatingSubType(value)
    resetFileState()
    setStep(0)
    setError('')
    writeImportSourceToUrl(dataSourceType, value)
  }

  const onSheetChange = async (sheetName) => {
    if (uploadFiles.length !== 1 || !sheetName) return
    setError('')
    setLoading(true)
    try {
      const entry = uploadFiles[0]
      const next = await parseFileToEntry(entry.file, sheetName, entry.password)
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
      if (isPasswordPromptError(e)) {
        openPasswordPrompt(uploadFiles[0].file, uploadFiles[0].id, sheetName, 'upload')
      } else {
        setError(e.message || '切换工作表失败')
      }
    } finally {
      setLoading(false)
    }
  }

  const submitPasswordPrompt = useCallback(async () => {
    if (!passwordPrompt.file) return
    setPasswordSubmitting(true)
    setError('')
    try {
      if (passwordPrompt.purpose === 'channel') {
        channelPasswordsRef.current[channelFileKey(passwordPrompt.file)] = passwordPrompt.password
        closePasswordPrompt()
        await goChannelBundlePreviewRef.current()
        return
      }
      const entry = await parseFileToEntry(
        passwordPrompt.file,
        passwordPrompt.sheetName || undefined,
        passwordPrompt.password,
      )
      if (passwordPrompt.fileId) {
        setUploadFiles((prev) =>
          prev.map((item) =>
            item.id === passwordPrompt.fileId ? { ...entry, id: passwordPrompt.fileId } : item,
          ),
        )
      } else {
        setUploadFiles((prev) => [...prev, entry])
      }
      closePasswordPrompt()
    } catch (err) {
      const message = err instanceof Error ? err.message : '解析失败'
      setPasswordPrompt((prev) => ({ ...prev, error: message }))
    } finally {
      setPasswordSubmitting(false)
    }
  }, [passwordPrompt, parseFileToEntry, closePasswordPrompt])

  const clearUploadFilePasswords = useCallback(() => {
    setUploadFiles((prev) =>
      prev.map(({ password, requiresPassword, ...item }) => ({ ...item })),
    )
  }, [])

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
      : customerVisitImport
        ? Boolean(
            customerVisitPreview &&
              !customerVisitPreviewLoading &&
              !customerVisitPreviewError &&
              (customerVisitPreview.visitMetaCount > 0 ||
                customerVisitPreview.matchedCount > 0),
          )
        : catalogPartition.inScope.length > 0

  const canProceedFromColumnMapping = followUpImport
    ? activePreset?.id === SATISFACTION_CALLBACK_PRESET.id
    : customerVisitImport
      ? activePreset?.id === POST_USE_CUSTOMER_VISIT_PRESET.id
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

  /** 导入页挂载标记：离开 /import 后勿再 setStep / setChannelBundleResult */
  const importPageMountedRef = useRef(true)
  useEffect(() => {
    importPageMountedRef.current = true
    return () => {
      importPageMountedRef.current = false
    }
  }, [])

  /**
   * 用后即评：解析预览后进入「预览确认」步。
   */
  const goChannelBundlePreview = async () => {
    if (!channelSmsFiles.length || !channelWebFiles.length) {
      setError('请同时选择短信渠道与官网渠道文件')
      return
    }
    const dataMonth = normalizeImportMonth(importMonth)
    if (!dataMonth) {
      setError('请先选择有效的数据月份')
      return
    }
    setChannelPreviewBusy(true)
    setError('')
    try {
      const resolvePassword = (file) =>
        channelPasswordsRef.current[channelFileKey(file)] ||
        parseImportFileNamePassword(file.name).password ||
        ''
      const smsPasswords = channelSmsFiles.map(resolvePassword)
      const officialPasswords = channelWebFiles.map(resolvePassword)
      const [smsBuffers, officialBuffers] = await Promise.all([
        Promise.all(channelSmsFiles.map((file) => file.arrayBuffer())),
        Promise.all(channelWebFiles.map((file) => file.arrayBuffer())),
      ])
      const preview = await previewPostUseChannelImport(smsBuffers, officialBuffers, {
        importMonth: dataMonth,
        smsPasswords,
        officialPasswords,
      })
      setChannelPreview(preview)
      setStep(2)
    } catch (e) {
      if (isPasswordPromptError(e)) {
        const files = e.channel === 'sms' ? channelSmsFiles : channelWebFiles
        const file = files[e.fileIndex]
        if (file) {
          openPasswordPrompt(
            file,
            '',
            '',
            'channel',
            e?.code === IMPORT_PARSE_ERROR_CODES.PASSWORD_INCORRECT ? e.message : '',
          )
          setChannelPreview(null)
          return
        }
      }
      setChannelPreview(null)
      setError(e.message || '预览失败')
    } finally {
      setChannelPreviewBusy(false)
    }
  }
  goChannelBundlePreviewRef.current = goChannelBundlePreview

  /**
   * 用后即评双文件确认导入：与 doImport 同级编排后台会话，卸载组件后仍可收尾。
   * @param {{ smsFiles?: File[]; webFiles?: File[]; importMonth: string }} [payload]
   */
  const doChannelBundleImport = async (payload) => {
    const smsFiles = payload?.smsFiles || channelSmsFiles
    const webFiles = payload?.webFiles || channelWebFiles
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
      if (!smsFiles.length || !webFiles.length) {
        throw new Error('请同时选择短信渠道与官网渠道文件')
      }
      if (!channelPreview) {
        throw new Error('请先完成解析预览')
      }
      const dataMonth = normalizeImportMonth(payload?.importMonth || importMonth)
      if (!dataMonth) {
        throw new Error('请选择有效的数据月份（YYYY-MM）')
      }

      const progress0 = '正在解析双文件…'
      await prepareSharedBackgroundTask('import', {
        progress: progress0,
        meta: {
          importKind: 'postUseChannel',
          importMonth: dataMonth,
          dataSourceType: 'post_use_rating',
        },
      })
      beginImportSession({
        batchName: POST_USE_CHANNEL_IMPORT_SESSION_LABEL,
        dataMonth,
        dataSourceType: 'post_use_rating',
        kind: 'analysis',
        progress: progress0,
      })
      reportProgress(progress0)

      const resolvePassword = (file) =>
        channelPasswordsRef.current[channelFileKey(file)] ||
        parseImportFileNamePassword(file.name).password ||
        ''
      const [smsBuffers, officialBuffers] = await Promise.all([
        Promise.all(smsFiles.map((file) => file.arrayBuffer())),
        Promise.all(webFiles.map((file) => file.arrayBuffer())),
      ])

      const res = await executePostUseChannelImport({
        adapter,
        smsBuffers,
        officialBuffers,
        importMonth: dataMonth,
        smsFileNames: smsFiles.map((file) => displayImportFileName(file.name)),
        officialFileNames: webFiles.map((file) => displayImportFileName(file.name)),
        smsPasswords: smsFiles.map(resolvePassword),
        officialPasswords: webFiles.map(resolvePassword),
        onProgress: (p) => {
          reportProgress(formatPostUseChannelImportProgress(p))
        },
      })

      if (isApiStorageAdapter(adapter)) {
        reportProgress(formatPostUseChannelImportProgress({ phase: 'sync' }))
        await syncSharedDataFromServer({ notify: false })
      }

      try {
        reportProgress(formatPostUseChannelImportProgress({ phase: 'snapshot' }))
        await rebuildSnapshotsForImportMonth(dataMonth)
      } catch (snapErr) {
        console.warn('[import] post-use channel snapshot rebuild:', snapErr)
      }

      notifyImportFinished({
        dataMonth,
        dataSourceType: 'post_use_rating',
        added: res.recordCount,
        batchName: POST_USE_CHANNEL_IMPORT_SESSION_LABEL,
      })
      importFinishedNotified = true

      if (importPageMountedRef.current) {
        setChannelBundleResult(res)
        setStep(4)
      }
    } catch (e) {
      if (importPageMountedRef.current) {
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

  useEffect(() => {
    if (step !== 3 || !customerVisitImport || !mappedAll.length || !storageReady) return
    let cancelled = false
    setCustomerVisitPreviewLoading(true)
    setCustomerVisitPreviewError('')
    setCustomerVisitPreview(null)
    void (async () => {
      try {
        let libraryRecords = []
        if (typeof adapter?.listRecords === 'function') {
          const listed = await adapter.listRecords({})
          libraryRecords = (listed?.records || []).filter(isPostUseRatingLibraryRecord)
        } else {
          libraryRecords = (feedbacks || []).filter(isPostUseRatingLibraryRecord)
        }
        const dry = runCustomerVisitImportDryRun({
          rows: mappedAll,
          libraryRecords,
        })
        if (!cancelled) setCustomerVisitPreview(dry)
      } catch (err) {
        if (!cancelled) {
          setCustomerVisitPreviewError(
            readBackgroundTaskErrorMessage(err) || err.message || '预览失败',
          )
        }
      } finally {
        if (!cancelled) setCustomerVisitPreviewLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [step, customerVisitImport, mappedAll, adapter, feedbacks, storageReady])

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

  const loadPostUseLibraryRecords = async () => {
    if (typeof adapter?.listRecords === 'function') {
      const listed = await adapter.listRecords({})
      return (listed?.records || []).filter(isPostUseRatingLibraryRecord)
    }
    return (feedbacks || []).filter(isPostUseRatingLibraryRecord)
  }

  const doCustomerVisitImport = async () => {
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
      if (!customerVisitPreview?.visitMetaCount && !customerVisitPreview?.matchedCount) {
        throw new Error('没有可导入的回访行')
      }

      const dataMonth = normalizeImportMonth(importMonth)
      if (!dataMonth) {
        throw new Error('请选择有效的数据月份（YYYY-MM）')
      }

      const progress0 = '正在导入客服回访…'
      await prepareSharedBackgroundTask('import', {
        progress: progress0,
        meta: {
          importKind: 'customerVisit',
          importMonth: dataMonth,
          dataSourceType: 'post_use_rating',
        },
      })
      beginImportSession({
        batchName: CUSTOMER_VISIT_IMPORT_SESSION_LABEL,
        dataMonth,
        dataSourceType: 'post_use_rating',
        kind: 'analysis',
        progress: progress0,
      })
      reportProgress(progress0)

      const importBatchId = `visit-${dataMonth}-${Date.now()}`
      const libraryRecords = await loadPostUseLibraryRecords()
      reportProgress('正在匹配用后即评明细并写入回访…')

      const dry = await executeCustomerVisitImport({
        adapter,
        rows: mappedAll,
        libraryRecords,
        importBatchId,
        putRecords: (recs) => adapter.putRecords(recs),
      })

      if (isApiStorageAdapter(adapter)) {
        reportProgress('正在同步数据…')
        await syncSharedDataFromServer({ notify: false })
      }

      notifyImportFinished({
        dataMonth,
        dataSourceType: 'post_use_rating',
        added: dry.matchedCount,
        batchName: CUSTOMER_VISIT_IMPORT_SESSION_LABEL,
      })
      importFinishedNotified = true

      if (importPageMountedRef.current) {
        setCustomerVisitImportResult({ dry, dataMonth })
        setStep(4)
      }
    } catch (e) {
      if (importPageMountedRef.current) {
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

  const confirmCustomerVisitImport = () => {
    if (!customerVisitPreview?.visitMetaCount && !customerVisitPreview?.unmatched?.length) {
      setError('没有可导入的数据行')
      return
    }
    Modal.confirm({
      title: '确认导入客服回访？',
      content: (
        <>
          将写入回访元数据，并软匹配挂到短信/控制台用后即评明细的 <code>customerVisit</code> 字段。
          <br />
          回访元数据 <strong>{customerVisitPreview?.visitMetaCount ?? 0}</strong> 条 · 匹配挂接{' '}
          <strong>{customerVisitPreview?.matchedCount ?? 0}</strong> 条 · 未匹配{' '}
          <strong>{customerVisitPreview?.unmatched?.length ?? 0}</strong> 行。
        </>
      ),
      okText: '确认导入',
      cancelText: '取消',
      onOk: () => doCustomerVisitImport(),
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

      let rowsToAnalyze = inScope
      let dedupeSkippedCount = 0
      if (ticketSource) {
        const deduped = filterDuplicateImportRows(inScope, { dataSourceType })
        rowsToAnalyze = deduped.uniqueRows
        dedupeSkippedCount = deduped.skippedCount
        if (!rowsToAnalyze.length) {
          throw new Error('没有可导入的有效行，请检查列映射与工单号')
        }
      }

      reportProgress(`正在规则初标 (0/${rowsToAnalyze.length})…`)

      let records
      let failures
      let run
      /** @type {string[]} */
      let taggingWarnings = []
      /** @type {import('../lib/importEnrichmentStats.js').ImportEnrichmentStats | undefined} */
      let enrichmentStats

      if (ticketSource) {
        const result = await runPipeline(dataSourceType, rowsToAnalyze, batchMeta)
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
        const result = await runPipeline(dataSourceType, rowsToAnalyze, batchMeta)
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

      const totalSkippedDuplicates = dedupeSkippedCount + (ingest.skippedDuplicates || 0)

      notifyImportFinished({
        dataMonth,
        dataSourceType,
        added: ingest.added,
        updated: ingest.updated || 0,
        skippedDuplicates: totalSkippedDuplicates,
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
        ingest: {
          ...ingest,
          updated: ingest.updated || 0,
          skippedDuplicates: totalSkippedDuplicates,
        },
      })
      clearUploadFilePasswords()
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
          desc="选择数据来源与数据月份；投诉/咨询走打标流水线，用后即评默认导入短信+官网渠道文件（各最多 5 个）"
        />
      )}

      <Steps className="page-section" current={stepsCurrent} items={stepItems} />

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
              {channelBundleImport && (
                <Typography.Text type="secondary" className="mt-2 block text-xs">
                  默认导入短信渠道 + 官网渠道文件（各最多 {MAX_IMPORT_FILES} 个；官网含评分类 / 选项类 / 投诉处理-电话回访）。短信按「调研结果状态」、官网评分类 / 选项类按「产品名」、投诉处理-电话回访按「回访工单编号」识别表头。投诉回访同时写入明细并补全已有工单。加密文件可把密码写在文件名中：名称#密码.xlsx。
                </Typography.Text>
              )}
              {customerVisitImport && (
                <Typography.Text type="secondary" className="mt-2 block text-xs">
                  客服回访导入：写入 visit_records，并软匹配挂到短信/控制台用后即评明细。
                </Typography.Text>
              )}
              {pipelineDesc && !channelBundleImport && !followUpImport && !customerVisitImport && (
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
          {dataSourceType === 'post_use_rating' && (
            <div className="page-section-sm">
              <Typography.Text strong className="mb-1 block text-xs">
                用后即评导入方式
              </Typography.Text>
              <Select
                className="w-full max-w-lg"
                value={postUseRatingSubType}
                options={POST_USE_RATING_SUBTYPE_OPTIONS}
                onChange={onPostUseRatingSubTypeChange}
              />
            </div>
          )}
          {isStubPipeline(dataSourceType) &&
            !channelBundleImport &&
            !followUpImport &&
            !customerVisitImport && (
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

      {step === 1 && channelBundleImport && (
        <Card className="page-section">
          <PostUseChannelBundleImport
            phase="upload"
            importBusy={importBusy || channelPreviewBusy}
            smsFiles={channelSmsFiles}
            webFiles={channelWebFiles}
            preview={channelPreview}
            onAddSmsFile={(file) => {
              const check = validateImportFile(file)
              if (!check.ok) {
                setError(`${displayImportFileName(file.name)}：${check.message}`)
                return
              }
              setChannelSmsFiles((prev) => {
                if (prev.length >= MAX_IMPORT_FILES) {
                  setError(`短信渠道最多 ${MAX_IMPORT_FILES} 个文件`)
                  return prev
                }
                if (
                  prev.some(
                    (item) =>
                      item.name === file.name &&
                      item.size === file.size &&
                      item.lastModified === file.lastModified,
                  )
                ) {
                  setError(`「${displayImportFileName(file.name)}」已在列表中`)
                  return prev
                }
                setError('')
                setChannelPreview(null)
                return [...prev, file]
              })
            }}
            onAddWebFile={(file) => {
              const check = validateImportFile(file)
              if (!check.ok) {
                setError(`${displayImportFileName(file.name)}：${check.message}`)
                return
              }
              setChannelWebFiles((prev) => {
                if (prev.length >= MAX_IMPORT_FILES) {
                  setError(`官网渠道最多 ${MAX_IMPORT_FILES} 个文件`)
                  return prev
                }
                if (
                  prev.some(
                    (item) =>
                      item.name === file.name &&
                      item.size === file.size &&
                      item.lastModified === file.lastModified,
                  )
                ) {
                  setError(`「${displayImportFileName(file.name)}」已在列表中`)
                  return prev
                }
                setError('')
                setChannelPreview(null)
                return [...prev, file]
              })
            }}
            onSmsFilesChange={(files) => {
              setChannelSmsFiles(files)
              setChannelPreview(null)
            }}
            onWebFilesChange={(files) => {
              setChannelWebFiles(files)
              setChannelPreview(null)
            }}
          />
          <div className="page-section">
            <Space>
              <Button onClick={() => setStep(0)} disabled={importBusy || channelPreviewBusy}>
                上一步
              </Button>
              <Button
                type="primary"
                loading={channelPreviewBusy}
                disabled={!channelSmsFiles.length || !channelWebFiles.length || importBusy}
                onClick={() => void goChannelBundlePreview()}
              >
                下一步：解析预览
              </Button>
            </Space>
          </div>
        </Card>
      )}

      {step === 2 && channelBundleImport && (
        <Card className="page-section">
          <PostUseChannelBundleImport
            phase="preview"
            importBusy={importBusy}
            smsFiles={channelSmsFiles}
            webFiles={channelWebFiles}
            preview={channelPreview}
          />
          <div className="page-section">
            <Space>
              <Button onClick={() => setStep(1)} disabled={importBusy}>
                上一步
              </Button>
              <Button
                type="primary"
                loading={importBusy}
                disabled={!channelPreview || !storageReady || importBlocked}
                onClick={() =>
                  void doChannelBundleImport({
                    smsFiles: channelSmsFiles,
                    webFiles: channelWebFiles,
                    importMonth: normalizeImportMonth(importMonth),
                  })
                }
              >
                {importBusy ? importProgress || '导入中…' : '确认导入'}
              </Button>
            </Space>
          </div>
        </Card>
      )}

      {step === 1 && !channelBundleImport && (
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
                ? '满意度回访仅支持单文件上传；需含「回访工单编号」「原工单编号」等列。推荐改用「短信+官网双文件」。'
                : customerVisitImport
                  ? `客服部回访支持最多 ${MAX_IMPORT_FILES} 个结构相同的文件合并导入；模板需含数据月份、客户名称、客户编码、产品名称、回访结果、内部评估。`
                  : ticketSource
                    ? `可一次选择最多 ${MAX_IMPORT_FILES} 个结构相同的文件；按表头列「工单展示流水号」识别表头。单文件 ≤${MAX_FILE_BYTES / 1024 / 1024}MB、≤${MAX_ROWS_PER_FILE} 行，合并后总行数 ≤${MAX_ROWS_BATCH_TOTAL}。加密文件可把密码写在文件名中：名称#密码.xlsx。`
                    : `可一次选择最多 ${MAX_IMPORT_FILES} 个结构相同的文件；单文件 ≤${MAX_FILE_BYTES / 1024 / 1024}MB、≤${MAX_ROWS_PER_FILE} 行，合并后总行数 ≤${MAX_ROWS_BATCH_TOTAL}。加密文件可把密码写在文件名中：名称#密码.xlsx。`
            }
          />
          <Upload.Dragger
            accept=".csv,.xlsx,.xls"
            multiple={!singleFileEnrichImport}
            maxCount={singleFileEnrichImport ? 1 : MAX_IMPORT_FILES}
            showUploadList={false}
            disabled={
              importBusy ||
              (!singleFileEnrichImport && uploadFiles.length >= MAX_IMPORT_FILES) ||
              (singleFileEnrichImport && uploadFiles.length >= 1)
            }
            beforeUpload={(file) => {
              if (singleFileEnrichImport && uploadFiles.length >= 1) {
                setError(
                  '满意度回访导入仅支持单文件',
                )
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
              {followUpImport
                ? '拖拽或点击选择满意度回访文件'
                : customerVisitImport
                  ? '拖拽或点击选择客服部回访文件（可多选）'
                  : '拖拽或点击选择文件（可多选）'}
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
                    title={displayImportFileName(item.file.name)}
                    description={
                      <Space orientation="vertical" size={4} className="w-full">
                        <Typography.Text type="secondary" className="text-xs">
                          {item.rows.length} 行 · SHA256 {item.sha256.slice(0, 8)}…
                        </Typography.Text>
                        {item.requiresPassword && (
                          <Tag color="gold">已用密码解锁（仅内存）</Tag>
                        )}
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
              description={uploadFiles.map((f) => displayImportFileName(f.file.name)).join('、')}
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

      {step === 2 && !channelBundleImport && (
        <div className="page-section space-y-5">
          <Card>
            <Typography.Title level={5} className="!mb-0">
              列映射
            </Typography.Title>
            {followUpImport ? (
              <div className="page-section-sm">
                <FollowUpSatisfactionColumnMapping preset={activePreset} headers={headers} />
              </div>
            ) : customerVisitImport ? (
              <div className="page-section-sm space-y-3">
                {!activePreset || activePreset.id !== POST_USE_CUSTOMER_VISIT_PRESET.id ? (
                  <Alert
                    type="warning"
                    showIcon
                    title="未识别客服回访表头"
                    description="需包含月份、产品名称、用户信息/客户反馈摘要、评分来源或内部结论等列。"
                  />
                ) : (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      title={`已识别为「${activePreset.name}」格式`}
                      description="写入 visit_records，并软匹配挂到短信/控制台用后即评明细；列映射由模板锁定。"
                    />
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={Object.entries(activePreset.columnMap).map(([key, header]) => ({
                        key,
                        field: key,
                        header,
                        present: headers.includes(header),
                      }))}
                      columns={[
                        { title: '系统字段', dataIndex: 'field', width: 180 },
                        { title: 'Excel 列名', dataIndex: 'header' },
                        {
                          title: '状态',
                          dataIndex: 'present',
                          width: 88,
                          render: (present) => (present ? '已识别' : '缺失'),
                        },
                      ]}
                    />
                  </>
                )}
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

      {step === 3 && !channelBundleImport && (
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
            ) : customerVisitImport ? (
              <>
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  写入客服回访元数据，并软匹配挂到短信/控制台用后即评明细；不触发打标流水线。
                </Typography.Text>
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  数据月份：{importMonthDisplay} · 来源：{DATA_SOURCE_LABELS[dataSourceType]} ·
                  二级分类：客服回访导入
                </Typography.Text>
                <div className="page-section-sm space-y-3">
                  {customerVisitPreviewLoading ? (
                    <Typography.Text type="secondary" className="block text-xs">
                      正在匹配用后即评明细并生成预览…
                    </Typography.Text>
                  ) : customerVisitPreviewError ? (
                    <Alert
                      type="error"
                      showIcon
                      title="预览失败"
                      description={customerVisitPreviewError}
                    />
                  ) : customerVisitPreview ? (
                    <>
                      <Alert
                        type={
                          customerVisitPreview.matchedCount > 0 ||
                          customerVisitPreview.visitMetaCount > 0
                            ? 'success'
                            : 'warning'
                        }
                        showIcon
                        title={
                          <>
                            回访元数据 <strong>{customerVisitPreview.visitMetaCount}</strong> 条 ·
                            匹配挂接 <strong>{customerVisitPreview.matchedCount}</strong> 条 ·
                            仅元数据（含投诉回访）{' '}
                            <strong>{customerVisitPreview.metaOnlyCount}</strong> 条 · 未匹配{' '}
                            <strong>{customerVisitPreview.unmatched.length}</strong> 行
                          </>
                        }
                      />
                      {customerVisitPreview.unmatched.length > 0 && (
                        <Table
                          size="small"
                          pagination={{ pageSize: 5 }}
                          rowKey={(r) => `u-${r.rowIndex}`}
                          dataSource={customerVisitPreview.unmatched}
                          columns={[
                            { title: '行号', dataIndex: 'rowIndex', width: 72 },
                            { title: '原因', dataIndex: 'reason' },
                            {
                              title: '产品',
                              width: 120,
                              render: (_, r) => r.visit?.productName || '—',
                            },
                            {
                              title: '用户',
                              ellipsis: true,
                              render: (_, r) => r.visit?.userInfo || '—',
                            },
                          ]}
                        />
                      )}
                    </>
                  ) : null}
                </div>
              </>
            ) : (
              <>
            <Typography.Text type="secondary" className="mt-1 block text-xs">
              下方展示打标语料样例（最多 3 条）。确认导入后将先完成规则初标（客户请求、需求痛点、问题原因、四维、优化建议），再依次增强：请求场景与问题类型（本地）→ 客户请求/需求痛点/问题原因/优化建议（配置 API Key 时 LLM，一次写出）→ 请求场景与问题类型（LLM 语料，默认开）→ 用户旅程 → 用户情绪。
            </Typography.Text>
            <Alert
              className="mt-2"
              type="info"
              showIcon
              title="同工单号处理规则"
              description="相同工单号将覆盖库内导入表字段与自动打标结果；人工复核、确立举措、会议待办、是否听音、备注及回访满意度等用户维护内容予以保留。"
            />
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
            ) : customerVisitImport ? (
              <Button
                type="primary"
                disabled={!canImport || !storageReady || importBlocked || importBusy}
                loading={importBusy || customerVisitPreviewLoading}
                onClick={confirmCustomerVisitImport}
              >
                {importBusy
                  ? importProgress || '导入中…'
                  : customerVisitPreviewLoading
                    ? '预览加载中…'
                    : `确认导入回访 ${customerVisitPreview?.visitMetaCount ?? 0} 条`}
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

      {step === 4 && channelBundleResult && (
        <Card className="page-section">
          <Result
            status="success"
            title="用后即评双文件导入完成"
            subTitle={
              <>
                已写入明细 {channelBundleResult.recordCount} 条
                {channelBundleResult.counts != null && (
                  <>
                    （短信 {channelBundleResult.counts.sms} · 控制台{' '}
                    {channelBundleResult.counts.console} · 投诉回访{' '}
                    {channelBundleResult.counts.callback} · 去重后{' '}
                    {channelBundleResult.counts.scoredMerged}）
                  </>
                )}
                {channelBundleResult.deletedPrior > 0 &&
                  ` · 覆盖同月旧批次 ${channelBundleResult.deletedPrior} 条`}
              </>
            }
            extra={
              <Space wrap>
                <Button type="primary" onClick={() => navigate('/workbench?tab=post_use_rating')}>
                  打开洞察工作台 · 用后即评
                </Button>
                <Button
                  onClick={() =>
                    navigate(
                      `/feedbacks?source=post_use_rating&month=${normalizeImportMonth(importMonth)}`,
                    )
                  }
                >
                  查看反馈库
                </Button>
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
            数据月份 {normalizeImportMonth(importMonth)} · 对内体验分与投诉回访满意度已可在工作台查看
          </Typography.Text>
        </Card>
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

      {step === 4 && customerVisitImportResult && (
        <Card className="page-section">
          <Result
            status={
              customerVisitImportResult.dry.visitMetaCount > 0 ||
              customerVisitImportResult.dry.matchedCount > 0
                ? 'success'
                : 'warning'
            }
            title="客服回访导入完成"
            subTitle={
              <>
                回访元数据 <strong>{customerVisitImportResult.dry.visitMetaCount}</strong> 条 ·
                匹配挂接 <strong>{customerVisitImportResult.dry.matchedCount}</strong> 条 · 未匹配{' '}
                <strong>{customerVisitImportResult.dry.unmatched.length}</strong> 行
              </>
            }
            extra={
              <Space wrap>
                <Button type="primary" onClick={() => navigate('/workbench?tab=post_use_rating')}>
                  打开洞察工作台 · 用后即评
                </Button>
                <Button
                  onClick={() =>
                    navigate(
                      `/feedbacks?lane=post_use&source=post_use_rating&month=${customerVisitImportResult.dataMonth}`,
                    )
                  }
                >
                  查看用后即评明细
                </Button>
                <Button
                  onClick={() => {
                    resetFileState()
                    setCustomerVisitImportResult(null)
                    setStep(0)
                    setError('')
                  }}
                >
                  继续导入
                </Button>
              </Space>
            }
          />
          {customerVisitImportResult.dry.unmatched.length > 0 && (
            <Table
              className="mt-4"
              size="small"
              pagination={{ pageSize: 8 }}
              rowKey={(r) => `ru-${r.rowIndex}`}
              dataSource={customerVisitImportResult.dry.unmatched}
              columns={[
                { title: '行号', dataIndex: 'rowIndex', width: 72 },
                { title: '未匹配原因', dataIndex: 'reason' },
                {
                  title: '产品',
                  width: 140,
                  render: (_, r) => r.visit?.productName || '—',
                },
                {
                  title: '用户信息',
                  ellipsis: true,
                  render: (_, r) => r.visit?.userInfo || '—',
                },
              ]}
            />
          )}
          <Typography.Text type="secondary" className="mt-3 block text-center text-xs">
            数据月份 {customerVisitImportResult.dataMonth} · 回访已写入 visit_records
            {customerVisitImportResult.dry.matchedCount > 0
              ? '，并已挂接到匹配的评价明细'
              : ''}
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
                    · 新增 {importResult.ingest.added} 条
                    {importResult.ingest.updated > 0 &&
                      ` · 更新 ${importResult.ingest.updated} 条`}
                    {importResult.ingest.skippedDuplicates > 0 &&
                      ` · 批次内同号折叠 ${importResult.ingest.skippedDuplicates} 条`}
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
      <Modal
        open={passwordPrompt.open}
        title="请输入 Excel 密码"
        okText="解锁文件"
        cancelText="取消"
        confirmLoading={passwordSubmitting}
        onOk={() => void submitPasswordPrompt()}
        onCancel={closePasswordPrompt}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            {passwordPrompt.file?.name
              ? `文件「${displayImportFileName(passwordPrompt.file.name)}」已加密，请输入密码后继续解析。`
              : '该 Excel 文件已加密，请输入密码后继续解析。'}
          </Typography.Text>
          {passwordPrompt.error && (
            <Alert
              type="error"
              showIcon
              message={passwordPrompt.error}
            />
          )}
          <Input.Password
            autoFocus
            placeholder="请输入 Excel 文件密码"
            value={passwordPrompt.password}
            onChange={(e) =>
              setPasswordPrompt((prev) => ({
                ...prev,
                password: e.target.value,
                error: '',
              }))
            }
            onPressEnter={() => void submitPasswordPrompt()}
          />
          <Typography.Text type="secondary" className="text-xs">
            密码仅保存在当前页面内存中，不会写入系统或随导入数据上传。
          </Typography.Text>
        </Space>
      </Modal>
    </div>
  )
}
