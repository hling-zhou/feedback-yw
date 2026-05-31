import { META_KEY_APP_SETTINGS_SHARED } from '../src/lib/appSettingsPersist.js'
import { getDefaultAppSettings } from '../src/lib/storage.js'
import {
  createInsightRebuildJob,
  isActiveInsightRebuildStatus,
} from '../src/domain/insightRebuildJob.js'
import {
  markPeriodSnapshotsRebuilding,
  rebuildAllSnapshots,
} from '../src/snapshots/snapshotService.js'
import { createRepositoryStorageAdapter } from './repositoryStorageAdapter.js'
import { storageRepository } from './storageRepository.js'
import { isLlmConfigured } from './llmConfig.js'

/** @typedef {import('../src/domain/insightRebuildJob.js').InsightRebuildJob} InsightRebuildJob */

/** @type {Map<string, Promise<void>>} */
const periodChains = new Map()

let recovered = false

function ensureRecovered() {
  if (recovered) return
  storageRepository.recoverOrphanedInsightRebuildJobs()
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

  try {
    await markPeriodSnapshotsRebuilding(adapter, job.insightPeriodId)

    const { records } = storageRepository.listRecords({
      insightPeriodId: job.insightPeriodId,
    })
    const settings = loadRebuildSettings()

    await rebuildAllSnapshots(
      adapter,
      period,
      records,
      (source, done, total) => {
        const current = storageRepository.getInsightRebuildJob(jobId)
        if (!current || current.status !== 'running') return
        updateJob(current, {
          progress: {
            done,
            total,
            stage: String(source),
          },
        })
      },
      settings,
    )

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
  }
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
