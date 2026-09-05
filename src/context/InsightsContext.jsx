import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { notification, Button } from 'antd'
import { useAuth } from './AuthContext.jsx'
import { refreshLlmServerStatus, resolveSettingsForLlm } from '../lib/llmClient.js'
import { loadSettings, saveSettings } from '../lib/storage.js'
import {
  loadTeamAppSettings,
  mergeTeamAndLocalSettings,
  saveTeamAppSettings,
} from '../lib/appSettingsPersist.js'
import { hydrateRecommendationFeedbackFromServer } from '../lib/planningRecommendationFeedback.js'
import {
  loadFeedbacksForPeriod,
  listAllFeedbacks,
  getTotalRecordCount,
  persistFeedbacks,
  persistRecordUpdate,
  persistRecordUpdates,
  isApiStorageAdapter,
  clearAllImportedData,
} from '../storage/feedbackStore.js'
import {
  isClearAllImportedData,
  recordMatchesClearFilter,
  validateClearImportedDataOptions,
} from '../storage/clearImportedData.js'
import { fetchAllRecordPages } from '../lib/recordLoader.js'
import { reprocessCustomerQuoteForRecord, reprocessFeedbackRecord } from '../lib/pipeline.js'
import { mergeManualTagFieldsOnUserEdit, applyForceRetagOverrides } from '../lib/manualTagFields.js'
import { mergeFeedbacksInto, ticketImportDuplicateKey } from '../lib/ticketImportMerge.js'
import { unlinkActionItemsForForceRetag } from '../lib/forceRetagActionUnlink.js'
import {
  mergeEstablishedActionLibraryForRecords,
  syncLinkedTicketsForActionIds,
} from '../lib/establishedActionPersist.js'
import { reprocessAllThemesAndSentiment } from '../lib/applyThemes.js'
import {
  formatBulkRetagResultMessage,
  listUnknownJourneyRecords,
  summarizeRetagPainPointChanges,
  summarizeUnknownJourneyRecords,
} from '../lib/journeyRetagSummary.js'
import { computeTicketLlmEnrichmentDelta } from '../lib/importEnrichmentStats.js'
import {
  applyManagedTaxonomySnapshot,
  getThemeRulesForProduct,
  initTaxonomyCacheFromBuiltin,
} from '../lib/taxonomyLoader.js'
import { initProductCatalogFromBuiltin } from '../lib/productCatalogLoader.js'
import { getStorageAdapter } from '../storage/getStorageAdapter.js'
import { migrateLocalToApiIfNeeded } from '../storage/migrateLocalToApi.js'
import { LEGACY_INSIGHT_PERIOD_ID, DEFAULT_TENANT_ID } from '../domain/constants.js'
import {
  buildPeriodSpec,
  createInsightPeriod,
  defaultMonthPeriodSpec,
  defaultMonthPeriodSpecFromMonths,
  insightPeriodFromSpec,
  normalizeInsightPeriod,
  periodSpecFromImportMonth,
  resolveInsightPeriod,
  selectionFromPeriod,
} from '../domain/insightPeriod.js'
import { normalizeImportMonth } from '../lib/importUtils.js'
import {
  clearImportSessionMarker,
  persistImportSessionMarker,
  updateImportSessionMarkerProgress,
  IMPORT_ALREADY_IN_PROGRESS_TIP,
  IMPORT_ANALYSIS_SESSION_LABEL,
  IMPORT_ANALYSIS_BLOCKED_BY_RETAG_TIP,
} from '../lib/importSession.js'
import {
  RETAG_BLOCKED_BY_IMPORT_TIP,
  RETAG_IMPORT_BLOCKED_TIP,
  RETAG_IN_PROGRESS_TIP,
  clearRetagSessionMarker,
  persistRetagSessionMarker,
  updateRetagSessionMarkerProgress,
} from '../lib/retagSession.js'
import {
  acquireBackgroundTask,
  fetchBackgroundTaskLock,
  releaseBackgroundTask,
  touchBackgroundTask,
} from '../lib/backgroundTaskClient.js'
import { SCHEMA_VERSION } from '../domain/constants.js'
import { getRecordRevision, applyRecordWriteMetadata } from '../domain/recordRevision.js'
import { buildIdempotencyKey } from '../domain/analysisRun.js'
import { createPipeline, listPipelineDescriptors, getPipelineDescriptor } from '../analysis/registry.js'
import { getComparableMetrics, getMetricsForSource, listMetricDescriptors } from '../metrics/registry.js'
import { defaultAnalysisVersions } from '../lib/versioning.js'
import { emit, subscribe } from '../lib/events.js'
import { DATA_SOURCE_TYPES } from '../domain/enums.js'
import {
  loadSnapshotsForPeriod,
  rebuildAllSnapshots as rebuildAllSnapshotsService,
  rebuildSourceSnapshot as rebuildSourceSnapshotService,
  markPeriodSnapshotsStale,
  overlayStaleStatus,
} from '../snapshots/index.js'
import { filterRecordsForScope } from '../snapshots/recordScope.js'
import { applyImportAnalysisToRecords } from '../lib/importAnalysis.js'
import { applyCustomerRestoreToRecords } from '../lib/customerRestore/customerRestoreImport.js'
import { CUSTOMER_RESTORE_SESSION_LABEL } from '../lib/customerRestore/constants.js'
import {
  SNAPSHOT_AUTO_REBUILD_DEBOUNCE_MS,
  snapshotsHavePeriodData,
} from '../lib/snapshotAutoRebuild.js'
import {
  formatInsightRebuildProgress,
  formatInsightRebuildSuccessMessage,
} from '../lib/insightRebuildClient.js'
import {
  compactDuplicateTagCandidates,
  upsertPendingTagCandidate,
} from '../lib/tagCandidates.js'
import { polishPlanningRecommendationsWithLLM } from '../lib/overviewConclusionsLLM.js'
import { loadPlanningConfig } from '../lib/planningConfigLoader.js'
import { buildCorrectionEventsFromEdit } from '../lib/learning/tagCorrectionCapture.js'
import { appendCorrectionEvents } from '../lib/learning/tagCorrectionStore.js'
import { hydrateLearningCaches, replayCorrectionsIfNeeded } from '../lib/learning/hydrateLearning.js'
import {
  META_KEY_OVERRIDES,
  META_KEY_TAG_VERSION,
  emptyOverrides,
} from '../lib/tagLibrary/overrides.js'
import { applyTaxonomyOverridesFromMeta } from '../lib/taxonomyLoader.js'
import {
  getOrInitManagedSnapshot,
  importManagedTaxonomyIncremental,
  loadManagedTaxonomy,
  mergeCandidateIntoSnapshot,
  repairBuiltinTaxonomyJourneys,
  saveManagedTaxonomy,
} from '../lib/tagLibrary/taxonomyManagedStore.js'
import { syncCatalogProductsToTaxonomy, taxonomySnapshotContentEqual } from '../lib/productCenterSync.js'
import { downloadManagedTaxonomyExcel } from '../lib/tagLibrary/taxonomyManageModel.js'
import { listOrderVolumes, upsertOrderVolume } from '../storage/orderVolumeStore.js'
import { listWanTouTargets, upsertWanTouTarget } from '../storage/wanTouTargetStore.js'
import {
  getOrInitManagedProductCatalogSnapshot,
  importManagedProductCatalog,
  loadManagedProductCatalog,
  saveManagedProductCatalog,
} from '../storage/productCatalogStore.js'
import { TAG_LIBRARY_VERSION_DEFAULT } from '../domain/constants.js'
import {
  buildTaxonomyPatchPackage,
  buildSingleCandidatePatchPackage,
  downloadTaxonomyPatchJson,
  downloadTaxonomyPatchExcel,
  copyTaxonomyPatchJson,
} from '../lib/tagLibrary/exportTaxonomyPatch.js'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { DATA_SYNC_POLL_MS, fetchDataRevision } from '../lib/dataSync.js'
const META_CURRENT_PERIOD = 'current_insight_period_id'
const META_PERIOD_SELECTION = 'insight_period_selection'

const InsightsContext = createContext(null)

function attachJourneyRules(settings) {
  return {
    ...settings,
    themeRules: getThemeRulesForProduct(undefined, 'generic'),
  }
}

export function InsightsProvider({ children }) {
  const message = useAppMessage()
  const { user } = useAuth()
  const adapter = useMemo(() => getStorageAdapter(), [])
  const recordWriteActor = useMemo(
    () =>
      user?.id
        ? { userId: user.id, username: user.username || user.id }
        : null,
    [user?.id, user?.username],
  )
  /** 清空数据期间跳过 debounced persist，避免旧数据写回 IDB */
  const clearInProgressRef = useRef(false)
  /** 从服务端拉取他人写入的数据时跳过回写 */
  const skipPersistRef = useRef(false)
  const remoteSyncInProgressRef = useRef(false)
  /** 导入进行中：阻止版本轮询用旧库覆盖刚写入的记录 */
  const importLockRef = useRef(false)
  /** 批量重新打标进行中：避免轮询同步覆盖内存结果 */
  const reprocessingRef = useRef(false)
  /** @type {import('react').MutableRefObject<Set<string>>} */
  const loadedPeriodIdsRef = useRef(new Set())
  /** @type {import('react').MutableRefObject<ReturnType<typeof setTimeout> | null>} */
  const snapshotRebuildTimerRef = useRef(null)
  /** @type {import('react').MutableRefObject<Promise<void>>} */
  const snapshotRebuildChainRef = useRef(Promise.resolve())
  /** 洞察快照全量重建中：避免轮询 reload 把 rebuilding 空快照刷进 UI */
  const snapshotRebuildInProgressRef = useRef(false)
  /** @type {import('react').MutableRefObject<{ period: import('../domain/insightPeriod.js').InsightPeriod; recordsForBuild?: import('../lib/types.js').FeedbackRecord[]; reason?: string } | null>} */
  const snapshotRebuildPendingRef = useRef(null)
  /** @type {import('react').MutableRefObject<number | null>} */
  const dataRevisionRef = useRef(null)
  /** 本浏览器是否持有服务端全局后台任务锁 */
  const ownedBackgroundTaskRef = useRef(false)
  /** @type {import('react').MutableRefObject<import('../lib/types.js').FeedbackRecord[]>} */
  const feedbacksRef = useRef(/** @type {import('../lib/types.js').FeedbackRecord[]} */ ([]))

  /** 工单列表：内存缓存；生产环境 SSOT 为 SQLite records（见 docs/DATA-PERSISTENCE.md） */
  const [feedbacks, setFeedbacks] = useState(/** @type {import('../lib/types.js').FeedbackRecord[]} */ ([]))
  const [totalRecordCount, setTotalRecordCount] = useState(0)
  /** @type {[{ months: Array<{ importMonth: string; count: number }>; bySource: Array<{ dataSourceType: string; importMonth: string; count: number }>; total: number } | null, import('react').Dispatch<any>]} */
  const [importMonthSummary, setImportMonthSummary] = useState(null)
  const [feedbacksHydrated, setFeedbacksHydrated] = useState(false)
  const [feedbacksLoading, setFeedbacksLoading] = useState(true)
  const [settings, setSettingsState] = useState(() => attachJourneyRules(loadSettings()))
  const [reprocessing, setReprocessing] = useState(false)
  const [taxonomyMeta, setTaxonomyMeta] = useState(null)
  const [taxonomyReloading, setTaxonomyReloading] = useState(false)
  const [productCatalogMeta, setProductCatalogMeta] = useState(null)
  const [productCatalogReloading, setProductCatalogReloading] = useState(false)

  const [periods, setPeriods] = useState(/** @type {import('../domain/insightPeriod.js').InsightPeriod[]} */ ([]))
  const [currentPeriodId, setCurrentPeriodIdState] = useState(LEGACY_INSIGHT_PERIOD_ID)
  const [periodsLoading, setPeriodsLoading] = useState(true)
  const [storageReady, setStorageReady] = useState(false)
  const [sourceSnapshots, setSourceSnapshots] = useState(
    /** @type {Partial<Record<import('../domain/enums.js').DataSourceType, import('../domain/snapshot.js').InsightSnapshot>>} */ ({}),
  )
  const [overviewSnapshot, setOverviewSnapshot] = useState(
    /** @type {import('../domain/snapshot.js').OverviewSnapshot | null} */ (null),
  )
  const [snapshotsStale, setSnapshotsStale] = useState(false)
  /** @type {'data' | 'period' | null} */
  const [snapshotStaleReason, setSnapshotStaleReason] = useState(/** @type {'data' | 'period' | null} */ (null))
  const [snapshotRebuilding, setSnapshotRebuilding] = useState(
    /** @type {string | null} */ (null),
  )
  const [tagCandidates, setTagCandidates] = useState(
    /** @type {import('../domain/tagCandidate.js').TagCandidate[]} */ ([]),
  )
  const [tagCandidatesLoading, setTagCandidatesLoading] = useState(false)
  const [orderVolumes, setOrderVolumes] = useState(
    /** @type {import('../storage/orderVolumeStore.js').OrderVolumeRow[]} */ ([]),
  )
  const [orderVolumesLoading, setOrderVolumesLoading] = useState(false)
  const [wanTouTargets, setWanTouTargets] = useState(
    /** @type {import('../storage/wanTouTargetStore.js').WanTouTargetRow[]} */ ([]),
  )
  const [wanTouTargetsLoading, setWanTouTargetsLoading] = useState(false)
  /** @type {[{ active: boolean; progress: string; dataMonth?: string; batchName?: string; kind?: 'tickets' | 'analysis' }, import('react').Dispatch<import('react').SetStateAction<{ active: boolean; progress: string; dataMonth?: string; batchName?: string; kind?: 'tickets' | 'analysis' }>>]} */
  const [importSession, setImportSession] = useState(() => ({
    active: false,
    progress: '',
    dataMonth: undefined,
    batchName: undefined,
    kind: undefined,
  }))
  /** @type {[{ active: boolean; progress: string; total: number; scope?: import('../lib/retagSession.js').BulkRetagScope | 'all' }, import('react').Dispatch<import('react').SetStateAction<{ active: boolean; progress: string; total: number; scope?: import('../lib/retagSession.js').BulkRetagScope | 'all' }>>]} */
  const [retagSession, setRetagSession] = useState(() => ({
    active: false,
    progress: '',
    total: 0,
    scope: /** @type {import('../lib/retagSession.js').BulkRetagScope | 'all'} */ ('all'),
  }))
  /** @type {[import('../domain/backgroundTaskLock.js').BackgroundTaskLock | null, import('react').Dispatch<import('react').SetStateAction<import('../domain/backgroundTaskLock.js').BackgroundTaskLock | null>>]} */
  const [sharedBackgroundTask, setSharedBackgroundTask] = useState(
    /** @type {import('../domain/backgroundTaskLock.js').BackgroundTaskLock | null} */ (null),
  )
  const currentPeriod = useMemo(
    () => periods.find((p) => p.id === currentPeriodId) ?? null,
    [periods, currentPeriodId],
  )

  useEffect(() => {
    feedbacksRef.current = feedbacks
  }, [feedbacks])

  const mergeRecordsIntoCache = useCallback((incoming) => {
    if (!incoming.length) return
    setFeedbacks((prev) => {
      const map = new Map(prev.map((fb) => [fb.id, fb]))
      for (const r of incoming) map.set(r.id, r)
      return [...map.values()]
    })
  }, [])

  const loadRecordsForPeriodId = useCallback(
    async (periodId) => {
      if (!periodId || !storageReady || loadedPeriodIdsRef.current.has(periodId)) return
      // 首屏/周期切换用 list 投影裁剪大文本字段；抽屉/retag/update 按需拉全量单条
      const records = await loadFeedbacksForPeriod(adapter, periodId, {
        fields: isApiStorageAdapter(adapter) ? 'list' : 'full',
      })
      loadedPeriodIdsRef.current.add(periodId)
      mergeRecordsIntoCache(records)
      feedbacksRef.current = [
        ...new Map(
          [...feedbacksRef.current, ...records].map((fb) => [fb.id, fb]),
        ).values(),
      ]
    },
    [adapter, mergeRecordsIntoCache, storageReady],
  )

  const reloadPeriods = useCallback(async () => {
    setPeriodsLoading(true)
    try {
      const migration = await migrateLocalToApiIfNeeded(adapter)
      if (migration.migrated) {
        console.info(
          `[storage] 已将本机数据迁移至共享库：${migration.records} 条反馈`,
        )
      }
      // migrateLocalToApiIfNeeded 内部已调用 adapter.init()，无需重复 init

      // 共享 API 模式：月份聚合替代全表下载；本机 IDB 全量加载无网络开销，保持原语义
      const apiMode =
        isApiStorageAdapter(adapter) && typeof adapter.listImportMonthSummary === 'function'

      const [teamSettings, rawPeriodList, savedSelection, savedCurrentPeriodId, monthSummary] =
        await Promise.all([
          loadTeamAppSettings(adapter),
          adapter.listInsightPeriods(),
          adapter.getMeta(META_PERIOD_SELECTION),
          adapter.getMeta(META_CURRENT_PERIOD),
          apiMode ? adapter.listImportMonthSummary() : Promise.resolve(null),
        ])
      if (Object.keys(teamSettings).length) {
        const local = loadSettings()
        const merged = attachJourneyRules(mergeTeamAndLocalSettings(teamSettings, local))
        saveSettings(merged)
        setSettingsState((prev) => ({ ...merged, llmServerConfigured: prev.llmServerConfigured }))
      }

      let list = rawPeriodList.map(normalizeInsightPeriod)
      if (monthSummary) setImportMonthSummary(monthSummary)

      setFeedbacksLoading(true)
      loadedPeriodIdsRef.current = new Set()
      /** @type {import('../lib/types.js').FeedbackRecord[]} */
      let loadedRecords = []
      if (!apiMode) {
        try {
          const page = await fetchAllRecordPages(adapter)
          loadedRecords = page.records
          setFeedbacks(page.records)
          feedbacksRef.current = page.records
          setTotalRecordCount(page.total)
          setFeedbacksHydrated(true)
        } finally {
          setFeedbacksLoading(false)
        }
      } else {
        setFeedbacks([])
        feedbacksRef.current = []
        setTotalRecordCount(monthSummary?.total ?? 0)
      }

      let spec = apiMode
        ? defaultMonthPeriodSpecFromMonths(monthSummary?.months ?? [])
        : defaultMonthPeriodSpec(loadedRecords)
      if (savedSelection?.granularity === 'custom' && savedSelection.fromMonth && savedSelection.toMonth) {
        spec = buildPeriodSpec({
          granularity: 'custom',
          fromMonth: savedSelection.fromMonth,
          toMonth: savedSelection.toMonth,
        })
      } else if (savedSelection?.granularity && savedSelection.year != null) {
        spec = buildPeriodSpec(savedSelection)
      } else {
        const existing = list.find((p) => p.id === savedCurrentPeriodId)
        const sel = selectionFromPeriod(existing)
        if (sel?.granularity === 'custom' && sel.fromMonth && sel.toMonth) {
          spec = buildPeriodSpec({
            granularity: 'custom',
            fromMonth: sel.fromMonth,
            toMonth: sel.toMonth,
          })
        } else if (sel) {
          spec = buildPeriodSpec(sel)
        }
      }

      const period = insightPeriodFromSpec(spec, SCHEMA_VERSION, DEFAULT_TENANT_ID)
      setPeriods((prev) => {
        const idx = prev.findIndex((p) => p.id === period.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = period
          return next
        }
        return [...prev, period]
      })
      setCurrentPeriodIdState(period.id)
      setStorageReady(true)
      // 周期已确定：提前结束 periodsLoading，让周期选择器与反馈库表格先渲染骨架/空态；
      // 记录加载由 feedbacksLoading 独立 gate，在后台流式完成。
      setPeriodsLoading(false)

      // 条件写入：周期已存在且选择未变化时跳过（避免每次打开都产生写 RTT 与查看者 403 噪音）
      const selectionPayload = {
        granularity: spec.granularity,
        year: spec.anchorYear ?? null,
        month: spec.anchorMonth ?? null,
        quarter: spec.anchorQuarter ?? null,
        fromMonth: spec.customFromMonth ?? null,
        toMonth: spec.customToMonth ?? null,
      }
      const periodExists = list.some((p) => p.id === period.id)
      const selectionChanged =
        !savedSelection ||
        ['granularity', 'year', 'month', 'quarter', 'fromMonth', 'toMonth'].some(
          (key) => (savedSelection[key] ?? null) !== selectionPayload[key],
        )
      const currentChanged = savedCurrentPeriodId !== period.id
      try {
        /** @type {Promise<unknown>[]} */
        const writes = []
        if (!periodExists) writes.push(adapter.putInsightPeriod(period))
        if (selectionChanged) writes.push(adapter.putMeta(META_PERIOD_SELECTION, selectionPayload))
        if (currentChanged) writes.push(adapter.putMeta(META_CURRENT_PERIOD, period.id))
        await Promise.all(writes)
        if (!periodExists) {
          list = (await adapter.listInsightPeriods()).map(normalizeInsightPeriod)
          setPeriods(list)
        }
      } catch (err) {
        console.warn('[storage] 保存周期选择失败（查看者无 import 权限时可忽略）', err)
      }

      // 记录加载与推荐反馈补水并行，不阻塞 periodsLoading（已提前结束）
      await Promise.all([
        hydrateRecommendationFeedbackFromServer(adapter),
        hydrateLearningCaches(adapter),
        (async () => {
          try {
            await loadRecordsForPeriodId(period.id)
          } finally {
            if (apiMode) {
              setFeedbacksHydrated(true)
              setFeedbacksLoading(false)
            }
          }
        })(),
      ])
      void replayCorrectionsIfNeeded(adapter, feedbacksRef.current).catch((err) => {
        console.warn('[learning] 历史改标回放失败', err)
      })
      if (typeof adapter.getDataRevision === 'function') {
        try {
          const rev = await adapter.getDataRevision()
          dataRevisionRef.current = rev.revision
        } catch {
          /* 轮询同步非关键路径 */
        }
      }
      return period
    } catch (err) {
      console.error('[storage] 加载共享数据失败', err)
      setPeriodsLoading(false)
    }
  }, [adapter, loadRecordsForPeriodId])

  useEffect(() => {
    reloadPeriods()
  }, [reloadPeriods])

  useEffect(() => {
    if (!storageReady) return
    let cancelled = false
    refreshLlmServerStatus().then((configured) => {
      if (cancelled) return
      setSettingsState((prev) => ({ ...prev, llmServerConfigured: configured }))
    })
    return () => {
      cancelled = true
    }
  }, [storageReady])

  const preferReadySnapshot = useCallback((prev, incoming) => {
    if (!incoming) return prev
    if (!prev) return incoming
    if (incoming.status !== 'rebuilding') return incoming
    if (prev.status !== 'ready' && prev.status !== 'stale') return incoming
    const prevCount = prev.recordIds?.length ?? prev.summary?.recordCount ?? 0
    const nextCount = incoming.recordIds?.length ?? incoming.summary?.recordCount ?? 0
    if (prevCount > 0 && nextCount === 0) return prev
    return incoming
  }, [])

  const applySnapshotState = useCallback(
    (loaded, forceStale = snapshotsStale) => {
      setSourceSnapshots((prev) => {
        /** @type {Partial<Record<import('../domain/enums.js').DataSourceType, import('../domain/snapshot.js').InsightSnapshot>>} */
        const bySource = {}
        for (const type of DATA_SOURCE_TYPES) {
          const snap = loaded.sourceSnapshots[type]
          const merged = preferReadySnapshot(prev[type], snap)
          bySource[type] = merged
            ? /** @type {import('../domain/snapshot.js').InsightSnapshot} */ (
                overlayStaleStatus(merged, forceStale)
              )
            : undefined
        }
        return bySource
      })
      setOverviewSnapshot((prev) => {
        const snap = loaded.overviewSnapshot
        const merged = preferReadySnapshot(prev, snap)
        return merged
          ? /** @type {import('../domain/snapshot.js').OverviewSnapshot} */ (
              overlayStaleStatus(merged, forceStale)
            )
          : null
      })
    },
    [snapshotsStale, preferReadySnapshot],
  )

  const reloadSnapshots = useCallback(
    async (periodId = currentPeriodId) => {
      if (!storageReady || snapshotRebuildInProgressRef.current) return
      const loaded = await loadSnapshotsForPeriod(adapter, periodId)
      applySnapshotState(loaded, snapshotsStale)
    },
    [adapter, currentPeriodId, storageReady, applySnapshotState, snapshotsStale],
  )

  const reloadTagCandidates = useCallback(async () => {
    if (!storageReady) return []
    setTagCandidatesLoading(true)
    try {
      const { list } = await compactDuplicateTagCandidates(adapter)
      setTagCandidates(list)
      return list
    } finally {
      setTagCandidatesLoading(false)
    }
  }, [adapter, storageReady])

  const tagCandidateWriteQueueRef = useRef(Promise.resolve())

  const mergeDuplicateTagCandidates = useCallback(async () => {
    if (!storageReady) return { removedCount: 0 }
    setTagCandidatesLoading(true)
    try {
      const { list, removedCount } = await compactDuplicateTagCandidates(adapter)
      setTagCandidates(list)
      return { removedCount }
    } finally {
      setTagCandidatesLoading(false)
    }
  }, [adapter, storageReady])

  const reloadOrderVolumes = useCallback(async () => {
    if (!storageReady) return []
    setOrderVolumesLoading(true)
    try {
      const list = await listOrderVolumes(adapter)
      setOrderVolumes(list)
      return list
    } finally {
      setOrderVolumesLoading(false)
    }
  }, [adapter, storageReady])

  const saveOrderVolume = useCallback(
    async (row) => {
      const saved = await upsertOrderVolume(adapter, row)
      await reloadOrderVolumes()
      return saved
    },
    [adapter, reloadOrderVolumes],
  )

  const reloadWanTouTargets = useCallback(async () => {
    if (!storageReady) return []
    setWanTouTargetsLoading(true)
    try {
      const list = await listWanTouTargets(adapter)
      setWanTouTargets(list)
      return list
    } finally {
      setWanTouTargetsLoading(false)
    }
  }, [adapter, storageReady])

  const saveWanTouTarget = useCallback(
    async (row) => {
      const saved = await upsertWanTouTarget(adapter, row)
      await reloadWanTouTargets()
      return saved
    },
    [adapter, reloadWanTouTargets],
  )

  const applyTaxonomyOverridesFromStorage = useCallback(async () => {
    const managedState = await loadManagedTaxonomy(adapter)
    if (managedState) {
      setTaxonomyMeta(managedState)
      return managedState
    }
    const overrides = await adapter.getMeta(META_KEY_OVERRIDES)
    if (overrides) {
      const tax = applyTaxonomyOverridesFromMeta(overrides)
      setTaxonomyMeta(tax)
      return tax
    }
    return null
  }, [adapter])

  /** 刷新导入月份聚合（首屏默认周期推断与工作台空状态跨月提示的数据源） */
  const refreshImportMonthSummary = useCallback(async () => {
    if (typeof adapter.listImportMonthSummary !== 'function') return
    try {
      setImportMonthSummary(await adapter.listImportMonthSummary())
    } catch {
      /* 汇总刷新非关键路径 */
    }
  }, [adapter])

  /** 其他用户写入共享库后，拉取最新反馈、快照与标签候选 */
  const syncSharedDataFromServer = useCallback(
    async (opts = {}) => {
      const { notify = true } = opts
      if (
        !storageReady ||
        clearInProgressRef.current ||
        remoteSyncInProgressRef.current ||
        importLockRef.current
      ) {
        return
      }
      remoteSyncInProgressRef.current = true
      skipPersistRef.current = true
      setFeedbacksLoading(true)
      try {
        const [{ records, total }] = await Promise.all([
          fetchAllRecordPages(adapter),
          refreshImportMonthSummary(),
        ])
        loadedPeriodIdsRef.current = new Set(currentPeriodId ? [currentPeriodId] : [])
        setFeedbacks(records)
        feedbacksRef.current = records
        setTotalRecordCount(total)
        setFeedbacksHydrated(true)
        const list = (await adapter.listInsightPeriods()).map(normalizeInsightPeriod)
        setPeriods(list)
        setSnapshotsStale(false)
        setSnapshotStaleReason(null)
        await reloadSnapshots(currentPeriodId)
        await reloadTagCandidates()
        await applyTaxonomyOverridesFromStorage()
        await hydrateLearningCaches(adapter)
        if (notify) {
          message.info('已同步其他用户的最新数据')
        }
        try {
          const rev = await fetchDataRevision()
          dataRevisionRef.current = rev.revision
        } catch {
          /* ignore */
        }
      } catch (err) {
        console.warn('[storage] 远程同步失败', err)
      } finally {
        setFeedbacksLoading(false)
        skipPersistRef.current = false
        remoteSyncInProgressRef.current = false
      }
    },
    [
      adapter,
      storageReady,
      currentPeriodId,
      reloadSnapshots,
      reloadTagCandidates,
      applyTaxonomyOverridesFromStorage,
      refreshImportMonthSummary,
      message,
    ],
  )

  const refreshSharedBackgroundTask = useCallback(async () => {
    if (!storageReady || !isApiStorageAdapter(adapter)) {
      setSharedBackgroundTask(null)
      return null
    }
    try {
      const lock = await fetchBackgroundTaskLock()
      setSharedBackgroundTask(lock)
      return lock
    } catch (err) {
      console.warn('[storage] 后台任务锁查询失败', err)
      return null
    }
  }, [adapter, storageReady])

  const releaseSharedBackgroundTask = useCallback(async () => {
    if (!isApiStorageAdapter(adapter) || !ownedBackgroundTaskRef.current) return
    ownedBackgroundTaskRef.current = false
    try {
      await releaseBackgroundTask()
    } catch (err) {
      console.warn('[storage] 释放后台任务锁失败', err)
    }
    await refreshSharedBackgroundTask()
  }, [adapter, refreshSharedBackgroundTask])

  const prepareSharedBackgroundTask = useCallback(
    /**
     * @param {import('../domain/backgroundTaskLock.js').BackgroundTaskType} type
     * @param {{ progress?: string; meta?: Record<string, unknown> }} [payload]
     */
    async (type, payload = {}) => {
      if (!isApiStorageAdapter(adapter)) return null
      const { lock } = await acquireBackgroundTask(type, payload)
      ownedBackgroundTaskRef.current = true
      setSharedBackgroundTask(lock)
      return lock
    },
    [adapter],
  )

  const touchSharedBackgroundTask = useCallback(
    /** @param {{ progress?: string; meta?: Record<string, unknown> }} patch */
    async (patch) => {
      if (!isApiStorageAdapter(adapter) || !ownedBackgroundTaskRef.current) return
      try {
        const lock = await touchBackgroundTask(patch)
        setSharedBackgroundTask(lock)
      } catch (err) {
        console.warn('[storage] 更新后台任务锁失败', err)
      }
    },
    [adapter],
  )

  useEffect(() => {
    if (!storageReady || typeof adapter.getDataRevision !== 'function') return

    let cancelled = false

    const tick = async () => {
      if (cancelled || document.visibilityState === 'hidden') return
      if (
        remoteSyncInProgressRef.current ||
        clearInProgressRef.current ||
        importLockRef.current ||
        reprocessingRef.current ||
        retagSession.active ||
        snapshotRebuildInProgressRef.current
      ) {
        return
      }
      try {
        const { revision } = await fetchDataRevision()
        const prev = dataRevisionRef.current
        if (prev != null && revision !== prev) {
          await syncSharedDataFromServer({ notify: true })
        }
        dataRevisionRef.current = revision
        await refreshSharedBackgroundTask()
      } catch (err) {
        console.warn('[storage] 版本轮询失败', err)
      }
    }

    tick()
    const intervalId = setInterval(tick, DATA_SYNC_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [storageReady, adapter, syncSharedDataFromServer, refreshSharedBackgroundTask, retagSession.active])

  useEffect(() => {
    if (storageReady && isApiStorageAdapter(adapter)) {
      void refreshSharedBackgroundTask()
    }
  }, [storageReady, adapter, refreshSharedBackgroundTask])

  useEffect(() => {
    if (storageReady) {
      reloadSnapshots(currentPeriodId)
      reloadTagCandidates()
      reloadOrderVolumes()
      reloadWanTouTargets()
      applyTaxonomyOverridesFromStorage()
    }
  }, [storageReady, currentPeriodId, reloadSnapshots, reloadTagCandidates, reloadOrderVolumes, reloadWanTouTargets, applyTaxonomyOverridesFromStorage])

  useEffect(() => {
    const unsub = subscribe('TagCandidateDiscovered', (ev) => {
      const incoming = /** @type {import('../domain/tagCandidate.js').TagCandidate} */ (
        ev.payload?.candidate
      )
      if (!incoming) return
      tagCandidateWriteQueueRef.current = tagCandidateWriteQueueRef.current
        .then(async () => {
          await upsertPendingTagCandidate(adapter, incoming)
          setTagCandidates(await adapter.listTagCandidates())
        })
        .catch((err) => console.warn('标签候选写入失败:', err))
    })
    return () => unsub()
  }, [adapter])

  const markSnapshotsStale = useCallback(
    async (reason = 'data') => {
      setSnapshotsStale(true)
      setSnapshotStaleReason(reason)
      if (storageReady) {
        await markPeriodSnapshotsStale(adapter, currentPeriodId)
        await reloadSnapshots(currentPeriodId)
      }
    },
    [adapter, currentPeriodId, storageReady, reloadSnapshots],
  )

  useEffect(() => {
    const unsubs = [
      subscribe('ImportCompleted', (ev) => {
        if (ev.payload?.skipStaleMark) return
        void markSnapshotsStale('data')
      }),
      subscribe('AnalysisRunFinished', () => markSnapshotsStale('data')),
      subscribe('TagLibraryPublished', () => markSnapshotsStale('data')),
    ]
    return () => unsubs.forEach((u) => u())
  }, [markSnapshotsStale])

  const executeSnapshotRebuild = useCallback(
    async ({
      period,
      recordsForBuild,
      updateUi = true,
      preferServerJob = true,
      userInitiated = false,
    }) => {
      if (!period || !storageReady) return null

      const useServerJob =
        preferServerJob &&
        typeof adapter.startInsightRebuild === 'function' &&
        typeof adapter.waitForInsightRebuild === 'function'

      snapshotRebuildInProgressRef.current = true
      setSnapshotRebuilding(useServerJob ? '排队中…' : '准备中…')
      try {
        if (useServerJob) {
          const { job: initialJob, started } = await adapter.startInsightRebuild(period.id)
          if (!started) {
            setSnapshotRebuilding('等待进行中的重建任务…')
          }
          const job = await adapter.waitForInsightRebuild(initialJob.id, (runningJob) => {
            setSnapshotRebuilding(formatInsightRebuildProgress(runningJob) || '重建中…')
          })
          if (updateUi && period.id === currentPeriodId) {
            await reloadSnapshots(currentPeriodId)
            setSnapshotsStale(false)
            setSnapshotStaleReason(null)
          } else if (period.id !== currentPeriodId) {
            setSnapshotsStale(true)
            setSnapshotStaleReason('data')
          }
          emit('SnapshotBuilt', { periodId: period.id, scope: 'all', serverJob: true })
          return { serverJob: true, job, userInitiated }
        }

        const mergedFeedbacks = recordsForBuild ?? feedbacksRef.current
        const result = await rebuildAllSnapshotsService(
          adapter,
          period,
          mergedFeedbacks,
          (source, done, total) => {
            setSnapshotRebuilding(`${source} (${done}/${total})`)
          },
          settings,
        )
        if (updateUi && period.id === currentPeriodId) {
          setSourceSnapshots(result.sourceSnapshots)
          setOverviewSnapshot(result.overviewSnapshot)
          setSnapshotsStale(false)
          setSnapshotStaleReason(null)
        } else if (period.id !== currentPeriodId) {
          setSnapshotsStale(true)
          setSnapshotStaleReason('data')
        }
        emit('SnapshotBuilt', { periodId: period.id, scope: 'all' })
        return { serverJob: false, userInitiated }
      } finally {
        snapshotRebuildInProgressRef.current = false
        setSnapshotRebuilding(null)
      }
    },
    [adapter, currentPeriodId, settings, storageReady, reloadSnapshots],
  )

  const scheduleSnapshotRebuild = useCallback(
    (opts = {}) => {
      const period = opts.period ?? currentPeriod
      if (!period || importLockRef.current) return
      snapshotRebuildPendingRef.current = {
        period,
        recordsForBuild: opts.recordsForBuild,
        reason: opts.reason || 'data',
      }
      clearTimeout(snapshotRebuildTimerRef.current)
      const debounceMs = opts.debounceMs ?? SNAPSHOT_AUTO_REBUILD_DEBOUNCE_MS
      snapshotRebuildTimerRef.current = setTimeout(() => {
        const pending = snapshotRebuildPendingRef.current
        snapshotRebuildPendingRef.current = null
        if (!pending) return
        snapshotRebuildChainRef.current = snapshotRebuildChainRef.current
          .then(async () => {
            await executeSnapshotRebuild({
              period: pending.period,
              recordsForBuild: pending.recordsForBuild,
              updateUi: true,
            })
          })
          .catch((err) => {
            console.warn('[snapshots] 自动刷新洞察失败:', err)
            setSnapshotsStale(true)
            setSnapshotStaleReason(
              pending.reason === 'period' ? 'period' : 'data',
            )
          })
      }, debounceMs)
    },
    [currentPeriod, executeSnapshotRebuild],
  )

  const rebuildSourceSnapshot = useCallback(
    async (dataSourceType) => {
      if (!currentPeriod) return
      setSnapshotRebuilding(dataSourceType)
      try {
        const snap = await rebuildSourceSnapshotService({
          adapter,
          period: currentPeriod,
          dataSourceType,
          feedbacks,
          settings,
        })
        setSourceSnapshots((prev) => ({ ...prev, [dataSourceType]: snap }))
        setSnapshotsStale(true)
        emit('SnapshotBuilt', { periodId: currentPeriodId, dataSourceType })
      } finally {
        setSnapshotRebuilding(null)
      }
    },
    [adapter, currentPeriod, feedbacks, currentPeriodId, settings],
  )

  const approveTagCandidate = useCallback(
    async (id, reviewNote = '') => {
      const candidate = tagCandidates.find((c) => c.id === id)
      if (!candidate) return

      const nextVersion = `taxonomy-managed-${Date.now()}`
      let snapshot = await getOrInitManagedSnapshot(adapter)
      snapshot = mergeCandidateIntoSnapshot(
        JSON.parse(JSON.stringify(snapshot)),
        candidate,
      )
      snapshot.tagLibraryVersion = nextVersion
      const taxState = await saveManagedTaxonomy(adapter, snapshot)
      setTaxonomyMeta(taxState)

      const updated = {
        ...candidate,
        status: /** @type {const} */ ('approved'),
        reviewedAt: new Date().toISOString(),
        reviewNote,
      }
      await adapter.putTagCandidate(updated)

      await reloadTagCandidates()
      setSnapshotsStale(true)
      emit('TagLibraryPublished', { version: nextVersion, candidateId: id })
      return {
        snapshot,
        candidate: updated,
        patchPackage: buildSingleCandidatePatchPackage(updated),
      }
    },
    [adapter, tagCandidates, reloadTagCandidates],
  )

  const approveTagCandidates = useCallback(
    async (ids, reviewNote = '') => {
      const idSet = new Set(ids)
      const targets = tagCandidates.filter((c) => idSet.has(c.id) && c.status === 'pending')
      if (!targets.length) return { approved: [], snapshot: null }

      const nextVersion = `taxonomy-managed-${Date.now()}`
      let snapshot = JSON.parse(JSON.stringify(await getOrInitManagedSnapshot(adapter)))
      for (const candidate of targets) {
        snapshot = mergeCandidateIntoSnapshot(snapshot, candidate)
      }
      snapshot.tagLibraryVersion = nextVersion
      const taxState = await saveManagedTaxonomy(adapter, snapshot)
      setTaxonomyMeta(taxState)

      const reviewedAt = new Date().toISOString()
      const approved = targets.map((candidate) => ({
        ...candidate,
        status: /** @type {const} */ ('approved'),
        reviewedAt,
        reviewNote,
      }))
      await adapter.putTagCandidates(approved)

      await reloadTagCandidates()
      setSnapshotsStale(true)
      emit('TagLibraryPublished', { version: nextVersion, count: approved.length })
      return { approved, snapshot }
    },
    [adapter, tagCandidates, reloadTagCandidates],
  )

  const getTaxonomyOverrides = useCallback(async () => {
    await adapter.init()
    const version = await adapter.getMeta(META_KEY_TAG_VERSION)
    const overrides =
      (await adapter.getMeta(META_KEY_OVERRIDES)) ||
      emptyOverrides(version || TAG_LIBRARY_VERSION_DEFAULT)
    return overrides
  }, [adapter])

  const getManagedTaxonomySnapshot = useCallback(async () => {
    await adapter.init()
    return getOrInitManagedSnapshot(adapter)
  }, [adapter])

  const saveManagedTaxonomySnapshot = useCallback(
    async (snapshot) => {
      const state = await saveManagedTaxonomy(adapter, snapshot)
      setTaxonomyMeta(state)
      setSettingsState((prev) => attachJourneyRules({ ...prev }))
      setSnapshotsStale(true)
      emit('TagLibraryPublished', { version: snapshot.tagLibraryVersion })
      return state
    },
    [adapter],
  )

  const repairBuiltinTaxonomyJourneysSnapshot = useCallback(async () => {
    const state = await repairBuiltinTaxonomyJourneys(adapter)
    setTaxonomyMeta(state)
    setSettingsState((prev) => attachJourneyRules({ ...prev }))
    setSnapshotsStale(true)
    return state
  }, [adapter])

  const importManagedTaxonomy = useCallback(
    async (buffer) => {
      const result = await importManagedTaxonomyIncremental(adapter, buffer)
      if (result.ok) {
        setTaxonomyMeta(result.state)
        setSettingsState((prev) => attachJourneyRules({ ...prev }))
        setSnapshotsStale(true)
        emit('TagLibraryPublished', { version: result.state?.tagLibraryVersion })
      }
      return result
    },
    [adapter],
  )

  const exportTaxonomyPatch = useCallback(
    async (format = 'json') => {
      const snapshot = await getManagedTaxonomySnapshot()
      if (format === 'excel') {
        downloadManagedTaxonomyExcel(snapshot)
        return { format: 'excel', snapshot }
      }
      const overrides = await getTaxonomyOverrides()
      const approvedCount = tagCandidates.filter((c) => c.status === 'approved').length
      const pkg = buildTaxonomyPatchPackage(overrides, { approvedCount })
      if (format === 'copy') {
        const ok = await copyTaxonomyPatchJson(pkg)
        return { format: 'copy', pkg, copied: ok }
      }
      downloadTaxonomyPatchJson(pkg)
      return { format: 'json', pkg }
    },
    [getTaxonomyOverrides, tagCandidates],
  )

  const markTagCandidatesMerged = useCallback(
    async (ids) => {
      const targets = ids?.length
        ? tagCandidates.filter((c) => ids.includes(c.id))
        : tagCandidates.filter((c) => c.status === 'approved')
      for (const c of targets) {
        if (c.status !== 'approved') continue
        await adapter.putTagCandidate({
          ...c,
          status: /** @type {const} */ ('merged'),
          reviewedAt: c.reviewedAt || new Date().toISOString(),
        })
      }
      await reloadTagCandidates()
    },
    [adapter, tagCandidates, reloadTagCandidates],
  )

  const rejectTagCandidate = useCallback(
    async (id, reviewNote = '') => {
      const candidate = tagCandidates.find((c) => c.id === id)
      if (!candidate) return
      const updated = {
        ...candidate,
        status: /** @type {const} */ ('rejected'),
        reviewedAt: new Date().toISOString(),
        reviewNote,
      }
      await adapter.putTagCandidate(updated)
      await reloadTagCandidates()
    },
    [adapter, tagCandidates, reloadTagCandidates],
  )

  const rejectTagCandidates = useCallback(
    async (ids, reviewNote = '') => {
      const idSet = new Set(ids)
      const targets = tagCandidates.filter((c) => idSet.has(c.id) && c.status === 'pending')
      if (!targets.length) return []

      const reviewedAt = new Date().toISOString()
      const rejected = targets.map((candidate) => ({
        ...candidate,
        status: /** @type {const} */ ('rejected'),
        reviewedAt,
        reviewNote,
      }))
      await adapter.putTagCandidates(rejected)
      await reloadTagCandidates()
      return rejected
    },
    [adapter, tagCandidates, reloadTagCandidates],
  )

  const rebuildAllSnapshots = useCallback(async () => {
    if (!currentPeriod || importLockRef.current) return
    clearTimeout(snapshotRebuildTimerRef.current)
    snapshotRebuildPendingRef.current = null
    await snapshotRebuildChainRef.current.catch(() => {})
    const task = executeSnapshotRebuild({
      period: currentPeriod,
      recordsForBuild: feedbacksRef.current,
      userInitiated: true,
    })
    snapshotRebuildChainRef.current = snapshotRebuildChainRef.current.then(() => task)
    try {
      const result = await task
      if (result?.userInitiated) {
        message.success(formatInsightRebuildSuccessMessage(result), 5)
      }
    } catch (err) {
      console.warn('[snapshots] 手动刷新洞察失败:', err)
      message.error(err instanceof Error ? err.message : '洞察生成失败', 6)
      setSnapshotsStale(true)
      setSnapshotStaleReason('data')
    }
  }, [currentPeriod, executeSnapshotRebuild, message])

  const polishPlanningRecommendations = useCallback(async () => {
    if (!currentPeriod || !overviewSnapshot?.conclusions) {
      throw new Error('请先生成洞察快照')
    }
    const polished = await polishPlanningRecommendationsWithLLM(
      overviewSnapshot.conclusions,
      settings,
    )
    const updated = {
      ...overviewSnapshot,
      conclusions: polished,
      generatedAt: new Date().toISOString(),
    }
    await adapter.putSnapshot(updated)
    setOverviewSnapshot(updated)
    return polished
  }, [adapter, currentPeriod, overviewSnapshot, settings])

  const setCurrentPeriodId = useCallback(
    async (id) => {
      setCurrentPeriodIdState(id)
      const p = periods.find((x) => x.id === id)
      const sel = selectionFromPeriod(p)
      try {
        await adapter.putMeta(META_CURRENT_PERIOD, id)
        if (sel) {
          await adapter.putMeta(META_PERIOD_SELECTION, sel)
        }
      } catch (err) {
        console.error('setCurrentPeriodId failed', err)
      }
    },
    [adapter, periods],
  )

  /** 按月/季/年选择洞察周期（自动落库，无需手工新建） */
  const selectInsightPeriod = useCallback(
    async (spec) => {
      const period = insightPeriodFromSpec(spec, SCHEMA_VERSION, DEFAULT_TENANT_ID)
      // 先更新 React 状态，避免等待 IndexedDB 写入后页面才刷新
      setCurrentPeriodIdState(period.id)
      setPeriods((prev) => {
        const idx = prev.findIndex((p) => p.id === period.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = period
          return next
        }
        return [...prev, period]
      })
      try {
        try {
          await adapter.putInsightPeriod(period)
        } catch (err) {
          console.warn('[storage] 同步洞察周期到共享库失败（查看者无 import 权限时可忽略）', err)
        }
        await adapter.putMeta(META_PERIOD_SELECTION, {
          granularity: spec.granularity,
          year: spec.anchorYear,
          month: spec.anchorMonth,
          quarter: spec.anchorQuarter,
          fromMonth: spec.customFromMonth,
          toMonth: spec.customToMonth,
        })
        await adapter.putMeta(META_CURRENT_PERIOD, period.id)
        await loadRecordsForPeriodId(period.id)
        await reloadSnapshots(period.id)
        const inPeriod = filterRecordsForScope(feedbacksRef.current, period)
        const loaded = await loadSnapshotsForPeriod(adapter, period.id)
        if (inPeriod.length > 0 && !snapshotsHavePeriodData(loaded)) {
          setSnapshotStaleReason('period')
          setSnapshotsStale(true)
          scheduleSnapshotRebuild({ period, reason: 'period', debounceMs: 300 })
        }
      } catch (err) {
        console.error('selectInsightPeriod failed', err)
      }
    },
    [adapter, loadRecordsForPeriodId, reloadSnapshots, scheduleSnapshotRebuild],
  )

  const reloadProductCatalog = useCallback(async () => {
    setProductCatalogReloading(true)
    try {
      initProductCatalogFromBuiltin()
      const managed = await loadManagedProductCatalog(adapter)
      const state = managed || initProductCatalogFromBuiltin()
      setProductCatalogMeta(state)
      return state
    } finally {
      setProductCatalogReloading(false)
    }
  }, [adapter])

  const getManagedProductCatalogSnapshot = useCallback(async () => {
    return getOrInitManagedProductCatalogSnapshot(adapter)
  }, [adapter])

  const saveManagedProductCatalogSnapshot = useCallback(
    async (products) => {
      const normalized = (products || []).map((p) => ({
        ...p,
        taxonomyKey: String(p.taxonomyKey || p.key || '').trim(),
      }))
      const state = await saveManagedProductCatalog(adapter, normalized)
      setProductCatalogMeta(state)
      const taxSnap = await getOrInitManagedSnapshot(adapter)
      const synced = syncCatalogProductsToTaxonomy(taxSnap, normalized)
      const taxState = await saveManagedTaxonomy(adapter, synced)
      setTaxonomyMeta(taxState)
      return normalized
    },
    [adapter],
  )

  const syncProductCatalogToTaxonomy = useCallback(async () => {
    const catalog = await getOrInitManagedProductCatalogSnapshot(adapter)
    const normalized = (catalog.products || []).map((p) => ({
      ...p,
      taxonomyKey: String(p.taxonomyKey || p.key || '').trim(),
    }))
    const taxSnap = await getOrInitManagedSnapshot(adapter)
    const synced = syncCatalogProductsToTaxonomy(taxSnap, normalized)
    const taxState = await saveManagedTaxonomy(adapter, synced)
    setTaxonomyMeta(taxState)
    return synced
  }, [adapter])

  const importManagedProductCatalogIncremental = useCallback(
    async (incoming, opts = {}) => {
      const result = await importManagedProductCatalog(adapter, incoming, opts)
      const state = await loadManagedProductCatalog(adapter)
      if (state) setProductCatalogMeta(state)
      const taxSnap = await getOrInitManagedSnapshot(adapter)
      const normalized = (result.products || []).map((p) => ({
        ...p,
        taxonomyKey: String(p.taxonomyKey || p.key || '').trim(),
      }))
      const synced = syncCatalogProductsToTaxonomy(taxSnap, normalized)
      const taxState = await saveManagedTaxonomy(adapter, synced)
      setTaxonomyMeta(taxState)
      return result
    },
    [adapter],
  )

  const reloadTaxonomy = useCallback(async () => {
    setTaxonomyReloading(true)
    try {
      initTaxonomyCacheFromBuiltin()
      const managed = await loadManagedTaxonomy(adapter)
      const state =
        managed || (await applyTaxonomyOverridesFromStorage()) || initTaxonomyCacheFromBuiltin()
      setTaxonomyMeta(state)
      setSettingsState((prev) => attachJourneyRules({ ...prev }))
      return state
    } finally {
      setTaxonomyReloading(false)
    }
  }, [adapter, applyTaxonomyOverridesFromStorage])

  const reloadAllConfigs = useCallback(async () => {
    setTaxonomyReloading(true)
    setProductCatalogReloading(true)
    try {
      initTaxonomyCacheFromBuiltin()
      initProductCatalogFromBuiltin()
      const [taxManaged, catalogManaged] = await Promise.all([
        loadManagedTaxonomy(adapter),
        loadManagedProductCatalog(adapter),
        loadPlanningConfig(),
        hydrateLearningCaches(adapter),
      ])
      const catalog = catalogManaged || initProductCatalogFromBuiltin()
      setProductCatalogMeta(catalog)
      let merged =
        taxManaged || (await applyTaxonomyOverridesFromStorage()) || initTaxonomyCacheFromBuiltin()
      if (catalog?.products?.length) {
        const taxSnap = await getOrInitManagedSnapshot(adapter)
        const normalized = (catalog.products || []).map((p) => ({
          ...p,
          taxonomyKey: String(p.taxonomyKey || p.key || '').trim(),
        }))
        const synced = syncCatalogProductsToTaxonomy(taxSnap, normalized)
        merged = taxonomySnapshotContentEqual(taxSnap, synced)
          ? applyManagedTaxonomySnapshot(taxSnap)
          : await saveManagedTaxonomy(adapter, synced)
      }
      setTaxonomyMeta(merged)
      setSettingsState((prev) => attachJourneyRules({ ...prev }))
      return { tax: merged, catalog }
    } finally {
      setTaxonomyReloading(false)
      setProductCatalogReloading(false)
    }
  }, [adapter, applyTaxonomyOverridesFromStorage])

  useEffect(() => {
    reloadAllConfigs()
  }, [reloadAllConfigs])

  // 共享 API 库：禁止把内存中的部分周期数据 debounce 成全量 replace（会删掉其他月份）。
  // 本机 IDB 仍用 debounce 全量写回；共享库仅通过 putRecord(s) / 导入 batch 增量写入。
  useEffect(() => {
    if (
      !storageReady ||
      !feedbacksHydrated ||
      feedbacksLoading ||
      clearInProgressRef.current ||
      skipPersistRef.current ||
      isApiStorageAdapter(adapter)
    ) {
      return
    }
    const timer = setTimeout(() => {
      if (clearInProgressRef.current || skipPersistRef.current) return
      persistFeedbacks(adapter, feedbacks).catch((err) => {
        console.warn('[v2 storage] persistFeedbacks failed:', err)
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [feedbacks, storageReady, feedbacksHydrated, feedbacksLoading, adapter])

  const setPersonalSettings = useCallback((patch) => {
    setSettingsState((prev) => {
      const { themeRules: _ignore, ...rest } = { ...prev, ...patch }
      const next = attachJourneyRules(rest)
      saveSettings(next)
      return next
    })
  }, [])

  const setTeamSettings = useCallback(
    (patch) => {
      setSettingsState((prev) => {
        const { themeRules: _ignore, ...rest } = { ...prev, ...patch }
        const next = attachJourneyRules(rest)
        saveSettings(next)
        if (storageReady && isApiStorageAdapter(adapter)) {
          saveTeamAppSettings(adapter, next).catch((err) => {
            console.warn('[storage] saveTeamAppSettings failed:', err)
          })
        }
        return next
      })
    },
    [adapter, storageReady],
  )

  /** @deprecated 请使用 setTeamSettings 或 setPersonalSettings */
  const setSettings = setTeamSettings

  /** @param {boolean} locked */
  const setImportLock = useCallback((locked) => {
    importLockRef.current = locked
  }, [])

  const beginImportSession = useCallback(
    /** @param {{ progress?: string; dataMonth?: string; batchName?: string; dataSourceType?: import('../domain/enums.js').DataSourceType; kind?: 'tickets' | 'analysis' }} [meta] */
    (meta = {}) => {
      if (reprocessingRef.current) {
        throw new Error(RETAG_IMPORT_BLOCKED_TIP)
      }
      if (importLockRef.current) {
        throw new Error(IMPORT_ALREADY_IN_PROGRESS_TIP)
      }
      importLockRef.current = true
      const progress = meta.progress || '正在准备…'
      setImportSession({
        active: true,
        progress,
        dataMonth: meta.dataMonth,
        batchName: meta.batchName,
        kind: meta.kind || 'tickets',
      })
      if (meta.dataMonth) {
        persistImportSessionMarker({
          startedAt: new Date().toISOString(),
          dataMonth: meta.dataMonth,
          batchName: meta.batchName,
          progress,
          dataSourceType: meta.dataSourceType,
        })
      }
    },
    [],
  )

  const setImportSessionProgress = useCallback(
    (progress) => {
      setImportSession((prev) => (prev.active ? { ...prev, progress } : prev))
      updateImportSessionMarkerProgress(progress)
      void touchSharedBackgroundTask({ progress })
    },
    [touchSharedBackgroundTask],
  )

  const endImportSession = useCallback(() => {
    importLockRef.current = false
    clearImportSessionMarker()
    setImportSession({
      active: false,
      progress: '',
      dataMonth: undefined,
      batchName: undefined,
      kind: undefined,
    })
    void releaseSharedBackgroundTask()
  }, [releaseSharedBackgroundTask])

  /**
   * 导入全流程成功结束（可在离开导入页后触发全局 Toast）
   * @param {import('../lib/importSession.js').ImportFinishedPayload} payload
   */
  const notifyImportFinished = useCallback(
    (payload) => {
      endImportSession()
      emit('ImportFinished', payload)
    },
    [endImportSession],
  )

  const beginRetagSession = useCallback(
    /** @param {{ total: number; scope?: import('../lib/retagSession.js').BulkRetagScope | 'all' }} meta */
    (meta) => {
      if (importLockRef.current) {
        throw new Error(RETAG_BLOCKED_BY_IMPORT_TIP)
      }
      if (reprocessingRef.current) {
        throw new Error(RETAG_IN_PROGRESS_TIP)
      }
      reprocessingRef.current = true
      setReprocessing(true)
      const progress = '正在准备…'
      setRetagSession({
        active: true,
        progress,
        total: meta.total,
        scope: meta.scope || 'all',
      })
      persistRetagSessionMarker({
        startedAt: new Date().toISOString(),
        total: meta.total,
        scope: meta.scope || 'all',
        progress,
      })
    },
    [],
  )

  const setRetagSessionProgress = useCallback(
    (progress) => {
      setRetagSession((prev) => (prev.active ? { ...prev, progress } : prev))
      updateRetagSessionMarkerProgress(progress)
      void touchSharedBackgroundTask({ progress })
    },
    [touchSharedBackgroundTask],
  )

  const endRetagSession = useCallback(() => {
    reprocessingRef.current = false
    setReprocessing(false)
    clearRetagSessionMarker()
    setRetagSession({
      active: false,
      progress: '',
      total: 0,
      scope: 'all',
    })
    void releaseSharedBackgroundTask()
  }, [releaseSharedBackgroundTask])

  /**
   * @param {{
   *   total: number
   *   beforeUnknown: number
   *   afterUnknown: number
   *   summary: ReturnType<typeof summarizeUnknownJourneyRecords>
   *   painPointDelta?: ReturnType<typeof summarizeRetagPainPointChanges>
   * }} result
   */
  const notifyRetagFinished = useCallback(
    (result) => {
      endRetagSession()
      emit('RetagFinished', result)
      const shouldRefreshInsights = result.painPointDelta?.shouldPromptInsightRefresh === true
      const ticketLlmFailed = result.ticketLlmFailed ?? 0
      const notify = ticketLlmFailed > 0 ? notification.warning : notification.success
      notify({
        message:
          ticketLlmFailed > 0
            ? '批量重新打标完成（部分 LLM 未生效）'
            : '批量重新打标完成',
        description: formatBulkRetagResultMessage(result),
        placement: 'topRight',
        duration: ticketLlmFailed > 0 ? 15 : shouldRefreshInsights ? 15 : 10,
        style: { whiteSpace: 'pre-wrap' },
        btn: shouldRefreshInsights ? (
          <Button
            type="primary"
            size="small"
            onClick={() => {
              notification.destroy()
              void rebuildAllSnapshots()
            }}
          >
            刷新洞察
          </Button>
        ) : undefined,
      })
    },
    [endRetagSession, rebuildAllSnapshots],
  )

  const addFeedbacks = useCallback(
    /**
     * @param {import('../lib/types.js').FeedbackRecord[]} records
     * @param {{ onUploadProgress?: (uploaded: number, total: number) => void }} [options]
     */
    async (records, options = {}) => {
      /** @type {Map<string, import('../lib/types.js').FeedbackRecord>} */
      const existingByTicketKey = new Map()
      const ticketSourceRecords = records.filter((record) => {
        const type = record.dataSourceType || 'complaint_ticket'
        return type === 'complaint_ticket' || type === 'consultation_ticket'
      })
      if (ticketSourceRecords.length && typeof adapter.listRecordsByTicketIds === 'function') {
        /** @type {Map<string, string[]>} */
        const idsBySource = new Map()
        for (const record of ticketSourceRecords) {
          const type = record.dataSourceType || 'complaint_ticket'
          const ticketId = String(record.ticketId || '').trim()
          if (!ticketId) continue
          const list = idsBySource.get(type) || []
          list.push(ticketId)
          idsBySource.set(type, list)
        }
        for (const [dataSourceType, ticketIds] of idsBySource) {
          const existingRows = await adapter.listRecordsByTicketIds(dataSourceType, ticketIds)
          for (const row of existingRows || []) {
            const key = ticketImportDuplicateKey(row)
            if (key) existingByTicketKey.set(key, row)
          }
        }
      }

      const { merged, added, updated, skippedDuplicates } = mergeFeedbacksInto(
        feedbacksRef.current,
        records,
        existingByTicketKey,
      )
      feedbacksRef.current = merged
      setFeedbacks(merged)

      const toPersist = [...added, ...updated]
      if (toPersist.length) {
        emit('ImportCompleted', {
          count: toPersist.length,
          periodId: currentPeriodId,
          skipStaleMark: true,
        })
      }

      if (toPersist.length && storageReady) {
        if (added.length) {
          setTotalRecordCount((n) => n + added.length)
        }
        if (currentPeriodId) {
          loadedPeriodIdsRef.current.add(currentPeriodId)
        }
        skipPersistRef.current = true
        try {
          const onProgress = options.onUploadProgress
          await adapter.putRecords(toPersist, {
            onProgress: onProgress
              ? (uploaded, total) => onProgress(uploaded, total)
              : undefined,
          })
          if (typeof adapter.getDataRevision === 'function') {
            const rev = await adapter.getDataRevision()
            dataRevisionRef.current = rev.revision
          } else {
            const rev = await fetchDataRevision()
            dataRevisionRef.current = rev.revision
          }
          void refreshImportMonthSummary()
        } finally {
          skipPersistRef.current = false
        }
      }

      return {
        added: added.length,
        updated: updated.length,
        skippedDuplicates,
        totalAfter: merged.length,
        analyzed: records.length,
      }
    },
    [adapter, currentPeriodId, storageReady, refreshImportMonthSummary],
  )

  const updateFeedback = useCallback(
    /**
     * @param {string} id
     * @param {Partial<import('../lib/types.js').FeedbackRecord>} patch
     * @param {import('../domain/recordRevision.js').PutRecordOptions & { mergeBase?: import('../lib/types.js').FeedbackRecord; skipTagCorrectionCapture?: boolean }} [options]
     */
    async (id, patch, options = {}) => {
      let existing =
        options.mergeBase ?? feedbacksRef.current.find((fb) => fb.id === id)
      if (!existing) {
        throw new Error('工单不存在或已删除')
      }
      // list 投影裁剪了大文本字段；编辑需全量作为 merge base，缺 rawText 时拉单条
      if (!('rawText' in existing) && typeof adapter.getRecord === 'function') {
        try {
          const full = await adapter.getRecord(id)
          if (full) existing = full
        } catch (err) {
          console.warn('[update] 拉取全量记录失败，使用缓存作为 merge base', err)
        }
      }
      const manualTagFields = mergeManualTagFieldsOnUserEdit(existing, patch)
      const merged = { ...existing, ...patch, manualTagFields }
      if (!options.skipTagCorrectionCapture) {
        const correctionEvents = buildCorrectionEventsFromEdit(existing, patch, {
          actor: recordWriteActor,
        })
        if (correctionEvents.length && storageReady) {
          void appendCorrectionEvents(adapter, correctionEvents).catch((err) => {
            console.warn('[learning] 采集改标事件失败', err)
          })
        }
      }
      // 是否听音：一旦为 true，全局不可再取消（含其他用户）
      merged.listeningReviewed =
        Boolean(existing.listeningReviewed) || Boolean(merged.listeningReviewed)
      const expectedRevision =
        options.expectedRevision ??
        (options.skipConflictCheck ? undefined : getRecordRevision(existing))
      const updated = applyRecordWriteMetadata(merged, {
        previousRevision: expectedRevision ?? getRecordRevision(existing),
        actor: recordWriteActor,
      })

      feedbacksRef.current = feedbacksRef.current.map((fb) => (fb.id === id ? updated : fb))
      setFeedbacks(feedbacksRef.current)
      if (storageReady) {
        const result = await persistRecordUpdate(adapter, updated, {
          expectedRevision,
          skipConflictCheck: options.skipConflictCheck,
          forceOverwrite: options.forceOverwrite,
        })
        const recordRevision =
          result?.recordRevision ?? updated.recordRevision
        const finalized = { ...updated, recordRevision }
        feedbacksRef.current = feedbacksRef.current.map((fb) => (fb.id === id ? finalized : fb))
        setFeedbacks(feedbacksRef.current)
        if (typeof adapter.getDataRevision === 'function') {
          try {
            const rev = await fetchDataRevision()
            dataRevisionRef.current = rev.revision
          } catch {
            /* ignore */
          }
        }
        return finalized
      }
      return updated
    },
    [adapter, storageReady, recordWriteActor],
  )

  const removeFeedback = useCallback(
    async (id) => {
      if (!id) throw new Error('工单不存在或已删除')
      let existing = feedbacksRef.current.find((fb) => fb.id === id) || null
      if (!existing && typeof adapter.getRecord === 'function') {
        try {
          existing = await adapter.getRecord(id)
        } catch {
          existing = null
        }
      }
      if (storageReady && existing) {
        await unlinkActionItemsForForceRetag([existing])
      }
      if (storageReady) {
        await adapter.deleteRecord(id)
      }
      feedbacksRef.current = feedbacksRef.current.filter((fb) => fb.id !== id)
      setFeedbacks(feedbacksRef.current)
      setSnapshotsStale(true)
      if (storageReady) {
        try {
          setTotalRecordCount(await getTotalRecordCount(adapter))
        } catch {
          setTotalRecordCount((n) => Math.max(0, (n || 1) - 1))
        }
        void refreshImportMonthSummary()
        if (typeof adapter.getDataRevision === 'function') {
          try {
            const rev = await fetchDataRevision()
            dataRevisionRef.current = rev.revision
          } catch {
            /* ignore */
          }
        }
      } else {
        setTotalRecordCount((n) => Math.max(0, (n || 1) - 1))
      }
    },
    [adapter, storageReady, refreshImportMonthSummary],
  )

  /**
   * 将服务端已写入的记录合并进本地列表（避免二次 put）。
   * @param {import('../lib/types.js').FeedbackRecord[]} records
   */
  const ingestUpdatedRecords = useCallback((records) => {
    if (!Array.isArray(records) || !records.length) return
    const byId = new Map(records.map((r) => [r.id, r]))
    feedbacksRef.current = feedbacksRef.current.map((fb) => byId.get(fb.id) || fb)
    setFeedbacks([...feedbacksRef.current])
  }, [])

  const importAnalysisResults = useCallback(
    /**
     * @param {import('../lib/importAnalysis.js').ImportAnalysisValidatedRow[]} validRows
     * @param {(text: string) => void} [reportProgress]
     */
    async (validRows, reportProgress) => {
      if (!validRows.length) {
        return {
          appliedRowCount: 0,
          skippedRowCount: 0,
          updatedRecordCount: 0,
          skippedUnknownTicketIds: [],
        }
      }

      if (reprocessingRef.current) {
        throw new Error(IMPORT_ANALYSIS_BLOCKED_BY_RETAG_TIP)
      }
      if (importLockRef.current) {
        throw new Error(IMPORT_ALREADY_IN_PROGRESS_TIP)
      }

      let sessionStarted = false
      const progress = (text) => {
        reportProgress?.(text)
        if (sessionStarted) setImportSessionProgress(text)
      }

      try {
        await prepareSharedBackgroundTask('import', {
          progress: '正在导入分析结果…',
          meta: {
            importKind: 'analysis',
            rowCount: validRows.length,
            batchName: IMPORT_ANALYSIS_SESSION_LABEL,
          },
        })
        beginImportSession({
          kind: 'analysis',
          batchName: IMPORT_ANALYSIS_SESSION_LABEL,
          progress: '正在导入分析结果…',
        })
        sessionStarted = true

        progress('正在加载库内工单…')
        await adapter.init()
        const { records: allRecords } = await fetchAllRecordPages(adapter)

        progress('正在匹配并覆盖分析字段…')
        const applyResult = applyImportAnalysisToRecords(allRecords, validRows)

        if (!applyResult.updatedRecords.length) {
          return {
            appliedRowCount: applyResult.appliedRowCount,
            skippedRowCount: applyResult.skippedRowCount,
            updatedRecordCount: 0,
            skippedUnknownTicketIds: applyResult.skippedUnknownTicketIds,
          }
        }

        progress('正在同步举措库…')
        const recordsWithActions = await mergeEstablishedActionLibraryForRecords(
          applyResult.updatedRecords,
        )
        /** @type {Map<string, import('../lib/types.js').FeedbackRecord>} */
        const updatedById = new Map(applyResult.updatedById)
        for (const record of recordsWithActions) {
          updatedById.set(record.id, record)
        }

        const mergedVisible = feedbacksRef.current.map((fb) =>
          updatedById.has(fb.id) ? updatedById.get(fb.id) : fb,
        )
        feedbacksRef.current = mergedVisible
        setFeedbacks(mergedVisible)

        if (storageReady) {
          skipPersistRef.current = true
          try {
            progress(`正在保存（0/${recordsWithActions.length}）…`)
            await persistRecordUpdates(adapter, recordsWithActions, {
              onProgress: (uploaded, total) => {
                progress(`正在保存（${uploaded}/${total}）…`)
              },
            })
            const actionIds = [
              ...new Set(
                recordsWithActions.map((r) => r.actionId?.trim()).filter(Boolean),
              ),
            ]
            if (actionIds.length) {
              progress('正在同步关联工单举措副本…')
              await syncLinkedTicketsForActionIds(actionIds, mergedVisible, updateFeedback)
            }
            if (typeof adapter.getDataRevision === 'function') {
              const rev = await adapter.getDataRevision()
              dataRevisionRef.current = rev.revision
            } else {
              const rev = await fetchDataRevision()
              dataRevisionRef.current = rev.revision
            }
          } finally {
            skipPersistRef.current = false
          }
        }

        if (currentPeriod) {
          progress('正在排队刷新洞察快照…')
          scheduleSnapshotRebuild({
            period: currentPeriod,
            recordsForBuild: mergedVisible,
            reason: 'data',
            debounceMs: 600,
          })
        }

        emit('ImportAnalysisCompleted', {
          appliedRowCount: applyResult.appliedRowCount,
          skippedRowCount: applyResult.skippedRowCount,
          updatedRecordCount: applyResult.updatedRecordCount,
          skippedUnknownTicketIds: applyResult.skippedUnknownTicketIds,
        })

        return {
          appliedRowCount: applyResult.appliedRowCount,
          skippedRowCount: applyResult.skippedRowCount,
          updatedRecordCount: applyResult.updatedRecordCount,
          skippedUnknownTicketIds: applyResult.skippedUnknownTicketIds,
        }
      } finally {
        if (sessionStarted) endImportSession()
        await releaseSharedBackgroundTask()
      }
    },
    [
      adapter,
      beginImportSession,
      currentPeriod,
      endImportSession,
      prepareSharedBackgroundTask,
      releaseSharedBackgroundTask,
      scheduleSnapshotRebuild,
      setImportSessionProgress,
      storageReady,
      updateFeedback,
    ],
  )

  const importCustomerRestore = useCallback(
    /**
     * @param {{ ticketId: string, fields: Record<string, string> }[]} validRows
     * @param {(text: string) => void} [reportProgress]
     */
    async (validRows, reportProgress) => {
      if (!validRows.length) {
        return {
          appliedRowCount: 0,
          skippedRowCount: 0,
          updatedRecordCount: 0,
          unchangedRecordCount: 0,
          skippedUnknownTicketIds: [],
        }
      }

      if (reprocessingRef.current) {
        throw new Error(IMPORT_ANALYSIS_BLOCKED_BY_RETAG_TIP)
      }
      if (importLockRef.current) {
        throw new Error(IMPORT_ALREADY_IN_PROGRESS_TIP)
      }

      let sessionStarted = false
      const progress = (text) => {
        reportProgress?.(text)
        if (sessionStarted) setImportSessionProgress(text)
      }

      try {
        await prepareSharedBackgroundTask('import', {
          progress: '正在复原客户信息…',
          meta: {
            importKind: 'customer_restore',
            rowCount: validRows.length,
            batchName: CUSTOMER_RESTORE_SESSION_LABEL,
          },
        })
        beginImportSession({
          kind: 'customer_restore',
          batchName: CUSTOMER_RESTORE_SESSION_LABEL,
          progress: '正在复原客户信息…',
        })
        sessionStarted = true

        progress('正在加载库内工单…')
        await adapter.init()
        const { records: allRecords } = await fetchAllRecordPages(adapter)

        progress('正在按工单号回写客户字段…')
        const applyResult = applyCustomerRestoreToRecords(allRecords, validRows)

        if (!applyResult.updatedRecords.length) {
          return {
            appliedRowCount: applyResult.appliedRowCount,
            skippedRowCount: applyResult.skippedRowCount,
            updatedRecordCount: 0,
            unchangedRecordCount: applyResult.unchangedRecordCount,
            skippedUnknownTicketIds: applyResult.skippedUnknownTicketIds,
          }
        }

        const updatedById = applyResult.updatedById
        const mergedVisible = feedbacksRef.current.map((fb) =>
          updatedById.has(fb.id) ? updatedById.get(fb.id) : fb,
        )
        feedbacksRef.current = mergedVisible
        setFeedbacks(mergedVisible)

        if (storageReady) {
          skipPersistRef.current = true
          try {
            progress(`正在保存（0/${applyResult.updatedRecords.length}）…`)
            await persistRecordUpdates(adapter, applyResult.updatedRecords, {
              onProgress: (uploaded, total) => {
                progress(`正在保存（${uploaded}/${total}）…`)
              },
            })
            if (typeof adapter.getDataRevision === 'function') {
              const rev = await adapter.getDataRevision()
              dataRevisionRef.current = rev.revision
            } else {
              const rev = await fetchDataRevision()
              dataRevisionRef.current = rev.revision
            }
          } finally {
            skipPersistRef.current = false
          }
        }

        if (currentPeriod) {
          progress('正在排队刷新洞察快照…')
          scheduleSnapshotRebuild({
            period: currentPeriod,
            recordsForBuild: mergedVisible,
            reason: 'data',
            debounceMs: 600,
          })
        }

        emit('CustomerRestoreCompleted', {
          appliedRowCount: applyResult.appliedRowCount,
          skippedRowCount: applyResult.skippedRowCount,
          updatedRecordCount: applyResult.updatedRecordCount,
          skippedUnknownTicketIds: applyResult.skippedUnknownTicketIds,
        })

        return {
          appliedRowCount: applyResult.appliedRowCount,
          skippedRowCount: applyResult.skippedRowCount,
          updatedRecordCount: applyResult.updatedRecordCount,
          unchangedRecordCount: applyResult.unchangedRecordCount,
          skippedUnknownTicketIds: applyResult.skippedUnknownTicketIds,
        }
      } finally {
        if (sessionStarted) endImportSession()
        await releaseSharedBackgroundTask()
      }
    },
    [
      adapter,
      beginImportSession,
      currentPeriod,
      endImportSession,
      prepareSharedBackgroundTask,
      releaseSharedBackgroundTask,
      scheduleSnapshotRebuild,
      setImportSessionProgress,
      storageReady,
    ],
  )

  const replaceAll = useCallback(
    async (records) => {
      setFeedbacks(records)
      setTotalRecordCount(records.length)
      loadedPeriodIdsRef.current = new Set(periods.map((p) => p.id))
      if (storageReady) {
        skipPersistRef.current = true
        try {
          if (isApiStorageAdapter(adapter)) {
            await adapter.replaceAllRecords(records)
            const rev = await fetchDataRevision()
            dataRevisionRef.current = rev.revision
          } else {
            await persistFeedbacks(adapter, records)
          }
        } finally {
          skipPersistRef.current = false
        }
      }
    },
    [adapter, storageReady, periods],
  )

  const clearImportedData = useCallback(
    async (options = {}) => {
      if (reprocessingRef.current) {
        throw new Error(RETAG_IN_PROGRESS_TIP)
      }
      const validationError = validateClearImportedDataOptions(options)
      if (validationError) {
        throw new Error(validationError)
      }
      const clearAllData = isClearAllImportedData(options)
      const period = options.insightPeriodId
        ? resolveInsightPeriod(
            options.insightPeriodId,
            periods.find((p) => p.id === options.insightPeriodId) ?? null,
          )
        : null

      clearInProgressRef.current = true
      try {
        if (storageReady) {
          await clearAllImportedData(adapter, options)
        }
        if (clearAllData) {
          feedbacksRef.current = []
          setFeedbacks([])
          setTotalRecordCount(0)
          setImportMonthSummary({ months: [], bySource: [], total: 0 })
          loadedPeriodIdsRef.current = new Set()
          setSourceSnapshots({})
          setOverviewSnapshot(null)
          setSnapshotsStale(false)
        } else {
          setFeedbacks((prev) =>
            prev.filter((fb) => !recordMatchesClearFilter(fb, options, period)),
          )
          feedbacksRef.current = feedbacksRef.current.filter(
            (fb) => !recordMatchesClearFilter(fb, options, period),
          )
          if (options.insightPeriodId) {
            loadedPeriodIdsRef.current.delete(options.insightPeriodId)
          }
        }
        if (storageReady) {
          if (clearAllData) {
            const remaining = await getTotalRecordCount(adapter)
            if (remaining > 0) {
              await clearAllImportedData(adapter, options)
              feedbacksRef.current = []
              setFeedbacks([])
              setTotalRecordCount(0)
            }
          } else {
            setTotalRecordCount(await getTotalRecordCount(adapter))
          }
          void refreshImportMonthSummary()
          await reloadSnapshots(currentPeriodId)
          await reloadTagCandidates()
        }
      } finally {
        clearInProgressRef.current = false
      }
    },
    [adapter, storageReady, currentPeriodId, periods, reloadSnapshots, reloadTagCandidates, refreshImportMonthSummary],
  )

  const clearAll = useCallback(async () => clearImportedData({ all: true }), [clearImportedData])

  const reprocessOne = useCallback(
    async (id) => {
      if (reprocessingRef.current) return
      const fb = feedbacksRef.current.find((f) => f.id === id)
      if (!fb) return

      setReprocessing(true)
      reprocessingRef.current = true
      try {
        const llmSettings = attachJourneyRules({
          ...loadSettings(),
          ...settings,
          ...(await resolveSettingsForLlm(settings)),
        })
        const retagged = reprocessFeedbackRecord(fb, llmSettings)
        const [updated] = await reprocessAllThemesAndSentiment([retagged], llmSettings)
        const withMeta = applyRecordWriteMetadata(
          { ...updated, id: fb.id },
          { previousRevision: getRecordRevision(fb), actor: recordWriteActor },
        )
        feedbacksRef.current = feedbacksRef.current.map((f) => (f.id === id ? withMeta : f))
        setFeedbacks(feedbacksRef.current)
        if (storageReady) {
          const result = await persistRecordUpdate(adapter, withMeta)
          const finalized = {
            ...withMeta,
            recordRevision: result?.recordRevision ?? withMeta.recordRevision,
          }
          feedbacksRef.current = feedbacksRef.current.map((f) => (f.id === id ? finalized : f))
          setFeedbacks(feedbacksRef.current)
          if (typeof adapter.getDataRevision === 'function') {
            const rev = await fetchDataRevision()
            dataRevisionRef.current = rev.revision
          }
        }
        if (currentPeriod) {
          scheduleSnapshotRebuild({
            period: currentPeriod,
            recordsForBuild: feedbacksRef.current,
            reason: 'data',
            debounceMs: 600,
          })
        }
      } finally {
        reprocessingRef.current = false
        setReprocessing(false)
      }
    },
    [adapter, settings, storageReady, recordWriteActor, currentPeriod, scheduleSnapshotRebuild],
  )

  const reprocessAllCustomerQuotes = useCallback(
    async (reportProgress) => {
      const progress = (text) => reportProgress?.(text)
      setReprocessing(true)
      reprocessingRef.current = true
      try {
        // 全库重算：可见缓存可能仅含已加载周期，须从存储拉全量
        progress('正在加载全部记录…')
        const allRecords = await listAllFeedbacks(adapter)
        if (!allRecords.length) return 0
        progress(`正在重算客户原话（共 ${allRecords.length} 条）…`)
        const updated = allRecords.map((fb) => reprocessCustomerQuoteForRecord(fb, settings))
        const updatedById = new Map(updated.map((fb) => [fb.id, fb]))
        const mergedVisible = feedbacksRef.current.map((fb) => updatedById.get(fb.id) ?? fb)
        feedbacksRef.current = mergedVisible
        setFeedbacks(mergedVisible)
        if (storageReady) {
          skipPersistRef.current = true
          try {
            progress(`正在保存到服务器（0/${updated.length}）…`)
            await persistRecordUpdates(adapter, updated, {
              onProgress: (uploaded, total) => {
                progress(`正在保存到服务器（${uploaded}/${total}）…`)
              },
            })
            if (typeof adapter.getDataRevision === 'function') {
              const rev = await adapter.getDataRevision()
              dataRevisionRef.current = rev.revision
            }
          } finally {
            skipPersistRef.current = false
          }
        }
        if (currentPeriod) {
          progress('正在排队刷新洞察快照…')
          scheduleSnapshotRebuild({
            period: currentPeriod,
            recordsForBuild: updated,
            reason: 'data',
            debounceMs: 600,
          })
        }
        return updated.length
      } finally {
        reprocessingRef.current = false
        setReprocessing(false)
      }
    },
    [adapter, settings, currentPeriod, scheduleSnapshotRebuild, storageReady],
  )

  const reprocessAllTagsCore = useCallback(
    async (targetRecords, reportProgress, options = {}) => {
      let list = targetRecords?.length ? targetRecords : feedbacksRef.current
      if (!list.length) return null
      const progress = (text) => reportProgress?.(text)

      // list 投影裁剪了大文本字段；retag 需要全量语料，缺 rawText 时按周期拉全量再按 id 还原
      if (list.some((r) => !('rawText' in r))) {
        progress('正在加载全量记录…')
        try {
          const full = await fetchAllRecordPages(adapter, {
            insightPeriodId: currentPeriodId,
            fields: 'full',
          })
          const byId = new Map(full.records.map((r) => [r.id, r]))
          list = list
            .map((r) => byId.get(r.id) ?? r)
            .filter((r) => 'rawText' in r || (r.handlingText || r.rawText))
        } catch (err) {
          console.warn('[retag] 全量记录加载失败，回退使用缓存', err)
        }
      }

      const scope = options.scope || 'period_all'
      const total = list.length
      const beforeUnknown = listUnknownJourneyRecords(list).length
      const painPointBefore = new Map(
        list.map((record) => [record.id, (record.painPoint || '').trim()]),
      )
      const ticketLlmOnly = scope === 'needs_ticket_llm'
      const journeyLlmOnly = scope === 'needs_journey_llm'

      progress('正在加载配置…')
      await reloadAllConfigs()
      const llmSettings = attachJourneyRules({
        ...loadSettings(),
        ...settings,
        ...(await resolveSettingsForLlm(settings)),
      })

      /** @param {import('../lib/types.js').FeedbackRecord[]} chunk */
      const mergePersistedChunk = (chunk) => {
        const byId = new Map(
          chunk.map((record) => {
            const prev = feedbacksRef.current.find((fb) => fb.id === record.id)
            const next = applyRecordWriteMetadata(record, {
              previousRevision: getRecordRevision(prev ?? record),
              actor: recordWriteActor,
            })
            return [record.id, next]
          }),
        )
        const mergedAll = feedbacksRef.current.map((fb) => byId.get(fb.id) ?? fb)
        feedbacksRef.current = mergedAll
        setFeedbacks(mergedAll)
      }

      /** @param {import('../lib/types.js').FeedbackRecord[]} chunk */
      const persistChunkIncremental = async (chunk) => {
        if (!storageReady || !chunk.length) return
        skipPersistRef.current = true
        try {
          await persistRecordUpdates(adapter, chunk)
          mergePersistedChunk(chunk)
          if (typeof adapter.getDataRevision === 'function') {
            const rev = await adapter.getDataRevision()
            dataRevisionRef.current = rev.revision
          }
        } finally {
          skipPersistRef.current = false
        }
      }

      /** @type {import('../lib/types.js').FeedbackRecord[]} */
      let retagged
      const forceOverride = options.forceOverrideManualTags === true
      if (forceOverride) {
        progress('正在解关联举措库…')
        try {
          await unlinkActionItemsForForceRetag(list)
        } catch (err) {
          console.warn('[retag] 举措库解关联失败:', err)
        }
      }
      if (ticketLlmOnly || journeyLlmOnly) {
        retagged = forceOverride ? list.map((fb) => applyForceRetagOverrides(fb)) : [...list]
      } else {
        retagged = []
        const batchSize = 50
        for (let i = 0; i < list.length; i += batchSize) {
          const chunk = list.slice(i, i + batchSize)
          for (const fb of chunk) {
            retagged.push(
              reprocessFeedbackRecord(fb, llmSettings, {
                forceOverrideManualTags: options.forceOverrideManualTags === true,
              }),
            )
          }
          progress(`正在规则初标 (${Math.min(i + batchSize, total)}/${total})…`)
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }

      const updatedSubset = await reprocessAllThemesAndSentiment(
        retagged,
        llmSettings,
        (done, t, stage) => {
          progress(`正在${stage || '增强打标'} (${done}/${t})…`)
        },
        {
          forceOverrideManualTags: options.forceOverrideManualTags === true,
          ticketLlmOnly,
          journeyLlmOnly,
          retagDimensionsAfterTicketLlm: options.retagDimensionsAfterTicketLlm,
          onTicketLlmBatchPersist: persistChunkIncremental,
        },
      )

      const byId = new Map(
        updatedSubset.map((record) => {
          const prev = feedbacksRef.current.find((fb) => fb.id === record.id)
          const next = applyRecordWriteMetadata(record, {
            previousRevision: getRecordRevision(prev ?? record),
            actor: recordWriteActor,
          })
          return [record.id, next]
        }),
      )
      const mergedAll = feedbacksRef.current.map((fb) => byId.get(fb.id) ?? fb)
      feedbacksRef.current = mergedAll
      setFeedbacks(mergedAll)
      if (storageReady) {
        skipPersistRef.current = true
        try {
          progress('正在保存到共享库…')
          await persistRecordUpdates(adapter, updatedSubset)
          if (typeof adapter.getDataRevision === 'function') {
            const rev = await adapter.getDataRevision()
            dataRevisionRef.current = rev.revision
          }
        } finally {
          skipPersistRef.current = false
        }
      }
      if (currentPeriod) {
        scheduleSnapshotRebuild({
          period: currentPeriod,
          recordsForBuild: mergedAll,
          reason: 'data',
          debounceMs: 600,
        })
      }
      const afterUnknown = listUnknownJourneyRecords(updatedSubset).length
      const painPointDelta = summarizeRetagPainPointChanges(
        list.map((record) => ({
          id: record.id,
          painPoint: painPointBefore.get(record.id) || '',
        })),
        updatedSubset,
      )
      const ticketLlmStats = journeyLlmOnly
        ? null
        : computeTicketLlmEnrichmentDelta(list, updatedSubset)
      return {
        total: updatedSubset.length,
        beforeUnknown,
        afterUnknown,
        scope,
        summary: summarizeUnknownJourneyRecords(updatedSubset),
        painPointDelta,
        ticketLlmCompleted: ticketLlmStats?.ticketLlmCompleted ?? 0,
        ticketLlmFailed: ticketLlmStats?.ticketLlmFailed ?? 0,
      }
    },
    [
      adapter,
      settings,
      reloadAllConfigs,
      currentPeriod,
      currentPeriodId,
      scheduleSnapshotRebuild,
      storageReady,
      recordWriteActor,
    ],
  )

  const startBulkRetag = useCallback(
    async (options = {}) => {
      const { scope = 'period_all', records, forceOverrideManualTags = false, retagDimensionsAfterTicketLlm } = options
      const list = records?.length ? records : feedbacksRef.current
      if (!list.length) return null
      if (importLockRef.current) {
        throw new Error(RETAG_BLOCKED_BY_IMPORT_TIP)
      }
      if (reprocessingRef.current) {
        throw new Error(RETAG_IN_PROGRESS_TIP)
      }

      await prepareSharedBackgroundTask('retag', {
        progress: '正在准备…',
        meta: { scope, total: list.length },
      })
      beginRetagSession({ total: list.length, scope })
      try {
        const result = await reprocessAllTagsCore(list, setRetagSessionProgress, {
          scope,
          forceOverrideManualTags,
          retagDimensionsAfterTicketLlm,
        })
        if (result) notifyRetagFinished(result)
        return result
      } catch (err) {
        endRetagSession()
        throw err
      }
    },
    [
      beginRetagSession,
      endRetagSession,
      notifyRetagFinished,
      prepareSharedBackgroundTask,
      reprocessAllTagsCore,
      setRetagSessionProgress,
    ],
  )

  const reprocessAllTags = startBulkRetag

  /**
   * 执行已注册 Pipeline（WP3 导入联调入口）
   * @param {import('../domain/enums.js').DataSourceType} dataSourceType
   * @param {Object[]} rows
   * @param {{ importBatchId?: string; importBatchName?: string; fileSha256?: string }} [meta]
   */
  const ensurePeriodForImportMonth = useCallback(
    async (importMonth) => {
      const normalized = normalizeImportMonth(importMonth)
      if (!normalized) throw new Error('无效的数据月份')
      const spec = periodSpecFromImportMonth(normalized)
      const period = insightPeriodFromSpec(spec, SCHEMA_VERSION, DEFAULT_TENANT_ID)
      try {
        await adapter.init()
        await adapter.putInsightPeriod(period)
      } catch (err) {
        console.warn('[import] 持久化洞察周期失败，继续使用内存周期:', err)
      }
      setPeriods((prev) => {
        const idx = prev.findIndex((p) => p.id === period.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = period
          return next
        }
        return [...prev, period]
      })
      return period
    },
    [adapter],
  )

  const runPipeline = useCallback(
    async (dataSourceType, rows, meta = {}) => {
      await adapter.init()
      const pipeline = createPipeline(dataSourceType)
      const desc = getPipelineDescriptor(dataSourceType)
      const versions = defaultAnalysisVersions()

      const importMonth = meta.importMonth
        ? normalizeImportMonth(meta.importMonth)
        : null
      const period = importMonth
        ? await ensurePeriodForImportMonth(importMonth)
        : periods.find((p) => p.id === currentPeriodId) || null
      const insightPeriodId = period?.id || currentPeriodId

      const idempotencyKey = buildIdempotencyKey({
        insightPeriodId,
        dataSourceType,
        importBatchId: meta.importBatchId,
        fileSha256: meta.fileSha256,
      })

      const existing = await adapter.findRunByIdempotencyKey(idempotencyKey)
      if (
        existing &&
        (existing.status === 'queued' || existing.status === 'running')
      ) {
        throw new Error('相同导入批次正在分析中，请稍候完成后再试')
      }
      if (existing?.status === 'succeeded' && !meta.force) {
        const finished = existing.finishedAt ? new Date(existing.finishedAt).getTime() : 0
        if (finished && Date.now() - finished < 24 * 3600 * 1000) {
          const err = new Error('DUPLICATE_RUN')
          err.code = 'DUPLICATE_RUN'
          err.existingRun = existing
          throw err
        }
      }

      /** @type {import('../analysis/core/AnalysisContext.js').AnalysisContext} */
      const ctx = {
        tenantId: DEFAULT_TENANT_ID,
        insightPeriodId,
        dataSourceType,
        importBatchId: meta.importBatchId,
        importBatchName: meta.importBatchName,
        fileSha256: meta.fileSha256,
        settings: meta.settings || settings,
        pipelineVersion: desc?.pipelineVersion || versions.pipelineVersion,
        tagLibraryVersion: versions.tagLibraryVersion,
      }

      const validation = pipeline.validate(rows, ctx)
      if (!validation.ok) {
        throw new Error(validation.errors?.join('；') || '校验失败')
      }

      const startedAt = new Date().toISOString()
      const { records, failures, collector } = await pipeline.analyze(rows, ctx, {
        insightPeriod: period || undefined,
      })

      const status =
        failures.length === 0
          ? 'succeeded'
          : records.length > 0
            ? 'partial_failed'
            : 'failed'

      const run = pipeline.buildRun(ctx, rows.length, records.length, failures, status)
      run.idempotencyKey = idempotencyKey
      run.startedAt = startedAt
      run.finishedAt = new Date().toISOString()
      pipeline.finalizeRun(
        run,
        records.map((r) => r.id),
      )

      await adapter.putAnalysisRun(run)
      await adapter.putArtifact(collector.buildRunArtifact())
      for (const art of collector.recordArtifacts) {
        await adapter.putArtifact(art)
      }

      emit('AnalysisRunFinished', { runId: run.id, dataSourceType, status })

      return { run, records, failures }
    },
    [adapter, currentPeriodId, periods, settings, ensurePeriodForImportMonth],
  )

  /**
   * 按数据月份重建快照（不切换工作台当前周期）
   * @param {string} importMonth YYYY-MM
   * @param {import('../lib/types.js').FeedbackRecord[]} [newRecords] 本批刚导入、可能尚未写入 state 的记录
   */
  const rebuildSnapshotsForImportMonth = useCallback(
    async (importMonth, newRecords = []) => {
      const period = await ensurePeriodForImportMonth(importMonth)
      const merged = [...feedbacksRef.current]
      const seen = new Set(merged.map((f) => f.id))
      for (const r of newRecords) {
        if (!seen.has(r.id)) {
          merged.push(r)
          seen.add(r.id)
        }
      }

      clearTimeout(snapshotRebuildTimerRef.current)
      snapshotRebuildPendingRef.current = null
      await snapshotRebuildChainRef.current
      snapshotRebuildChainRef.current = snapshotRebuildChainRef.current.then(() =>
        executeSnapshotRebuild({
          period,
          recordsForBuild: merged,
          updateUi: period.id === currentPeriodId,
        }),
      )
      await snapshotRebuildChainRef.current
      emit('SnapshotBuilt', { periodId: period.id, scope: 'all', importMonth })
    },
    [ensurePeriodForImportMonth, currentPeriodId, executeSnapshotRebuild],
  )

  const value = useMemo(
    () => ({
      feedbacks,
      totalRecordCount,
      importMonthSummary,
      feedbacksLoading,
      settings,
      setSettings,
      setPersonalSettings,
      setTeamSettings,
      addFeedbacks,
      setImportLock,
      importSession,
      beginImportSession,
      prepareSharedBackgroundTask,
      touchSharedBackgroundTask,
      releaseSharedBackgroundTask,
      setImportSessionProgress,
      endImportSession,
      notifyImportFinished,
      retagSession,
      sharedBackgroundTask,
      startBulkRetag,
      updateFeedback,
      removeFeedback,
      ingestUpdatedRecords,
      importAnalysisResults,
      importCustomerRestore,
      replaceAll,
      clearAll,
      clearImportedData,
      reprocessOne,
      reprocessAllCustomerQuotes,
      reprocessAllTags,
      reprocessing,
      taxonomyMeta,
      taxonomyReloading,
      reloadTaxonomy,
      productCatalogMeta,
      productCatalogReloading,
      reloadProductCatalog,
      getManagedProductCatalogSnapshot,
      saveManagedProductCatalog: saveManagedProductCatalogSnapshot,
      importManagedProductCatalog: importManagedProductCatalogIncremental,
      syncProductCatalogToTaxonomy,
      reloadAllConfigs,
      periods,
      currentPeriodId,
      currentPeriod,
      periodsLoading,
      storageReady,
      setCurrentPeriodId,
      selectInsightPeriod,
      reloadPeriods,
      listPipelineDescriptors,
      createPipeline,
      getComparableMetrics,
      getMetricsForSource,
      listMetricDescriptors,
      runPipeline,
      adapter,
      sourceSnapshots,
      overviewSnapshot,
      snapshotsStale,
      snapshotStaleReason,
      snapshotRebuilding,
      scheduleSnapshotRebuild,
      reloadSnapshots,
      rebuildSourceSnapshot,
      rebuildAllSnapshots,
      rebuildSnapshotsForImportMonth,
      polishPlanningRecommendations,
      markSnapshotsStale,
      tagCandidates,
      tagCandidatesLoading,
      reloadTagCandidates,
      mergeDuplicateTagCandidates,
      approveTagCandidate,
      approveTagCandidates,
      rejectTagCandidate,
      rejectTagCandidates,
      getTaxonomyOverrides,
      exportTaxonomyPatch,
      markTagCandidatesMerged,
      getManagedTaxonomySnapshot,
      saveManagedTaxonomy: saveManagedTaxonomySnapshot,
      repairBuiltinTaxonomyJourneys: repairBuiltinTaxonomyJourneysSnapshot,
      importManagedTaxonomyIncremental: importManagedTaxonomy,
      orderVolumes,
      orderVolumesLoading,
      reloadOrderVolumes,
      saveOrderVolume,
      wanTouTargets,
      wanTouTargetsLoading,
      reloadWanTouTargets,
      saveWanTouTarget,
      syncSharedDataFromServer,
    }),
    [
      feedbacks,
      totalRecordCount,
      importMonthSummary,
      feedbacksLoading,
      settings,
      setSettings,
      setPersonalSettings,
      setTeamSettings,
      addFeedbacks,
      setImportLock,
      importSession,
      beginImportSession,
      prepareSharedBackgroundTask,
      touchSharedBackgroundTask,
      releaseSharedBackgroundTask,
      setImportSessionProgress,
      endImportSession,
      notifyImportFinished,
      retagSession,
      sharedBackgroundTask,
      startBulkRetag,
      updateFeedback,
      removeFeedback,
      ingestUpdatedRecords,
      importAnalysisResults,
      importCustomerRestore,
      replaceAll,
      clearAll,
      clearImportedData,
      reprocessOne,
      reprocessAllCustomerQuotes,
      reprocessAllTags,
      reprocessing,
      taxonomyMeta,
      taxonomyReloading,
      reloadTaxonomy,
      productCatalogMeta,
      productCatalogReloading,
      reloadProductCatalog,
      getManagedProductCatalogSnapshot,
      saveManagedProductCatalogSnapshot,
      importManagedProductCatalogIncremental,
      reloadAllConfigs,
      periods,
      currentPeriodId,
      currentPeriod,
      periodsLoading,
      storageReady,
      setCurrentPeriodId,
      selectInsightPeriod,
      reloadPeriods,
      runPipeline,
      adapter,
      sourceSnapshots,
      overviewSnapshot,
      snapshotsStale,
      snapshotStaleReason,
      snapshotRebuilding,
      scheduleSnapshotRebuild,
      reloadSnapshots,
      rebuildSourceSnapshot,
      rebuildAllSnapshots,
      rebuildSnapshotsForImportMonth,
      polishPlanningRecommendations,
      markSnapshotsStale,
      tagCandidates,
      tagCandidatesLoading,
      reloadTagCandidates,
      mergeDuplicateTagCandidates,
      approveTagCandidate,
      approveTagCandidates,
      rejectTagCandidate,
      rejectTagCandidates,
      getTaxonomyOverrides,
      exportTaxonomyPatch,
      markTagCandidatesMerged,
      getManagedTaxonomySnapshot,
      saveManagedTaxonomySnapshot,
      repairBuiltinTaxonomyJourneysSnapshot,
      importManagedTaxonomy,
      orderVolumes,
      orderVolumesLoading,
      reloadOrderVolumes,
      saveOrderVolume,
      wanTouTargets,
      wanTouTargetsLoading,
      reloadWanTouTargets,
      saveWanTouTarget,
      syncSharedDataFromServer,
    ],
  )

  return (
    <InsightsContext.Provider value={value}>{children}</InsightsContext.Provider>
  )
}

export function useInsights() {
  const ctx = useContext(InsightsContext)
  if (!ctx) throw new Error('useInsights must be used within InsightsProvider')
  return ctx
}
