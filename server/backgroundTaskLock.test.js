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

  it('rejects conflicting acquire from another user', async () => {
    const { acquireBackgroundTaskLock } = await import('./backgroundTaskLock.js')

    acquireBackgroundTaskLock('retag', {
      id: 'user-1',
      username: 'alice',
      progress: '打标中',
    })

    expect(() =>
      acquireBackgroundTaskLock('import', {
        id: 'user-2',
        username: 'bob',
      }),
    ).toThrow(/alice/)
  })

  it('allows same user to refresh an existing lock', async () => {
    const { acquireBackgroundTaskLock, getBackgroundTaskLock } = await import('./backgroundTaskLock.js')

    const first = acquireBackgroundTaskLock('retag', {
      id: 'user-1',
      username: 'alice',
      meta: { total: 5 },
    })
    const second = acquireBackgroundTaskLock('retag', {
      id: 'user-1',
      username: 'alice',
      progress: '继续',
      meta: { total: 8 },
    })

    expect(second.created).toBe(false)
    expect(second.lock.id).toBe(first.lock.id)
    expect(getBackgroundTaskLock()?.meta?.total).toBe(8)
  })
})
