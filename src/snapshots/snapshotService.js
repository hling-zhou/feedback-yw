import { DATA_SOURCE_TYPES } from '../domain/enums.js'
import { overviewSnapshotId, sourceSnapshotId } from '../domain/snapshot.js'
import { buildSourceSnapshot } from './buildSourceSnapshot.js'
import { buildOverviewSnapshot } from './buildOverviewSnapshot.js'
import { previousPeriodIdFromPeriod } from '../domain/insightPeriod.js'
import { preserveRecommendationUserOverrides } from '../lib/planningRecommendationDisplay.js'
import { filterRecordsForScope } from './recordScope.js'
import { listOrderVolumes } from '../storage/orderVolumeStore.js'
import { polishOverviewConclusionsWithLLM } from '../lib/overviewConclusionsLLM.js'
import { yieldToMainThread } from '../lib/yieldToMainThread.js'

/** @typedef {import('../lib/storage.js').AppSettings} AppSettings */

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */
/** @typedef {import('../domain/snapshot.js').InsightSnapshot} InsightSnapshot */
/** @typedef {import('../domain/snapshot.js').OverviewSnapshot} OverviewSnapshot */
/** @typedef {import('../storage/adapter.js').StorageAdapter} StorageAdapter */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */

/**
 * @param {InsightSnapshot | OverviewSnapshot} snap
 * @param {boolean} forceStale
 */
export function overlayStaleStatus(snap, forceStale) {
  if (!snap || !forceStale || snap.status === 'rebuilding' || snap.status === 'failed') {
    return snap
  }
  return { ...snap, status: 'stale' }
}

/**
 * @param {OverviewSnapshot | InsightSnapshot | null} snap
 */
export function isOverviewSnapshot(snap) {
  return Boolean(snap && snap.id?.startsWith('overview:'))
}

/**
 * @param {StorageAdapter} adapter
 * @param {string} insightPeriodId
 */
export async function loadSnapshotsForPeriod(adapter, insightPeriodId) {
  const all = await adapter.listSnapshotsByPeriod(insightPeriodId)
  /** @type {Partial<Record<DataSourceType, InsightSnapshot>>} */
  const sourceSnapshots = {}
  /** @type {OverviewSnapshot | null} */
  let overviewSnapshot = null

  for (const snap of all) {
    if (isOverviewSnapshot(snap)) {
      overviewSnapshot = /** @type {OverviewSnapshot} */ (snap)
    } else if (/** @type {InsightSnapshot} */ (snap).dataSourceType) {
      sourceSnapshots[/** @type {InsightSnapshot} */ (snap).dataSourceType] =
        /** @type {InsightSnapshot} */ (snap)
    }
  }

  return { sourceSnapshots, overviewSnapshot }
}

/**
 * @param {Object} params
 * @param {StorageAdapter} params.adapter
 * @param {InsightPeriod} params.period
 * @param {DataSourceType} params.dataSourceType
 * @param {FeedbackRecord[]} params.feedbacks
 */
export async function rebuildSourceSnapshot({
  adapter,
  period,
  dataSourceType,
  feedbacks,
}) {
  const insightPeriodId = period.id
  const records = filterRecordsForScope(feedbacks, period, dataSourceType)
  const snapshot = buildSourceSnapshot({
    insightPeriodId,
    dataSourceType,
    records,
    status: 'ready',
  })
  await adapter.putSnapshot(snapshot)
  return snapshot
}

/**
 * @param {Object} params
 * @param {StorageAdapter} params.adapter
 * @param {InsightPeriod} params.period
 * @param {FeedbackRecord[]} params.feedbacks
 * @param {Partial<Record<DataSourceType, InsightSnapshot>>} params.sourceSnapshots
 */
export async function rebuildOverviewSnapshot({
  adapter,
  period,
  feedbacks,
  sourceSnapshots,
  settings = null,
}) {
  const orderVolumes = await listOrderVolumes(adapter)
  const previousPeriodId = previousPeriodIdFromPeriod(period)
  const existingOverview = await adapter.getSnapshot(overviewSnapshotId(period.id))
  let previousRecommendations = []
  if (previousPeriodId) {
    const prevOverview = await adapter.getSnapshot(overviewSnapshotId(previousPeriodId))
    previousRecommendations = prevOverview?.conclusions?.recommendations || []
  }

  let snapshot = buildOverviewSnapshot({
    insightPeriodId: period.id,
    period,
    feedbacks,
    sourceSnapshots,
    orderVolumes,
    status: 'ready',
    previousRecommendations,
    previousPeriodId: previousPeriodId || undefined,
    settings,
  })

  if (existingOverview?.conclusions?.recommendations?.length) {
    snapshot = {
      ...snapshot,
      conclusions: {
        ...snapshot.conclusions,
        recommendations: preserveRecommendationUserOverrides(
          snapshot.conclusions?.recommendations || [],
          existingOverview.conclusions.recommendations,
        ),
        recommendationsLlm: existingOverview.conclusions.recommendationsLlm,
      },
    }
  }

  if (
    settings?.overviewConclusionsLlm &&
    snapshot.conclusions &&
    !snapshot.conclusions.insufficientData
  ) {
    try {
      snapshot = {
        ...snapshot,
        conclusions: await polishOverviewConclusionsWithLLM(snapshot.conclusions, settings, {
          includeRecommendations: settings.overviewPolishIncludeRecommendations !== false,
        }),
      }
    } catch (err) {
      console.warn('概述结论 LLM 润色失败，已保留规则结论:', err)
    }
  }

  await adapter.putSnapshot(snapshot)
  return snapshot
}

/**
 * 将周期内快照标记为 rebuilding（服务端 Job 开始前）
 * @param {import('../storage/adapter.js').StorageAdapter} adapter
 * @param {string} insightPeriodId
 */
export async function markPeriodSnapshotsRebuilding(adapter, insightPeriodId) {
  const { sourceSnapshots, overviewSnapshot } = await loadSnapshotsForPeriod(
    adapter,
    insightPeriodId,
  )
  for (const type of DATA_SOURCE_TYPES) {
    const snap = sourceSnapshots[type]
    if (snap) {
      await adapter.putSnapshot({ ...snap, status: 'rebuilding' })
    } else {
      await adapter.putSnapshot({
        ...buildSourceSnapshot({
          insightPeriodId,
          dataSourceType: type,
          records: [],
          status: 'stale',
        }),
        status: 'rebuilding',
      })
    }
  }
  if (overviewSnapshot) {
    await adapter.putSnapshot({ ...overviewSnapshot, status: 'rebuilding' })
  }
}

/**
 * @param {StorageAdapter} adapter
 * @param {string} insightPeriodId
 */
export async function markPeriodSnapshotsStale(adapter, insightPeriodId) {
  const { sourceSnapshots, overviewSnapshot } = await loadSnapshotsForPeriod(
    adapter,
    insightPeriodId,
  )
  for (const type of DATA_SOURCE_TYPES) {
    const snap = sourceSnapshots[type]
    if (snap && snap.status === 'ready') {
      await adapter.putSnapshot({ ...snap, status: 'stale' })
    } else if (!snap) {
      const empty = buildSourceSnapshot({
        insightPeriodId,
        dataSourceType: type,
        records: [],
        status: 'stale',
      })
      await adapter.putSnapshot(empty)
    }
  }
  if (overviewSnapshot) {
    await adapter.putSnapshot({ ...overviewSnapshot, status: 'stale' })
  }
}

/**
 * @param {StorageAdapter} adapter
 * @param {InsightPeriod} period
 * @param {FeedbackRecord[]} feedbacks
 * @param {(source: DataSourceType | 'overview', done: number, total: number) => void} [onProgress]
 * @param {AppSettings | null} [settings]
 */
export async function rebuildAllSnapshots(adapter, period, feedbacks, onProgress, settings = null) {
  const insightPeriodId = period.id
  const total = DATA_SOURCE_TYPES.length + 1
  let done = 0
  /** @type {Partial<Record<DataSourceType, InsightSnapshot>>} */
  const sourceSnapshots = {}

  for (const type of DATA_SOURCE_TYPES) {
    onProgress?.(type, done, total)
    await yieldToMainThread()
    const snap = await rebuildSourceSnapshot({
      adapter,
      period,
      dataSourceType: type,
      feedbacks,
    })
    sourceSnapshots[type] = snap
    done += 1
    onProgress?.(type, done, total)
    await yieldToMainThread()
  }

  onProgress?.('overview', done, total)
  await yieldToMainThread()
  const overview = await rebuildOverviewSnapshot({
    adapter,
    period,
    feedbacks,
    sourceSnapshots,
    settings,
  })
  done += 1
  onProgress?.('overview', done, total)

  return { sourceSnapshots, overviewSnapshot: overview }
}
