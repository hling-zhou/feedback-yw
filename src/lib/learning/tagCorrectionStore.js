import { META_KEY_TAG_CORRECTION_EVENTS, TAG_CORRECTION_EVENTS_CAP } from './constants.js'
import { correctionEventDedupeKey, normalizeTagCorrectionEvent } from './tagCorrectionEvent.js'

/**
 * @param {unknown} raw
 * @returns {import('./tagCorrectionEvent.js').TagCorrectionEvent[]}
 */
export function normalizeCorrectionEvents(raw) {
  const list = Array.isArray(raw) ? raw : raw?.events
  if (!Array.isArray(list)) return []
  return list.map(normalizeTagCorrectionEvent).filter(Boolean)
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown> }} adapter
 */
export async function loadCorrectionEvents(adapter) {
  if (!adapter?.getMeta) return []
  return normalizeCorrectionEvents(await adapter.getMeta(META_KEY_TAG_CORRECTION_EVENTS))
}

/**
 * @param {import('./tagCorrectionEvent.js').TagCorrectionEvent[]} existing
 * @param {import('./tagCorrectionEvent.js').TagCorrectionEvent[]} incoming
 */
export function mergeCorrectionEvents(existing, incoming) {
  const map = new Map()
  for (const event of existing || []) {
    map.set(correctionEventDedupeKey(event), event)
  }
  for (const event of incoming || []) {
    const key = correctionEventDedupeKey(event)
    const prev = map.get(key)
    map.set(key, prev ? { ...prev, ...event, id: prev.id } : event)
  }
  return [...map.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, TAG_CORRECTION_EVENTS_CAP)
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('./tagCorrectionEvent.js').TagCorrectionEvent[]} incoming
 */
export async function appendCorrectionEvents(adapter, incoming) {
  if (!adapter?.putMeta || !incoming?.length) return []
  const existing = await loadCorrectionEvents(adapter)
  const merged = mergeCorrectionEvents(existing, incoming)
  await adapter.putMeta(META_KEY_TAG_CORRECTION_EVENTS, {
    version: 1,
    events: merged,
    updatedAt: new Date().toISOString(),
  })
  return merged
}
