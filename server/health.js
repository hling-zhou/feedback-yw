import { getDb } from './db.js'
import { getDataRevision } from './dataRevision.js'
import { isLlmConfigured } from './llmConfig.js'
import { storageRepository } from './storageRepository.js'

/**
 * 供 /health 与运维探针使用（无需登录）
 * @returns {{
 *   ok: boolean
 *   dbOk: boolean
 *   recordCount: number
 *   revision: number
 *   revisionUpdatedAt: string | null
 *   snapshots?: number
 *   tagCandidates?: number
 *   llmConfigured?: boolean
 *   dbError?: string
 * }}
 */
export function buildHealthReport() {
  let dbOk = false
  /** @type {string | undefined} */
  let dbError

  try {
    const db = getDb()
    db.prepare('SELECT 1 AS n').get()
    dbOk = true
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err)
  }

  if (!dbOk) {
    return {
      ok: false,
      dbOk: false,
      recordCount: 0,
      revision: 0,
      revisionUpdatedAt: null,
      ...(dbError ? { dbError } : {}),
    }
  }

  const stats = storageRepository.getStats()
  const { revision, updatedAt } = getDataRevision()

  return {
    ok: true,
    dbOk: true,
    recordCount: stats.records ?? 0,
    revision: revision ?? 0,
    revisionUpdatedAt: updatedAt ?? null,
    snapshots: stats.snapshots ?? 0,
    tagCandidates: stats.tagCandidates ?? 0,
    llmConfigured: isLlmConfigured(),
  }
}
