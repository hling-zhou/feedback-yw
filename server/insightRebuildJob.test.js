import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
    const { enqueueInsightRebuild, getInsightRebuildJob } = await import('./insightRebuildJob.js')
    const { storageRepository } = await import('./storageRepository.js')

    const { job, started } = await enqueueInsightRebuild(samplePeriod.id, 'test')
    expect(started).toBe(true)
    expect(job.status).toBe('queued')

    const deadline = Date.now() + 30_000
    let latest = job
    while (Date.now() < deadline) {
      latest = getInsightRebuildJob(job.id) || latest
      if (latest.status === 'succeeded' || latest.status === 'failed') break
      await new Promise((r) => setTimeout(r, 100))
    }

    expect(latest.status).toBe('succeeded')
    const snapshots = storageRepository.listSnapshotsByPeriod(samplePeriod.id)
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    const overview = snapshots.find((s) => s.id?.startsWith('overview:'))
    expect(overview?.status).toBe('ready')
    expect(overview?.conclusions?.sampleSize).toBeGreaterThanOrEqual(0)
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
})
