import { META_KEY_APP_SETTINGS_SHARED } from '../src/lib/appSettingsPersist.js'
import { getDefaultAppSettings } from '../src/lib/storage.js'
import {
  createInsightRebuildJob,
  isActiveInsightRebuildStatus,
} from '../src/domain/insightRebuildJob.js'
import {
  markPeriodSnapshotsRebuilding,
  markPeriodSnapshotsStale,
  rebuildAllSnapshots,
} from '../src/snapshots/snapshotService.js'
import { createRepositoryStorageAdapter } from './repositoryStorageAdapter.js'
import { storageRepository } from './storageRepository.js'
import { isLlmConfigured } from './llmConfig.js'
import { resolveWorkbenchHistoryMonthRange } from '../src/lib/workbenchStoredAggregates.js'
import { loadManagedProductCatalog } from '../src/storage/productCatalogStore.js'
import { getDb } from './db.js'
import { bumpSnapshotsRevision } from './dataRevision.js'
import { listBackgroundTasks } from './backgroundTaskLock.js'
import {
  clearDirtyInsightPeriodIfUnchanged,
  dirtyInsightGeneration,
  markInsightSnapshotPeriodDirty,
  notifyInsightSnapshotDirty,
} from './insightSnapshotDirty.js'

/** @typedef {import('../src/domain/insightRebuildJob.js').InsightRebuildJob} InsightRebuildJob */

/** @type {Map<string, Promise<void>>} */
const periodChains = new Map()

let recovered = false

function ensureRecovered() {
  if (recovered) return
  const orphaned = getDb().prepare(`
    SELECT DISTINCT insight_period_id AS periodId FROM insight_rebuild_jobs
    WHERE status IN ('queued', 'running')
  `).all()
  storageRepository.recoverOrphanedInsightRebuildJobs()
  for (const row of orphaned) markInsightSnapshotPeriodDirty(row.periodId)
  recovered = true
}

/**
 * @returns {import('../src/lib/storage.js').AppSettings}
 */
function loadRebuildSettings() {
  const raw = storageRepository.getMeta(META_KEY_APP_SETTINGS_SHARED)
  const team =
    raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  return {
    ...getDefaultAppSettings(),
    ...team,
    llmApiKey: undefined,
    llmServerConfigured: isLlmConfigured(),
  }
}

/**
 * @param {InsightRebuildJob} job
 */
function persistJob(job) {
  storageRepository.putInsightRebuildJob(job)
}

/**
 * @param {InsightRebuildJob} job
 * @param {Partial<InsightRebuildJob>} patch
 * @returns {InsightRebuildJob}
 */
function updateJob(job, patch) {
  const next = { ...job, ...patch }
  persistJob(next)
  return next
}

/**
 * @param {string} insightPeriodId
 * @param {string} [triggeredBy]
 * @returns {Promise<{ job: InsightRebuildJob; started: boolean }>}
 */
export async function enqueueInsightRebuild(insightPeriodId, triggeredBy) {
  ensureRecovered()
  const periodId = insightPeriodId?.trim()
  if (!periodId) {
    throw new Error('缺少 insightPeriodId')
  }
  if (listBackgroundTasks().some((task) => ['import', 'retag', 'post_use_journey'].includes(task.type))) {
    const error = new Error('打标或导入任务正在写入，请任务结束后重建洞察')
    error.code = 'INSIGHT_REBUILD_BUSY'
    throw error
  }

  const existing = storageRepository.findActiveInsightRebuildJob(periodId)
  if (existing) {
    return { job: existing, started: false }
  }

  const job = createInsightRebuildJob({ insightPeriodId: periodId, triggeredBy })
  persistJob(job)
  scheduleInsightRebuildRun(job.id)
  return { job, started: true }
}

/**
 * @param {string} jobId
 */
function scheduleInsightRebuildRun(jobId) {
  const job = storageRepository.getInsightRebuildJob(jobId)
  if (!job || !isActiveInsightRebuildStatus(job.status)) return

  const chain = periodChains.get(job.insightPeriodId) || Promise.resolve()
  const next = chain
    .catch(() => {})
    .then(() => runInsightRebuildJob(jobId))
  periodChains.set(job.insightPeriodId, next)
}

/**
 * @param {string} jobId
 */
async function runInsightRebuildJob(jobId) {
  let job = storageRepository.getInsightRebuildJob(jobId)
  if (!job || job.status !== 'queued') return

  const startedAt = new Date().toISOString()
  job = updateJob(job, {
    status: 'running',
    startedAt,
    progress: { ...job.progress, stage: 'preparing' },
  })

  const adapter = createRepositoryStorageAdapter()
  const period = storageRepository.getInsightPeriod(job.insightPeriodId)
  if (!period) {
    updateJob(job, {
      status: 'failed',
      errorSummary: `周期不存在：${job.insightPeriodId}`,
      finishedAt: new Date().toISOString(),
    })
    return
  }

  const dirtyGeneration = dirtyInsightGeneration(job.insightPeriodId)
  try {
    await markPeriodSnapshotsRebuilding(adapter, job.insightPeriodId)
    try {
      await loadManagedProductCatalog(adapter)
    } catch (err) {
      console.warn('[insight-rebuild] 产品目录刷新失败，用缓存:', err)
    }

    const range = resolveWorkbenchHistoryMonthRange(period)
    const { records } = range.startMonth && range.endMonth
      ? storageRepository.listRecords({
          importMonthFrom: range.startMonth,
          importMonthTo: range.endMonth,
          fields: 'list',
        })
      : storageRepository.listRecords({
          insightPeriodId: job.insightPeriodId,
        })
    const settings = loadRebuildSettings()

    await rebuildAllSnapshots(
      adapter,
      period,
      records,
      (source, done, total, detail) => {
        const current = storageRepository.getInsightRebuildJob(jobId)
        if (!current || current.status !== 'running') return
        updateJob(current, {
          progress: {
            done,
            total,
            stage: String(source),
            engineRounds: detail?.engineRounds,
            enginePassed: detail?.enginePassed,
            engineEscalated: detail?.engineEscalated,
          },
        })
      },
      settings,
    )

    const currentGeneration = dirtyInsightGeneration(job.insightPeriodId)
    if (currentGeneration === dirtyGeneration) {
      clearDirtyInsightPeriodIfUnchanged(job.insightPeriodId, dirtyGeneration)
    } else {
      // 重建期间有新写入，本轮结果不能冒充最新数据。
      await markPeriodSnapshotsStale(adapter, job.insightPeriodId)
    }

    const finishedAt = new Date().toISOString()
    const durationMs = job.startedAt
      ? Math.max(0, Date.parse(finishedAt) - Date.parse(job.startedAt))
      : undefined
    updateJob(storageRepository.getInsightRebuildJob(jobId) || job, {
      status: 'succeeded',
      finishedAt,
      durationMs,
      progress: { done: 6, total: 6, stage: 'overview' },
      errorSummary: undefined,
    })
    bumpSnapshotsRevision()
    notifyInsightSnapshotDirty()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[insight-rebuild] failed:', jobId, err)
    updateJob(storageRepository.getInsightRebuildJob(jobId) || job, {
      status: 'failed',
      errorSummary: message.slice(0, 500),
      finishedAt: new Date().toISOString(),
      progress: {
        ...(storageRepository.getInsightRebuildJob(jobId)?.progress || job.progress),
        stage: null,
      },
    })
    try {
      if (!dirtyInsightGeneration(job.insightPeriodId)) markInsightSnapshotPeriodDirty(job.insightPeriodId)
      await markPeriodSnapshotsStale(adapter, job.insightPeriodId)
      bumpSnapshotsRevision()
    } catch (cleanupError) {
      console.error('[insight-rebuild] failed to mark snapshots stale:', cleanupError)
    }
  }
}

export async function waitForInsightRebuildCompletion(jobId) {
  const job = getInsightRebuildJob(jobId)
  if (job) await periodChains.get(job.insightPeriodId)?.catch(() => {})
  return getInsightRebuildJob(jobId)
}

/**
 * @param {string} id
 * @returns {InsightRebuildJob | null}
 */
export function getInsightRebuildJob(id) {
  ensureRecovered()
  return storageRepository.getInsightRebuildJob(id)
}

/**
 * @param {string} insightPeriodId
 * @param {number} [limit]
 */
export function listInsightRebuildJobs(insightPeriodId, limit = 10) {
  ensureRecovered()
  return storageRepository.listInsightRebuildJobs(insightPeriodId, limit)
}
