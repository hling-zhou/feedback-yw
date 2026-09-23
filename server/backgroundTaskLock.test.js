import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-background-task-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-background-task-xx'

let sqliteAvailable = false
try {
  const { closeDb, getDb } = await import('./db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

const describeLock = sqliteAvailable ? describe : describe.skip

describeLock('background task lock server', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { storageRepository } = await import('./storageRepository.js')
    await storageRepository.init()
  })

  beforeEach(async () => {
    const { storageRepository } = await import('./storageRepository.js')
    storageRepository.deleteMeta('background_task_lock')
    storageRepository.deleteMeta('background_tasks')
    storageRepository.deleteMeta('background_task_history')
    storageRepository.deleteMeta('background_task_cancel')
    storageRepository.deleteMeta('background_task_result')
    storageRepository.deleteMeta('background_task_results')
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
  })

  it('acquires, updates, and releases lock', async () => {
    const {
      acquireBackgroundTaskLock,
      getBackgroundTaskLock,
      touchBackgroundTaskLock,
      releaseBackgroundTaskLock,
    } = await import('./backgroundTaskLock.js')

    const { lock, created } = acquireBackgroundTaskLock('import', {
      id: 'user-1',
      username: 'alice',
      progress: '准备中',
      meta: { dataMonth: '2026-01' },
    })
    expect(created).toBe(true)
    expect(getBackgroundTaskLock()?.id).toBe(lock.id)

    const touched = touchBackgroundTaskLock('user-1', { progress: '写入中' })
    expect(touched.progress).toBe('写入中')

    expect(releaseBackgroundTaskLock('user-1')).toBe(true)
    expect(getBackgroundTaskLock()).toBeNull()
  })

  it('rejects an import that overlaps an active retag period', async () => {
    const { acquireBackgroundTaskLock } = await import('./backgroundTaskLock.js')

    acquireBackgroundTaskLock('retag', {
      id: 'user-1',
      username: 'alice',
      progress: '打标中',
      meta: { periodId: 'p-2026-03', periodStart: '2026-03-01', periodEnd: '2026-03-31' },
    })

    expect(() =>
      acquireBackgroundTaskLock('import', {
        id: 'user-2',
        username: 'bob',
        meta: { dataMonth: '2026-03', dataSourceType: 'complaint_ticket' },
      }),
    ).toThrow(/alice/)
  })

  it('rejects a second retag of the same period', async () => {
    const { acquireBackgroundTaskLock } = await import('./backgroundTaskLock.js')

    acquireBackgroundTaskLock('retag', {
      id: 'user-1',
      username: 'alice',
      meta: { periodId: 'p-2026-03', total: 5 },
    })
    expect(() =>
      acquireBackgroundTaskLock('retag', {
        id: 'user-1',
        username: 'alice',
        progress: '继续',
        meta: { periodId: 'p-2026-03', total: 8 },
      }),
    ).toThrow(/alice/)
  })

  it('rejects a second import of the same month and source', async () => {
    const { acquireBackgroundTaskLock } = await import('./backgroundTaskLock.js')
    acquireBackgroundTaskLock('import', {
      id: 'user-1',
      username: 'alice',
      progress: '正在规则打标 (1/10)',
      meta: { dataMonth: '2026-03', dataSourceType: 'complaint_ticket', phase: 'server' },
    })
    expect(() =>
      acquireBackgroundTaskLock('import', {
        id: 'user-1',
        username: 'alice',
        meta: { dataMonth: '2026-03', dataSourceType: 'complaint_ticket' },
      }),
    ).toThrow(/alice/)
  })

  it('allows a second import of another month', async () => {
    const { acquireBackgroundTaskLock, listBackgroundTasks } = await import('./backgroundTaskLock.js')
    acquireBackgroundTaskLock('import', {
      id: 'user-1',
      username: 'alice',
      meta: { dataMonth: '2026-03', dataSourceType: 'complaint_ticket' },
    })
    const second = acquireBackgroundTaskLock('import', {
      id: 'user-1',
      username: 'alice',
      meta: { dataMonth: '2026-04', dataSourceType: 'complaint_ticket' },
    })
    expect(second.created).toBe(true)
    expect(listBackgroundTasks()).toHaveLength(2)
  })

  it('finalizes cancel immediately for a client-phase task', async () => {
    const {
      acquireBackgroundTaskLock,
      getBackgroundTaskLock,
      getTaskHistory,
      requestBackgroundTaskCancel,
    } = await import('./backgroundTaskLock.js')

    acquireBackgroundTaskLock('import', {
      id: 'user-1',
      username: 'alice',
      progress: '正在规则打标 (12/300)…',
      meta: { phase: 'client', dataMonth: '2026-08' },
    })

    const result = requestBackgroundTaskCancel('user-1', getBackgroundTaskLock().id)
    expect(result.finalized).toBe(true)
    expect(result.lock).toBeNull()
    expect(getBackgroundTaskLock()).toBeNull()
    expect(getTaskHistory()[0]?.status).toBe('cancelled')
  })

  it('keeps lock when cancelling an enrich-phase task', async () => {
    const {
      acquireBackgroundTaskLock,
      getBackgroundTaskLock,
      requestBackgroundTaskCancel,
    } = await import('./backgroundTaskLock.js')

    acquireBackgroundTaskLock('import', {
      id: 'user-1',
      username: 'alice',
      progress: '正在增强打标 (3/10)',
      meta: { phase: 'enrich' },
    })

    const result = requestBackgroundTaskCancel('user-1', getBackgroundTaskLock().id)
    expect(result.finalized).toBe(false)
    expect(result.lock?.progress).toBe('正在取消…')
    expect(result.lock?.meta?.cancelled).toBe(true)
    expect(getBackgroundTaskLock()?.id).toBe(result.lock?.id)
  })
})
