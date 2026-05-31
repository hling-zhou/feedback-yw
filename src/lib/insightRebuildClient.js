import { apiFetch } from './apiClient.js'

/** @typedef {import('../domain/insightRebuildJob.js').InsightRebuildJob} InsightRebuildJob */

/**
 * @param {string} insightPeriodId
 * @returns {Promise<{ job: InsightRebuildJob; started: boolean }>}
 */
export async function startInsightRebuild(insightPeriodId) {
  return apiFetch('/api/storage/insight-rebuild', {
    method: 'POST',
    body: JSON.stringify({ insightPeriodId }),
  })
}

/**
 * @param {string} jobId
 * @returns {Promise<InsightRebuildJob>}
 */
export async function fetchInsightRebuildJob(jobId) {
  const data = await apiFetch(`/api/storage/insight-rebuild/${encodeURIComponent(jobId)}`)
  return data.job
}

/**
 * @param {string} insightPeriodId
 * @param {number} [limit]
 */
export async function listInsightRebuildJobs(insightPeriodId, limit = 5) {
  const params = new URLSearchParams({ insightPeriodId, limit: String(limit) })
  const data = await apiFetch(`/api/storage/insight-rebuild?${params}`)
  return data.jobs || []
}

/**
 * @param {string} jobId
 * @param {{ onProgress?: (job: InsightRebuildJob) => void; pollMs?: number; timeoutMs?: number }} [options]
 * @returns {Promise<InsightRebuildJob>}
 */
export async function waitForInsightRebuild(jobId, options = {}) {
  const { onProgress, pollMs = 800, timeoutMs = 600_000 } = options
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const job = await fetchInsightRebuildJob(jobId)
    onProgress?.(job)
    if (job.status === 'succeeded') return job
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(job.errorSummary || '洞察重建失败')
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new Error('洞察重建超时，请稍后刷新页面查看结果')
}

/**
 * @param {InsightRebuildJob | null | undefined} job
 */
export function formatInsightRebuildProgress(job) {
  if (!job) return null
  if (job.status === 'queued') return '排队中…'
  if (job.status === 'running') {
    const p = job.progress
    if (p?.stage) return `${p.stage} (${p.done}/${p.total})`
    return '重建中…'
  }
  if (job.status === 'succeeded') return null
  return job.errorSummary || job.status
}
