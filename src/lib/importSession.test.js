import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  clearImportSessionMarker,
  formatImportFinishedToast,
  formatInterruptedImportMessage,
  IMPORT_SESSION_STORAGE_KEY,
  persistImportSessionMarker,
  readImportSessionMarker,
  shouldConfirmLeaveImportPage,
  updateImportSessionMarkerProgress,
} from './importSession.js'

describe('shouldConfirmLeaveImportPage', () => {
  it('blocks only the first leave from /import while import is active', () => {
    expect(
      shouldConfirmLeaveImportPage({
        importActive: true,
        leaveAcknowledged: false,
        currentPath: '/import',
        nextPath: '/workbench',
      }),
    ).toBe(true)
    expect(
      shouldConfirmLeaveImportPage({
        importActive: true,
        leaveAcknowledged: true,
        currentPath: '/import',
        nextPath: '/workbench',
      }),
    ).toBe(false)
    expect(
      shouldConfirmLeaveImportPage({
        importActive: true,
        leaveAcknowledged: false,
        currentPath: '/workbench',
        nextPath: '/feedbacks',
      }),
    ).toBe(false)
    expect(
      shouldConfirmLeaveImportPage({
        importActive: true,
        leaveAcknowledged: false,
        currentPath: '/feedbacks',
        nextPath: '/settings',
      }),
    ).toBe(false)
  })
})

describe('formatImportFinishedToast', () => {
  it('formats core stats', () => {
    expect(
      formatImportFinishedToast({
        dataMonth: '2025-03',
        added: 120,
        skippedDuplicates: 2,
        failures: 1,
        skippedProducts: 5,
      }),
    ).toBe('2025-03 新增 120 条，去重跳过 2 条，分析失败 1 行，范围外跳过 5 行')
  })
})

describe('import session persistence', () => {
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

  it('persists and reads marker within max age', () => {
    persistImportSessionMarker({
      startedAt: new Date().toISOString(),
      dataMonth: '2025-03',
      batchName: '三月投诉',
      progress: '正在写入…',
    })
    const marker = readImportSessionMarker()
    expect(marker?.dataMonth).toBe('2025-03')
    expect(marker?.batchName).toBe('三月投诉')
    expect(sessionStorage.getItem(IMPORT_SESSION_STORAGE_KEY)).toBeTruthy()
  })

  it('clears expired marker', () => {
    persistImportSessionMarker({
      startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      dataMonth: '2025-01',
    })
    expect(readImportSessionMarker()).toBeNull()
  })

  it('updates progress on existing marker', () => {
    persistImportSessionMarker({
      startedAt: new Date().toISOString(),
      dataMonth: '2025-04',
    })
    updateImportSessionMarkerProgress('正在打标 (3/10)…')
    expect(readImportSessionMarker()?.progress).toBe('正在打标 (3/10)…')
  })

  it('formats interrupted import message', () => {
    expect(
      formatInterruptedImportMessage({
        startedAt: new Date().toISOString(),
        dataMonth: '2025-05',
        batchName: '测试批次',
        progress: '正在写入服务器 (10/100)…',
      }),
    ).toContain('2025-05')
    expect(
      formatInterruptedImportMessage({
        startedAt: new Date().toISOString(),
        dataMonth: '2025-05',
        batchName: '测试批次',
        progress: '正在写入服务器 (10/100)…',
      }),
    ).toContain('测试批次')
  })
})
