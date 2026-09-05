import { loadCorrectionRules } from './tagCorrectionRules.js'
import { loadPlaybookOverrides } from './playbookOverrides.js'
import { setPlaybookOverlayCache } from '../planningConfigLoader.js'
import { META_KEY_TAG_CORRECTION_REPLAY } from './constants.js'
import { replayManualTagCorrections } from './tagCorrectionReplay.js'
import { appendCorrectionEvents } from './tagCorrectionStore.js'

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function hydrateLearningCaches(adapter) {
  if (!adapter?.getMeta) return { rules: [], overlay: null }
  const [rules, overlay] = await Promise.all([
    loadCorrectionRules(adapter),
    loadPlaybookOverrides(adapter),
  ])
  setPlaybookOverlayCache(overlay)
  return { rules, overlay }
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export async function replayCorrectionsIfNeeded(adapter, records) {
  if (!adapter?.getMeta || !records?.length) return { replayed: false, count: 0 }
  const flag = await adapter.getMeta(META_KEY_TAG_CORRECTION_REPLAY)
  if (flag?.completed) return { replayed: false, count: 0 }
  const events = replayManualTagCorrections(records)
  if (events.length) await appendCorrectionEvents(adapter, events)
  await adapter.putMeta(META_KEY_TAG_CORRECTION_REPLAY, {
    completed: true,
    at: new Date().toISOString(),
    count: events.length,
  })
  return { replayed: true, count: events.length }
}

/**
 * 复核页手动补采（不看 replay flag）
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export async function replayCorrectionsNow(adapter, records) {
  const events = replayManualTagCorrections(records)
  if (events.length) await appendCorrectionEvents(adapter, events)
  return events.length
}
