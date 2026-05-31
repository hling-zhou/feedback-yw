import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { notification } from 'antd'
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
  getTotalRecordCount,
  persistFeedbacks,
  persistRecordUpdate,
  persistRecordUpdates,
  isApiStorageAdapter,
  clearAllFeedbacks,
} from '../storage/feedbackStore.js'
import {
  isClearAllImportedData,
  recordMatchesClearFilter,
  validateClearImportedDataOptions,
} from '../storage/clearImportedData.js'
import { fetchAllRecordPages } from '../lib/recordLoader.js'
import { reprocessCustomerQuoteForRecord, reprocessFeedbackRecord } from '../lib/pipeline.js'
import { mergeManualTagFieldsOnUserEdit } from '../lib/manualTagFields.js'
import { reprocessAllThemesAndSentiment } from '../lib/applyThemes.js'
import {
  formatBulkRetagResultMessage,
  listUnknownJourneyRecords,
  summarizeUnknownJourneyRecords,
} from '../lib/journeyRetagSummary.js'
import {
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
  insightPeriodFromSpec,
  normalizeInsightPeriod,
  periodSpecFromImportMonth,
  selectionFromPeriod,
} from '../domain/insightPeriod.js'
import { normalizeImportMonth } from '../lib/importUtils.js'
import {
  clearImportSessionMarker,
  persistImportSessionMarker,
  updateImportSessionMarkerProgress,
} from '../lib/importSession.js'
import {
  RETAG_BLOCKED_BY_IMPORT_TIP,
  RETAG_IMPORT_BLOCKED_TIP,
  RETAG_IN_PROGRESS_TIP,
  clearRetagSessionMarker,
  persistRetagSessionMarker,
  updateRetagSessionMarkerProgress,
} from '../lib/retagSession.js'
import { SCHEMA_VERSION } from '../domain/constants.js'
import { buildDedupeKey } from '../domain/records.js'
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
import {
  SNAPSHOT_AUTO_REBUILD_DEBOUNCE_MS,
  snapshotsHavePeriodData,
} from '../lib/snapshotAutoRebuild.js'
import {
  compactDuplicateTagCandidates,
  upsertPendingTagCandidate,
} from '../lib/tagCandidates.js'
import {
  polishOverviewConclusionsWithLLM,
  polishPlanningRecommendationsWithLLM,
} from '../lib/overviewConclusionsLLM.js'
import { loadPlanningConfig } from '../lib/planningConfigLoader.js'
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
import { syncCatalogProductsToTaxonomy } from '../lib/productCenterSync.js'
import { downloadManagedTaxonomyExcel } from '../lib/tagLibrary/taxonomyManageModel.js'
import { listOrderVolumes, upsertOrderVolume } from '../storage/orderVolumeStore.js'
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

/**
 * @param {import('../lib/types.js').FeedbackRecord} record
 */
function duplicateKey(record) {
  const dataSourceType = record.dataSourceType || 'complaint_ticket'
  return buildDedupeKey({
    dataSourceType,
    importMonth:
      record.importMonth || record.createdAt?.slice(0, 7) || 'unknown',
    ticketId: record.ticketId,
    id: record.id,
  })
}

function attachJourneyRules(settings) {
  return {
    ...settings,
    themeRules: getThemeRulesForProduct(undefined, 'generic'),
  }
}

/**
 * @param {import('../lib/types.js').FeedbackRecord[]} prev
 * @param {import('../lib/types.js').FeedbackRecord[]} incoming
 */
function mergeFeedbacksInto(prev, incoming) {
  const seen = new Set(prev.map((fb) => duplicateKey(fb)).filter(Boolean))
  /** @type {import('../lib/types.js').FeedbackRecord[]} */
  const added = []
  let skippedDuplicates = 0
  for (const record of incoming) {
    const withMeta = {
      ...record,
      dataSourceType: record.dataSourceType || 'complaint_ticket',
    }
    const key = duplicateKey(withMeta)
    if (key && seen.has(key)) {
      skippedDuplicates += 1
      continue
    }
    if (key) seen.add(key)
    added.push(withMeta)
  }
  return {
    merged: [...prev, ...added],
    added,
    skippedDuplicates,
  }
}

export function InsightsProvider({ children }) {
  const message = useAppMessage()
  const adapter = useMemo(() => getStorageAdapter(), [])
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
  /** @type {import('react').MutableRefObject<import('../lib/types.js').FeedbackRecord[]>} */
  const feedbacksRef = useRef(/** @type {import('../lib/types.js').FeedbackRecord[]} */ ([]))

  /** 工单列表：内存缓存；生产环境 SSOT 为 SQLite records（见 docs/DATA-PERSISTENCE.md） */
  const [feedbacks, setFeedbacks] = useState(/** @type {import('../lib/types.js').FeedbackRecord[]} */ ([]))
  const [totalRecordCount, setTotalRecordCount] = useState(0)
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
  /** @type {[{ active: boolean; progress: string; dataMonth?: string; batchName?: string }, import('react').Dispatch<import('react').SetStateAction<{ active: boolean; progress: string; dataMonth?: string; batchName?: string }>>]} */
  const [importSession, setImportSession] = useState(() => ({
    active: false,
    progress: '',
    dataMonth: undefined,
    batchName: undefined,
  }))
  /** @type {[{ active: boolean; progress: string; total: number; scope?: import('../lib/retagSession.js').BulkRetagScope | 'all' }, import('react').Dispatch<import('react').SetStateAction<{ active: boolean; progress: string; total: number; scope?: import('../lib/retagSession.js').BulkRetagScope | 'all' }>>]} */
  const [retagSession, setRetagSession] = useState(() => ({
    active: false,
    progress: '',
    total: 0,
    scope: /** @type {import('../lib/retagSession.js').BulkRetagScope | 'all'} */ ('all'),
  }))
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
      const records = await loadFeedbacksForPeriod(adapter, periodId)
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
      await adapter.init()

      const teamSettings = await loadTeamAppSettings(adapter)
      if (Object.keys(teamSettings).length) {
        const local = loadSettings()
        const merged = attachJourneyRules(mergeTeamAndLocalSettings(teamSettings, local))
        saveSettings(merged)
        setSettingsState(merged)
      }

      setFeedbacksLoading(true)
      loadedPeriodIdsRef.current = new Set()
      /** @type {import('../lib/types.js').FeedbackRecord[]} */
      let loadedRecords = []
      let loadedTotal = 0
      try {
        const page = await fetchAllRecordPages(adapter)
        loadedRecords = page.records
        loadedTotal = page.total
        setFeedbacks(loadedRecords)
        feedbacksRef.current = loadedRecords
        setTotalRecordCount(loadedTotal)
        setFeedbacksHydrated(true)
      } finally {
        setFeedbacksLoading(false)
      }

      let list = (await adapter.listInsightPeriods()).map(normalizeInsightPeriod)

      const savedSelection = await adapter.getMeta(META_PERIOD_SELECTION)
      let spec = defaultMonthPeriodSpec(loadedRecords)
      if (savedSelection?.granularity && savedSelection.year != null) {
        spec = buildPeriodSpec(savedSelection)
      } else {
        const savedId = await adapter.getMeta(META_CURRENT_PERIOD)
        const existing = list.find((p) => p.id === savedId)
        const sel = selectionFromPeriod(existing)
        if (sel) spec = buildPeriodSpec(sel)
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

      try {
        await adapter.putInsightPeriod(period)
      } catch (err) {
        console.warn('[storage] 同步洞察周期到共享库失败（查看者无 import 权限时可忽略）', err)
      }
      try {
        await adapter.putMeta(META_PERIOD_SELECTION, {
          granularity: spec.granularity,
          year: spec.anchorYear,
          month: spec.anchorMonth,
          quarter: spec.anchorQuarter,
        })
        await adapter.putMeta(META_CURRENT_PERIOD, period.id)
        list = (await adapter.listInsightPeriods()).map(normalizeInsightPeriod)
        setPeriods(list)
      } catch (err) {
        console.warn('[storage] 保存周期选择失败', err)
      }

      await hydrateRecommendationFeedbackFromServer(adapter)
      await loadRecordsForPeriodId(period.id)
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
    } finally {
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
        const { records, total } = await fetchAllRecordPages(adapter)
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
      message,
    ],
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
  }, [storageReady, adapter, syncSharedDataFromServer])

  useEffect(() => {
    if (storageReady) {
      reloadSnapshots(currentPeriodId)
      reloadTagCandidates()
      reloadOrderVolumes()
      applyTaxonomyOverridesFromStorage()
    }
  }, [storageReady, currentPeriodId, reloadSnapshots, reloadTagCandidates, reloadOrderVolumes, applyTaxonomyOverridesFromStorage])

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
    async ({ period, recordsForBuild, updateUi = true }) => {
      if (!period || !storageReady) return null
      const mergedFeedbacks = recordsForBuild ?? feedbacksRef.current
      snapshotRebuildInProgressRef.current = true
      setSnapshotRebuilding('all')
      try {
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
        return result
      } finally {
        snapshotRebuildInProgressRef.current = false
        setSnapshotRebuilding(null)
      }
    },
    [adapter, currentPeriodId, settings, storageReady],
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
        })
        setSourceSnapshots((prev) => ({ ...prev, [dataSourceType]: snap }))
        setSnapshotsStale(true)
        emit('SnapshotBuilt', { periodId: currentPeriodId, dataSourceType })
      } finally {
        setSnapshotRebuilding(null)
      }
    },
    [adapter, currentPeriod, feedbacks, currentPeriodId],
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
    await snapshotRebuildChainRef.current
    snapshotRebuildChainRef.current = snapshotRebuildChainRef.current.then(() =>
      executeSnapshotRebuild({ period: currentPeriod, recordsForBuild: feedbacksRef.current }),
    )
    await snapshotRebuildChainRef.current
  }, [currentPeriod, executeSnapshotRebuild])

  const polishOverviewConclusions = useCallback(async () => {
    if (!currentPeriod || !overviewSnapshot?.conclusions) {
      throw new Error('请先生成洞察快照')
    }
    if (overviewSnapshot.conclusions.insufficientData) {
      throw new Error('当前周期样本不足，无法润色结论')
    }
    const polished = await polishOverviewConclusionsWithLLM(
      overviewSnapshot.conclusions,
      settings,
      {
        includeRecommendations: settings.overviewPolishIncludeRecommendations !== false,
      },
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

  /**
   * @param {string} recommendationId
   * @param {import('../domain/overviewConclusions.js').RecommendationUserOverride} patch
   */
  const updateRecommendationUserOverride = useCallback(
    async (recommendationId, patch) => {
      if (!overviewSnapshot?.conclusions?.recommendations?.length) {
        throw new Error('当前周期暂无行动建议')
      }
      const recommendations = overviewSnapshot.conclusions.recommendations.map((rec) => {
        if (rec.id !== recommendationId) return rec
        return {
          ...rec,
          userOverride: {
            ...rec.userOverride,
            ...patch,
            updatedAt: new Date().toISOString(),
          },
        }
      })
      const updated = {
        ...overviewSnapshot,
        conclusions: { ...overviewSnapshot.conclusions, recommendations },
        generatedAt: new Date().toISOString(),
      }
      await adapter.putSnapshot(updated)
      setOverviewSnapshot(updated)
      return updated
    },
    [adapter, overviewSnapshot],
  )

  const clearRecommendationUserOverride = useCallback(
    async (recommendationId) => {
      if (!overviewSnapshot?.conclusions?.recommendations?.length) return
      const recommendations = overviewSnapshot.conclusions.recommendations.map((rec) => {
        if (rec.id !== recommendationId) return rec
        const { userOverride: _removed, ...rest } = rec
        return rest
      })
      const updated = {
        ...overviewSnapshot,
        conclusions: { ...overviewSnapshot.conclusions, recommendations },
        generatedAt: new Date().toISOString(),
      }
      await adapter.putSnapshot(updated)
      setOverviewSnapshot(updated)
    },
    [adapter, overviewSnapshot],
  )

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
        merged = await saveManagedTaxonomy(adapter, synced)
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
    /** @param {{ progress?: string; dataMonth?: string; batchName?: string; dataSourceType?: import('../domain/enums.js').DataSourceType }} [meta] */
    (meta = {}) => {
      if (reprocessingRef.current) {
        throw new Error(RETAG_IMPORT_BLOCKED_TIP)
      }
      importLockRef.current = true
      const progress = meta.progress || '正在准备…'
      setImportSession({
        active: true,
        progress,
        dataMonth: meta.dataMonth,
        batchName: meta.batchName,
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

  const setImportSessionProgress = useCallback((progress) => {
    setImportSession((prev) => (prev.active ? { ...prev, progress } : prev))
    updateImportSessionMarkerProgress(progress)
  }, [])

  const endImportSession = useCallback(() => {
    importLockRef.current = false
    clearImportSessionMarker()
    setImportSession({
      active: false,
      progress: '',
      dataMonth: undefined,
      batchName: undefined,
    })
  }, [])

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

  const setRetagSessionProgress = useCallback((progress) => {
    setRetagSession((prev) => (prev.active ? { ...prev, progress } : prev))
    updateRetagSessionMarkerProgress(progress)
  }, [])

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
  }, [])

  /**
   * @param {{
   *   total: number
   *   beforeUnknown: number
   *   afterUnknown: number
   *   summary: ReturnType<typeof summarizeUnknownJourneyRecords>
   * }} result
   */
  const notifyRetagFinished = useCallback(
    (result) => {
      endRetagSession()
      emit('RetagFinished', result)
      notification.success({
        message: '批量重新打标完成',
        description: formatBulkRetagResultMessage(result),
        placement: 'topRight',
        duration: 10,
        style: { whiteSpace: 'pre-wrap' },
      })
    },
    [endRetagSession],
  )

  const addFeedbacks = useCallback(
    /**
     * @param {import('../lib/types.js').FeedbackRecord[]} records
     * @param {{ onUploadProgress?: (uploaded: number, total: number) => void }} [options]
     */
    async (records, options = {}) => {
      const { merged, added, skippedDuplicates } = mergeFeedbacksInto(
        feedbacksRef.current,
        records,
      )
      feedbacksRef.current = merged
      setFeedbacks(merged)

      if (added.length) {
        emit('ImportCompleted', {
          count: added.length,
          periodId: currentPeriodId,
          skipStaleMark: true,
        })
      }

      if (added.length && storageReady) {
        setTotalRecordCount((n) => n + added.length)
        if (currentPeriodId) {
          loadedPeriodIdsRef.current.add(currentPeriodId)
        }
        skipPersistRef.current = true
        try {
          const onProgress = options.onUploadProgress
          await adapter.putRecords(added, {
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
        } finally {
          skipPersistRef.current = false
        }
      }

      return {
        added: added.length,
        skippedDuplicates,
        totalAfter: merged.length,
        analyzed: records.length,
      }
    },
    [adapter, currentPeriodId, storageReady],
  )

  const updateFeedback = useCallback(
    async (id, patch) => {
      const existing = feedbacksRef.current.find((fb) => fb.id === id)
      if (!existing) {
        throw new Error('工单不存在或已删除')
      }
      const manualTagFields = mergeManualTagFieldsOnUserEdit(existing, patch)
      const updated = { ...existing, ...patch, manualTagFields }
      setFeedbacks((prev) => prev.map((fb) => (fb.id === id ? updated : fb)))
      if (storageReady) {
        await persistRecordUpdate(adapter, updated)
      }
      return updated
    },
    [adapter, storageReady],
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
        ? periods.find((p) => p.id === options.insightPeriodId) ?? null
        : null

      clearInProgressRef.current = true
      try {
        if (storageReady) {
          await clearAllFeedbacks(adapter, options)
        }
        if (clearAllData) {
          feedbacksRef.current = []
          setFeedbacks([])
          setTotalRecordCount(0)
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
              await clearAllFeedbacks(adapter, options)
              feedbacksRef.current = []
              setFeedbacks([])
              setTotalRecordCount(0)
            }
          } else {
            setTotalRecordCount(await getTotalRecordCount(adapter))
          }
          await reloadSnapshots(currentPeriodId)
          await reloadTagCandidates()
        }
      } finally {
        clearInProgressRef.current = false
      }
    },
    [adapter, storageReady, currentPeriodId, periods, reloadSnapshots, reloadTagCandidates],
  )

  const clearAll = useCallback(async () => clearImportedData({ all: true }), [clearImportedData])

  const reprocessOne = useCallback(
    async (id) => {
      if (reprocessingRef.current) return
      const fb = feedbacks.find((f) => f.id === id)
      if (!fb) return
      const llmSettings = attachJourneyRules({
        ...loadSettings(),
        ...settings,
        ...(await resolveSettingsForLlm(settings)),
      })
      const retagged = reprocessFeedbackRecord(fb, llmSettings)
      const [updated] = await reprocessAllThemesAndSentiment([retagged], llmSettings)
      const merged = { ...updated, id: fb.id }
      setFeedbacks((prev) =>
        prev.map((f) => (f.id === id ? merged : f)),
      )
      if (storageReady) {
        await persistRecordUpdate(adapter, merged)
      }
    },
    [adapter, feedbacks, settings, storageReady],
  )

  const reprocessAllCustomerQuotes = useCallback(
    async (reportProgress) => {
      if (!feedbacks.length) return 0
      const progress = (text) => reportProgress?.(text)
      setReprocessing(true)
      reprocessingRef.current = true
      try {
        progress(`正在重算客户原话（共 ${feedbacks.length} 条）…`)
        const updated = feedbacks.map((fb) => reprocessCustomerQuoteForRecord(fb, settings))
        feedbacksRef.current = updated
        setFeedbacks(updated)
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
    [adapter, feedbacks, settings, currentPeriod, scheduleSnapshotRebuild, storageReady],
  )

  const reprocessAllTagsCore = useCallback(
    async (targetRecords, reportProgress, options = {}) => {
      const list = targetRecords?.length ? targetRecords : feedbacksRef.current
      if (!list.length) return null

      const scope = options.scope || 'period_all'
      const total = list.length
      const beforeUnknown = listUnknownJourneyRecords(list).length
      const progress = (text) => reportProgress?.(text)
      const ticketLlmOnly = scope === 'needs_ticket_llm'

      progress('正在加载配置…')
      await reloadAllConfigs()
      const llmSettings = attachJourneyRules({
        ...loadSettings(),
        ...settings,
        ...(await resolveSettingsForLlm(settings)),
      })

      /** @param {import('../lib/types.js').FeedbackRecord[]} chunk */
      const mergePersistedChunk = (chunk) => {
        const byId = new Map(chunk.map((record) => [record.id, record]))
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
      if (ticketLlmOnly) {
        retagged = [...list]
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
          onTicketLlmBatchPersist: persistChunkIncremental,
        },
      )

      const byId = new Map(updatedSubset.map((record) => [record.id, record]))
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
      return {
        total: updatedSubset.length,
        beforeUnknown,
        afterUnknown,
        scope,
        summary: summarizeUnknownJourneyRecords(updatedSubset),
      }
    },
    [
      adapter,
      settings,
      reloadAllConfigs,
      currentPeriod,
      scheduleSnapshotRebuild,
      storageReady,
    ],
  )

  const startBulkRetag = useCallback(
    async (options = {}) => {
      const { scope = 'period_all', records, forceOverrideManualTags = false } = options
      const list = records?.length ? records : feedbacksRef.current
      if (!list.length) return null
      if (importLockRef.current) {
        throw new Error(RETAG_BLOCKED_BY_IMPORT_TIP)
      }
      if (reprocessingRef.current) {
        throw new Error(RETAG_IN_PROGRESS_TIP)
      }

      beginRetagSession({ total: list.length, scope })
      try {
        const result = await reprocessAllTagsCore(list, setRetagSessionProgress, {
          scope,
          forceOverrideManualTags,
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
      feedbacksLoading,
      settings,
      setSettings,
      setPersonalSettings,
      setTeamSettings,
      addFeedbacks,
      setImportLock,
      importSession,
      beginImportSession,
      setImportSessionProgress,
      endImportSession,
      notifyImportFinished,
      retagSession,
      startBulkRetag,
      updateFeedback,
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
      polishOverviewConclusions,
      polishPlanningRecommendations,
      updateRecommendationUserOverride,
      clearRecommendationUserOverride,
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
    }),
    [
      feedbacks,
      totalRecordCount,
      feedbacksLoading,
      settings,
      setSettings,
      setPersonalSettings,
      setTeamSettings,
      addFeedbacks,
      setImportLock,
      importSession,
      beginImportSession,
      setImportSessionProgress,
      endImportSession,
      notifyImportFinished,
      retagSession,
      startBulkRetag,
      updateFeedback,
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
      polishOverviewConclusions,
      polishPlanningRecommendations,
      updateRecommendationUserOverride,
      clearRecommendationUserOverride,
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
