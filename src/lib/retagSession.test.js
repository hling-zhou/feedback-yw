import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  clearRetagSessionMarker,
  formatBulkRetagScopeLabel,
  formatInterruptedRetagMessage,
  persistRetagSessionMarker,
  readRetagSessionMarker,
  updateRetagSessionMarkerProgress,
  RETAG_SESSION_STORAGE_KEY,
} from './retagSession.js'
import { formatBulkRetagResultMessage } from './journeyRetagSummary.js'

describe('retagSession', () => {
  beforeEach(() => {
    const store = new Map()
    globalThis.sessionStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    }
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('persists and reads marker with progress updates', () => {
    persistRetagSessionMarker({
      startedAt: new Date().toISOString(),
      total: 120,
      progress: '正在本地打标 (10/120)…',
    })
    updateRetagSessionMarkerProgress('正在增强打标 (50/120)…')
    const marker = readRetagSessionMarker()
    expect(marker?.total).toBe(120)
    expect(marker?.progress).toBe('正在增强打标 (50/120)…')
  })

  it('clears invalid marker', () => {
    sessionStorage.setItem(RETAG_SESSION_STORAGE_KEY, JSON.stringify({ startedAt: 'x' }))
    expect(readRetagSessionMarker()).toBeNull()
  })

  it('formats interrupted and finished messages', () => {
    expect(formatBulkRetagScopeLabel('unknown_journey')).toContain('未识别环节')
    expect(formatBulkRetagScopeLabel('needs_ticket_llm')).toContain('LLM')
    expect(formatBulkRetagScopeLabel('needs_journey_llm')).toContain('旅程')
    expect(
      formatInterruptedRetagMessage({
        startedAt: new Date().toISOString(),
        total: 50,
        scope: 'unknown_journey',
        progress: '正在增强打标 (10/50)…',
      }),
    ).toContain('共 50 条')
    expect(
      formatInterruptedRetagMessage({
        startedAt: new Date().toISOString(),
        total: 50,
        scope: 'unknown_journey',
        progress: '正在增强打标 (10/50)…',
      }),
    ).toContain('未识别环节')
    const finishedMsg = formatBulkRetagResultMessage({
      total: 50,
      beforeUnknown: 10,
      afterUnknown: 4,
      scope: 'filtered',
      summary: { count: 4, reasons: {}, samples: [] },
    })
    expect(finishedMsg).toContain('新识别 6 条')
    expect(finishedMsg).toContain('筛选结果')
  })

  it('clearRetagSessionMarker removes storage', () => {
    persistRetagSessionMarker({
      startedAt: new Date().toISOString(),
      total: 1,
    })
    clearRetagSessionMarker()
    expect(readRetagSessionMarker()).toBeNull()
  })
})
