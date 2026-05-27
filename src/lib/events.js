/**
 * 轻量领域事件总线（NFR-E-020）
 * @typedef {'ImportCompleted' | 'ImportFinished' | 'AnalysisRunFinished' | 'TagLibraryPublished' | 'TagCandidateDiscovered' | 'SnapshotBuilt' | 'PdfExportFinished'} DomainEventName
 */

/** @typedef {{ type: DomainEventName; payload?: unknown; at: string }} DomainEvent */

/** @type {Map<DomainEventName, Set<(event: DomainEvent) => void>>} */
const listeners = new Map()

/**
 * @param {DomainEventName} type
 * @param {(event: DomainEvent) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribe(type, handler) {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type).add(handler)
  return () => listeners.get(type)?.delete(handler)
}

/**
 * @param {DomainEventName} type
 * @param {unknown} [payload]
 */
export function emit(type, payload) {
  const event = { type, payload, at: new Date().toISOString() }
  const set = listeners.get(type)
  if (!set) return
  for (const handler of set) {
    try {
      handler(event)
    } catch (err) {
      console.error(`[EventBus] ${type} handler error:`, err)
    }
  }
}

/** 测试用：清空订阅 */
export function resetEventBus() {
  listeners.clear()
}
