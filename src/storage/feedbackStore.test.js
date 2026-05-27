import { describe, it, expect, beforeEach } from 'vitest'
import { createLocalIdbAdapter } from './localIdbAdapter.js'
import { resetDatabaseForTests } from './idb.js'
import {
  clearAllFeedbacks,
  loadFeedbacksFromAdapter,
  migrateLegacyFeedbacksIfNeeded,
  persistFeedbacks,
} from './feedbackStore.js'
import { loadFeedbacks, saveFeedbacks, clearFeedbacks } from '../lib/storage.js'

function mockLocalStorage() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  }
}

describe('feedbackStore SSOT', () => {
  beforeEach(async () => {
    mockLocalStorage()
    await resetDatabaseForTests()
    clearFeedbacks()
  })

  it('migrates localStorage to IndexedDB once', async () => {
    saveFeedbacks([
      {
        id: 'ls-1',
        rawText: 'test',
        customerQuote: 'q',
        createdAt: '2025-05-01',
        problemType: '未分类',
        journeyL1: '未识别环节',
        journeyL2: '未识别子环节',
      },
    ])

    const adapter = createLocalIdbAdapter()
    const first = await migrateLegacyFeedbacksIfNeeded(adapter)
    expect(first.migrated).toBe(1)
    expect(first.source).toBe('localStorage')
    expect(loadFeedbacks()).toEqual([])

    const loaded = await loadFeedbacksFromAdapter(adapter)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('ls-1')
    expect(loaded[0].schemaVersion).toBeDefined()

    saveFeedbacks([
      {
        id: 'ls-2',
        rawText: 'x',
        customerQuote: 'y',
        problemType: '未分类',
        journeyL1: '未识别环节',
        journeyL2: '未识别子环节',
      },
    ])
    const second = await migrateLegacyFeedbacksIfNeeded(adapter)
    expect(second.migrated).toBe(0)
    const again = await loadFeedbacksFromAdapter(adapter)
    expect(again).toHaveLength(1)
    expect(again[0].id).toBe('ls-1')
  })

  it('persistFeedbacks replaces full set', async () => {
    const adapter = createLocalIdbAdapter()
    await adapter.init()
    await persistFeedbacks(adapter, [
      {
        id: 'a',
        rawText: '1',
        customerQuote: '1',
        dataSourceType: 'complaint_ticket',
        problemType: '未分类',
        journeyL1: '未识别环节',
        journeyL2: '未识别子环节',
      },
    ])
    await persistFeedbacks(adapter, [
      {
        id: 'b',
        rawText: '2',
        customerQuote: '2',
        dataSourceType: 'complaint_ticket',
        problemType: '未分类',
        journeyL1: '未识别环节',
        journeyL2: '未识别子环节',
      },
    ])
    const list = await loadFeedbacksFromAdapter(adapter)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('b')
  })

  it('clearAllFeedbacks empties idb and pending tag candidates', async () => {
    const adapter = createLocalIdbAdapter()
    await persistFeedbacks(adapter, [
      {
        id: 'a',
        rawText: '1',
        customerQuote: '1',
        dataSourceType: 'complaint_ticket',
        problemType: '未分类',
        journeyL1: '未识别环节',
        journeyL2: '未识别子环节',
      },
    ])
    await adapter.putTagCandidate({
      id: 'tc-pending',
      tagType: 'problem_type',
      label: '新类型',
      status: 'pending',
      origin: 'local_overflow',
      occurrenceCount: 1,
      createdAt: '2025-05-01T00:00:00.000Z',
      updatedAt: '2025-05-01T00:00:00.000Z',
    })
    await adapter.putTagCandidate({
      id: 'tc-approved',
      tagType: 'problem_type',
      label: '已采纳',
      status: 'approved',
      origin: 'local_overflow',
      occurrenceCount: 1,
      createdAt: '2025-05-01T00:00:00.000Z',
      updatedAt: '2025-05-01T00:00:00.000Z',
    })
    await clearAllFeedbacks(adapter)
    const list = await loadFeedbacksFromAdapter(adapter)
    expect(list).toHaveLength(0)
    const candidates = await adapter.listTagCandidates()
    expect(candidates.map((c) => c.id)).toEqual(['tc-approved'])
  })
})
