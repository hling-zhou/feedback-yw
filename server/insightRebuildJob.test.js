import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-insight-rebuild-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-insight-rebuild-xx'

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

const samplePeriod = {
  id: 'period:month:2026-01',
  label: '2026年1月',
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  granularity: 'month',
  anchorYear: 2026,
  anchorMonth: 1,
  status: 'active',
  tenantId: 'local',
  schemaVersion: '2.0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const sampleRecord = {
  id: 'rec-insight-rebuild-1',
  tenantId: 'local',
  schemaVersion: '2.0',
  dataSourceType: 'complaint_ticket',
  importMonth: '2026-01',
  importBatchId: 'batch-1',
  importBatchName: '测试',
  product: '弹性公网IP',
  productKey: 'eip',
  taxonomyKey: 'eip',
  painPoint: '控制台绑定 EIP 失败',
  problemType: '产品功能缺陷',
  journeyL1: '绑定与网络配置',
  customerRequest: '希望尽快完成 EIP 绑定',
  createdAt: '2026-01-15T10:00:00.000Z',
  importedAt: '2026-01-15T10:00:00.000Z',
}

const describeJob = sqliteAvailable ? describe : describe.skip

describeJob('insight rebuild server job', () => {
  afterEach(() => vi.restoreAllMocks())

  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { storageRepository } = await import('./storageRepository.js')
    await storageRepository.init()
    storageRepository.putInsightPeriod(samplePeriod)
    storageRepository.putRecords([sampleRecord])
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
  })

  it('rebuilds snapshots asynchronously and marks job succeeded', async () => {
    const { enqueueInsightRebuild, waitForInsightRebuildCompletion } = await import('./insightRebuildJob.js')
    const { dirtyInsightGeneration } = await import('./insightSnapshotDirty.js')
    const { storageRepository } = await import('./storageRepository.js')

    expect(dirtyInsightGeneration(samplePeriod.id)).toBeGreaterThan(0)
    const { job, started } = await enqueueInsightRebuild(samplePeriod.id, 'test')
    expect(started).toBe(true)
    expect(job.status).toBe('queued')

    const latest = await waitForInsightRebuildCompletion(job.id)

    expect(latest.status).toBe('succeeded')
    expect(dirtyInsightGeneration(samplePeriod.id)).toBe(0)
    const snapshots = storageRepository.listSnapshotsByPeriod(samplePeriod.id)
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    const overview = snapshots.find((s) => s.id?.startsWith('overview:'))
    expect(overview?.status).toBe('ready')
    expect(overview?.conclusions?.sampleSize).toBeGreaterThanOrEqual(0)
    const complaint = snapshots.find((s) => s.dataSourceType === 'complaint_ticket')
    expect(complaint?.aggregates?.workbench?.all).toBeTruthy()
    expect(overview?.workbench?.journey).toBeTruthy()
  })

  it('marks only periods whose history range includes the written month', async () => {
    const { storageRepository } = await import('./storageRepository.js')
    const { dirtyInsightGeneration, clearDirtyInsightPeriodIfUnchanged } = await import('./insightSnapshotDirty.js')
    const future = {
      ...samplePeriod,
      id: 'period:month:2028-01',
      label: '2028年1月',
      startDate: '2028-01-01',
      endDate: '2028-01-31',
      anchorYear: 2028,
    }
    storageRepository.putInsightPeriod(future)
    storageRepository.putRecord({ ...sampleRecord, painPoint: '更新后的投诉内容' })
    expect(dirtyInsightGeneration(samplePeriod.id)).toBeGreaterThan(0)
    expect(storageRepository.listSnapshotsByPeriod(samplePeriod.id).some((snap) => snap.status === 'stale')).toBe(true)
    expect(dirtyInsightGeneration(future.id)).toBe(0)
    const current = dirtyInsightGeneration(samplePeriod.id)
    expect(clearDirtyInsightPeriodIfUnchanged(samplePeriod.id, current)).toBe(true)
    storageRepository.putRecord({ ...sampleRecord, importMonth: '2028-01' })
    expect(dirtyInsightGeneration(samplePeriod.id)).toBeGreaterThan(0)
    expect(dirtyInsightGeneration(future.id)).toBeGreaterThan(0)
    clearDirtyInsightPeriodIfUnchanged(samplePeriod.id, dirtyInsightGeneration(samplePeriod.id))
    clearDirtyInsightPeriodIfUnchanged(future.id, dirtyInsightGeneration(future.id))
  })

  it('refreshes the broad legacy period only when it already has a snapshot', async () => {
    const { LEGACY_INSIGHT_PERIOD_ID } = await import('../src/domain/constants.js')
    const { getDb } = await import('./db.js')
    const { storageRepository } = await import('./storageRepository.js')
    const { dirtyInsightGeneration, clearDirtyInsightPeriodIfUnchanged } = await import('./insightSnapshotDirty.js')
    expect(dirtyInsightGeneration(LEGACY_INSIGHT_PERIOD_ID)).toBe(0)
    storageRepository.putSnapshot({ id: 'test-legacy-snapshot', insightPeriodId: LEGACY_INSIGHT_PERIOD_ID, status: 'ready' })
    storageRepository.putRecord({ ...sampleRecord, importMonth: '2026-01' })
    expect(dirtyInsightGeneration(LEGACY_INSIGHT_PERIOD_ID)).toBeGreaterThan(0)
    clearDirtyInsightPeriodIfUnchanged(LEGACY_INSIGHT_PERIOD_ID, dirtyInsightGeneration(LEGACY_INSIGHT_PERIOD_ID))
    getDb().prepare('DELETE FROM snapshots WHERE id = ?').run('test-legacy-snapshot')
  })

  it('manual rebuild clears a matching dirty generation', async () => {
    const { enqueueInsightRebuild, waitForInsightRebuildCompletion } = await import('./insightRebuildJob.js')
    const { dirtyInsightGeneration, markInsightSnapshotPeriodDirty } = await import('./insightSnapshotDirty.js')
    markInsightSnapshotPeriodDirty(samplePeriod.id)
    const { job } = await enqueueInsightRebuild(samplePeriod.id, 'manual-test')
    expect((await waitForInsightRebuildCompletion(job.id)).status).toBe('succeeded')
    expect(dirtyInsightGeneration(samplePeriod.id)).toBe(0)
  })

  it('rejects manual rebuild while an import holds the write lock', async () => {
    const { enqueueInsightRebuild } = await import('./insightRebuildJob.js')
    const { acquireBackgroundTaskLock, releaseBackgroundTask } = await import('./backgroundTaskLock.js')
    const owner = { id: 'busy-rebuild-test', username: 'busy-rebuild-test', meta: { phase: 'client' } }
    const { lock } = acquireBackgroundTaskLock('import', owner)
    try {
      await expect(enqueueInsightRebuild(samplePeriod.id, 'manual-test'))
        .rejects.toMatchObject({ code: 'INSIGHT_REBUILD_BUSY' })
    } finally {
      releaseBackgroundTask(lock.id, owner.id)
    }
  })

  it('keeps the dirty marker when records change during a rebuild', async () => {
    const { enqueueInsightRebuild, waitForInsightRebuildCompletion } = await import('./insightRebuildJob.js')
    const { dirtyInsightGeneration, clearDirtyInsightPeriodIfUnchanged } = await import('./insightSnapshotDirty.js')
    const { storageRepository } = await import('./storageRepository.js')
    const listRecords = storageRepository.listRecords.bind(storageRepository)
    vi.spyOn(storageRepository, 'listRecords').mockImplementationOnce((query) => {
      storageRepository.putRecord({ ...sampleRecord, importMonth: '2026-01', painPoint: '重建期间写入' })
      return listRecords(query)
    })
    const { job } = await enqueueInsightRebuild(samplePeriod.id, 'manual-test')
    expect((await waitForInsightRebuildCompletion(job.id)).status).toBe('succeeded')
    expect(dirtyInsightGeneration(samplePeriod.id)).toBeGreaterThan(0)
    expect(storageRepository.listSnapshotsByPeriod(samplePeriod.id).some((snap) => snap.status === 'stale')).toBe(true)
    clearDirtyInsightPeriodIfUnchanged(samplePeriod.id, dirtyInsightGeneration(samplePeriod.id))
  })

  it('keeps a dirty marker and stale snapshots after a failed rebuild', async () => {
    const { enqueueInsightRebuild, waitForInsightRebuildCompletion } = await import('./insightRebuildJob.js')
    const { dirtyInsightGeneration, clearDirtyInsightPeriodIfUnchanged } = await import('./insightSnapshotDirty.js')
    const { storageRepository } = await import('./storageRepository.js')
    vi.spyOn(storageRepository, 'listRecords').mockImplementationOnce(() => {
      throw new Error('simulated storage read failure')
    })
    const { job } = await enqueueInsightRebuild(samplePeriod.id, 'manual-test')
    const finished = await waitForInsightRebuildCompletion(job.id)
    expect(finished.status).toBe('failed')
    expect(finished.errorSummary).toContain('simulated storage read failure')
    expect(dirtyInsightGeneration(samplePeriod.id)).toBeGreaterThan(0)
    expect(storageRepository.listSnapshotsByPeriod(samplePeriod.id).some((snap) => snap.status === 'stale')).toBe(true)
    clearDirtyInsightPeriodIfUnchanged(samplePeriod.id, dirtyInsightGeneration(samplePeriod.id))
  })

  it('marks affected periods when imported records are cleared by scope', async () => {
    const { storageRepository } = await import('./storageRepository.js')
    const { dirtyInsightGeneration, clearDirtyInsightPeriodIfUnchanged } = await import('./insightSnapshotDirty.js')
    const result = storageRepository.clearImportedData({
      insightPeriodId: samplePeriod.id,
      dataSourceType: 'complaint_ticket',
      allProducts: true,
    })
    expect(result.recordsDeleted).toBeGreaterThan(0)
    expect(dirtyInsightGeneration(samplePeriod.id)).toBeGreaterThan(0)
    clearDirtyInsightPeriodIfUnchanged(samplePeriod.id, dirtyInsightGeneration(samplePeriod.id))
  })

  it('findActiveInsightRebuildJob returns queued job for dedupe', async () => {
    const { createInsightRebuildJob } = await import('../src/domain/insightRebuildJob.js')
    const { storageRepository } = await import('./storageRepository.js')
    const { enqueueInsightRebuild } = await import('./insightRebuildJob.js')

    const pending = createInsightRebuildJob({
      insightPeriodId: 'period:month:2026-02',
      triggeredBy: 'test',
    })
    storageRepository.putInsightRebuildJob(pending)

    const active = storageRepository.findActiveInsightRebuildJob('period:month:2026-02')
    expect(active?.id).toBe(pending.id)

    const second = await enqueueInsightRebuild('period:month:2026-02', 'test')
    expect(second.started).toBe(false)
    expect(second.job.id).toBe(pending.id)
  })

  it('clears pending refresh markers with an explicit full data reset', async () => {
    const { storageRepository } = await import('./storageRepository.js')
    const { dirtyInsightGeneration } = await import('./insightSnapshotDirty.js')
    storageRepository.putRecord({ ...sampleRecord, importMonth: '2026-01' })
    expect(dirtyInsightGeneration(samplePeriod.id)).toBeGreaterThan(0)
    storageRepository.clearImportedData({ all: true })
    expect(dirtyInsightGeneration(samplePeriod.id)).toBe(0)
    expect(storageRepository.listSnapshotsByPeriod(samplePeriod.id)).toHaveLength(0)
  })
})
