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

/**
 * @param {string | null | undefined} progress
 */
export function formatInsightRebuildButtonLabel(progress) {
  if (!progress) return '生成 / 刷新洞察'
  return progress
}

/**
 * 重建进行中的非阻断提示。页面继续展示当前快照，完成后由调用方换成新快照。
 * @param {string | null | undefined} progress
 * @param {{ serverJob?: boolean }} [options]
 */
export function formatInsightRebuildSpinDescription(progress, options = {}) {
  const { serverJob = false } = options
  const detail = progress || '准备中…'
  const where = serverJob ? '服务端正在生成洞察快照' : '正在生成洞察快照'
  return `${where}：${detail}。本页仍显示当前快照，完成后自动换成新的。`
}

/**
 * @param {{ serverJob?: boolean; job?: InsightRebuildJob | null }} [result]
 */
export function formatInsightRebuildSuccessMessage(result = {}) {
  const { serverJob, job } = result
  if (serverJob) {
    if (job?.durationMs != null && job.durationMs >= 0) {
      const sec = (job.durationMs / 1000).toFixed(1)
      return `洞察快照已在服务端生成完成（耗时 ${sec} 秒）`
    }
    return '洞察快照已在服务端生成完成'
  }
  return '洞察快照已生成完成'
}
