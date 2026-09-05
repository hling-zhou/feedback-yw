import { aggregateEstablishedActionsFromRecords } from '../painPointClustering/clusterEstablishedActionCorpus.js'
import { META_KEY_PLAYBOOK_PROMOTION } from './constants.js'

/**
 * @param {unknown} raw
 */
export function normalizePromotionState(raw) {
  const rejectedKeys = Array.isArray(raw?.rejectedKeys) ? raw.rejectedKeys.map(String) : []
  const approvedKeys = Array.isArray(raw?.approvedKeys) ? raw.approvedKeys.map(String) : []
  return { rejectedKeys, approvedKeys }
}

/**
 * @param {{ product?: string; productKey?: string; journeyL2?: string; problemType?: string; text: string }} row
 */
export function playbookCandidateKey(row) {
  return [row.productKey || row.product || '', row.journeyL2 || '', row.problemType || '', row.text || ''].join('\0')
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {{ rejectedKeys?: string[]; approvedKeys?: string[] }} [state]
 */
export function listPlaybookPromotionCandidates(records, state = {}) {
  const rejected = new Set(state.rejectedKeys || [])
  return aggregateEstablishedActionsFromRecords(records).filter((row) => {
    const key = playbookCandidateKey(row)
    return !rejected.has(key)
  })
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown> }} adapter
 */
export async function loadPlaybookPromotionState(adapter) {
  if (!adapter?.getMeta) return normalizePromotionState(null)
  return normalizePromotionState(await adapter.getMeta(META_KEY_PLAYBOOK_PROMOTION))
}

/**
 * @param {{ putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {{ rejectedKeys?: string[]; approvedKeys?: string[] }} state
 */
export async function savePlaybookPromotionState(adapter, state) {
  const next = normalizePromotionState(state)
  await adapter.putMeta(META_KEY_PLAYBOOK_PROMOTION, {
    ...next,
    updatedAt: new Date().toISOString(),
  })
  return next
}
