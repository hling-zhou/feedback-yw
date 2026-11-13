import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-record-changes-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-record-changes-xx'

let sqliteAvailable = false
try {
  const { closeDb, getDb } = await import('../db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

describe.skipIf(!sqliteAvailable)('record change sync API', () => {
  let app
  let auth

  beforeAll(async () => {
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const { registerAuthHooks } = await import('../middleware.js')
    const { registerStorageRoutes } = await import('./storage.js')
    const user = await createUser({
      username: 'record_change_editor',
      password: 'EditorPass12345!',
      team: '综合管理组',
      role: 'editor',
    })
    auth = { authorization: `Bearer ${signAccessToken(user)}` }
    app = Fastify()
    registerAuthHooks(app)
    registerStorageRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('replays batch writes, updates and a deletion with compact IDs and latest list records', async () => {
    const { storageRepository } = await import('../storageRepository.js')
    const first = {
      id: 'delta-complaint-a', dataSourceType: 'complaint_ticket', importMonth: '2026-11',
      createdAt: '2026-11-02T00:00:00.000Z', ticketId: 'DELTA-A', rawText: 'large text',
    }
    const second = {
      id: 'delta-consultation-b', dataSourceType: 'consultation_ticket', importMonth: '2026-11',
      createdAt: '2026-11-03T00:00:00.000Z', ticketId: 'DELTA-B', rawText: 'other large text',
    }
    storageRepository.putRecords([first, second])
    storageRepository.putRecords([{ ...first, sentiment: 'negative' }])
    storageRepository.deleteRecord(second.id)

    const revision = await app.inject({ method: 'GET', url: '/api/storage/revision', headers: auth })
    expect(revision.statusCode).toBe(200)
    const through = revision.json().recordCursor
    expect(through).toBe(4)

    const one = await app.inject({
      method: 'GET', url: `/api/storage/records/changes?after=0&through=${through}&limit=2`, headers: auth,
    })
    expect(one.statusCode).toBe(200)
    expect(one.json().changes.map((change) => change.id))
      .toEqual([first.id, second.id])
    expect(one.json().hasMore).toBe(true)
    const two = await app.inject({
      method: 'GET', url: `/api/storage/records/changes?after=${one.json().cursor}&through=${through}&limit=2`, headers: auth,
    })
    expect(two.json().changes.map((change) => change.id))
      .toEqual([first.id, second.id])
    expect(two.json().changes.at(-1).newSourceType).toBeNull()
    expect(two.json().hasMore).toBe(false)

    const latest = await app.inject({
      method: 'POST', url: '/api/storage/records/by-ids', headers: auth,
      payload: { ids: [first.id, second.id], fields: 'list' },
    })
    expect(latest.statusCode).toBe(200)
    expect(latest.json().records.map((record) => record.id)).toEqual([first.id])
    expect(latest.json().records[0].sentiment).toBe('negative')
    expect(latest.json().records[0].rawText).toBeUndefined()
    expect(latest.json().records[0].generalization).toBe('none')
  })

  it('does not expose a task result to browsers that are not waiting for it', async () => {
    const { listTaskResults, setTaskResult } = await import('../backgroundTaskLock.js')
    setTaskResult('delta-task-result', { status: 'success', mode: 'retag' })

    const passive = await app.inject({ method: 'GET', url: '/api/storage/background-task', headers: auth })
    expect(passive.statusCode).toBe(200)
    expect(passive.json().results).toEqual([])

    const watched = await app.inject({
      method: 'GET', url: '/api/storage/background-task?watchTaskIds=delta-task-result', headers: auth,
    })
    expect(watched.json().results.map((result) => result.taskId)).toEqual(['delta-task-result'])

    const cleared = await app.inject({
      method: 'DELETE', url: '/api/storage/background-task/result?taskId=delta-task-result', headers: auth,
    })
    expect(cleared.statusCode).toBe(200)

    for (let i = 0; i < 51; i += 1) setTaskResult(`delta-unclaimed-${i}`, { status: 'success' })
    expect(listTaskResults()).toHaveLength(50)
  })
})
