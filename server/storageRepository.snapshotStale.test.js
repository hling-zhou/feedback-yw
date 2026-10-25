import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-snapshot-stale-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-snapshot-stale-xx'

const sqliteOk = await (async () => {
  try {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    closeDb()
    return true
  } catch (err) {
    console.warn('[snapshotStale.test] db 不可用，跳过：', err instanceof Error ? err.stack : err)
    return false
  }
})()

const describeRepo = sqliteOk ? describe : describe.skip

const PERIOD = 'period:month:2026-01'

describeRepo('storageRepository.markPostUseDependentSnapshotsStale', () => {
  /** @type {typeof import('./storageRepository.js').storageRepository} */
  let repo
  /** @type {typeof import('./db.js').getDb} */
  let getDb

  beforeAll(async () => {
    const dbMod = await import('./db.js')
    dbMod.closeDb()
    getDb = dbMod.getDb
    getDb()
    // storageRepository 是具名导出的单对象（非模块级散装导出，区别于 mailRepository）
    repo = (await import('./storageRepository.js')).storageRepository
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    getDb().exec('DELETE FROM snapshots')
  })

  it('仅把 ready 的用后即评/概述快照置为 stale，其他类型与状态不受影响', () => {
    const otherPeriod = 'period:month:2026-02'
    const cases = [
      // [id, status, shouldBecomeStale]
      // 同 id 的负例必须换期间：putSnapshot 是 INSERT OR REPLACE，同 id 后写覆盖前写
      [`snapshot:${PERIOD}:post_use_rating`, 'ready', true],
      [`overview:${PERIOD}`, 'ready', true],
      [`snapshot:${PERIOD}:complaint_ticket`, 'ready', false],
      [`snapshot:${PERIOD}:consultation_ticket`, 'ready', false],
      [`snapshot:${otherPeriod}:post_use_rating`, 'stale', false],
      [`overview:${otherPeriod}`, 'rebuilding', false],
    ]
    for (const [id, status] of cases) {
      repo.putSnapshot({
        id,
        insightPeriodId: PERIOD,
        dataSourceType: id.startsWith('overview:') ? undefined : id.split(':').pop(),
        status,
        summary: { recordCount: 1 },
        keepMe: { nested: [1, 2, 3] },
      })
    }

    const updated = repo.markPostUseDependentSnapshotsStale()
    expect(updated).toBe(2)

    for (const [id, status, shouldStale] of cases) {
      const snap = repo.getSnapshot(id)
      expect(snap).not.toBeNull()
      expect(snap.status).toBe(shouldStale ? 'stale' : status)
      // json_set 不得破坏其余字段
      expect(snap.keepMe).toEqual({ nested: [1, 2, 3] })
      expect(snap.summary).toEqual({ recordCount: 1 })
    }
  })

  it('无 ready 快照时返回 0 且不报错', () => {
    repo.putSnapshot({
      id: `snapshot:${PERIOD}:post_use_rating`,
      insightPeriodId: PERIOD,
      dataSourceType: 'post_use_rating',
      status: 'stale',
    })
    expect(repo.markPostUseDependentSnapshotsStale()).toBe(0)
  })

  it('覆盖全部期间（多次调用幂等，只处理 ready）', () => {
    const periods = ['period:month:2026-01', 'period:month:2026-02', 'period:year:2026']
    for (const p of periods) {
      repo.putSnapshot({
        id: `snapshot:${p}:post_use_rating`,
        insightPeriodId: p,
        dataSourceType: 'post_use_rating',
        status: 'ready',
      })
    }
    expect(repo.markPostUseDependentSnapshotsStale()).toBe(3)
    // 第二次调用：全部已是 stale，无更新
    expect(repo.markPostUseDependentSnapshotsStale()).toBe(0)
  })
})
