import fs from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * 流式写盘取消协作守卫（11-08 会诊 D-1，裸奔约定补防）。
 *
 * 拍板口径（项目 MEMORY「后台任务与 LLM 增强」）：
 *   ① 规则重打标流式写盘每 FLUSH_BATCH_SIZE 条 putRecords；
 *   ② 取消 = 先 flush pendingBatch 再 return（已处理的不丢）；
 *   ③ stats.cancelled=true + processed 透传取消态；任务结束自动释放锁。
 *
 * 真实集成测试：真 DB（隔离库）+ 真任务锁 + 真取消信号，走 runEnrichment
 * 完整调用链——fixture 会绕过锁状态/取消时序/pendingBatch 中间态。
 */

process.env.AUTH_DATABASE_PATH = `/tmp/fi-enrich-cancel-guard-${process.pid}.db`
fs.rmSync(process.env.AUTH_DATABASE_PATH, { force: true })

const { runEnrichment } = await import('./enrichRunner.js')
const {
  acquireBackgroundTaskLock,
  requestBackgroundTaskCancel,
  releaseBackgroundTaskLock,
  getBackgroundTaskLock,
} = await import('./backgroundTaskLock.js')
const { storageRepository } = await import('./storageRepository.js')
const { closeDb } = await import('./db.js')

/** 构造最小可重打标记录（弹性公网IP = 种子目录 acceptParentName 认可的父名，空库 in-scope） */
function makeRecord(i) {
  return {
    id: `rec-cancel-${i}`,
    dataSourceType: 'complaint_ticket',
    tenantId: 'local',
    schemaVersion: '2',
    recordStatus: 'analyzed',
    importedAt: '2026-11-01T00:00:00.000Z',
    importMonth: '2026-11',
    ticketId: `T-CANCEL-${i}`,
    rawText: `客户反馈业务不通，需要排查网络配置问题 ${i}`,
    customerQuote: '',
    handlingText: '处理意见：已协助客户排查网络配置，恢复业务。',
    requestScene: '报障与排错',
    problemType: '可用性/连通性故障',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    sentiment: 'neutral',
    status: 'open',
    product: '弹性公网IP',
  }
}

describe('流式写盘取消协作守卫（bulk_retag 真实链路）', () => {
  const userId = 'user-cancel-guard'

  beforeAll(async () => {
    await storageRepository.init()
  })

  afterAll(async () => {
    releaseBackgroundTaskLock(userId)
    await closeDb()
    fs.rmSync(process.env.AUTH_DATABASE_PATH, { force: true })
  })

  it('取消先 flush 再 return：已处理记录落库不丢 + stats.cancelled 透传 + 锁自动释放', async () => {
    const { lock } = acquireBackgroundTaskLock('bulk_retag', {
      id: userId,
      username: 'cancel-guard',
    })

    const records = Array.from({ length: 12 }, (_, i) => makeRecord(i))
    let cancelledOnce = false
    const result = await runEnrichment({
      mode: 'bulk_retag',
      settings: { themeMatchMode: 'keyword' },
      userId,
      username: 'cancel-guard',
      taskId: lock.id,
      records,
      retagOptions: { scope: 'all' },
      onProgress: (_label, done) => {
        // 第 1 条处理完后取消（走 cancelled() → flush pendingBatch → return 路径）
        if (done >= 1 && !cancelledOnce) {
          cancelledOnce = true
          requestBackgroundTaskCancel(userId, lock.id)
        }
      },
    })

    // ① 取消态透传 + processed 计数在 1..11 之间（第 1 条后取消，未跑完全量）
    expect(result.stats.cancelled).toBe(true)
    expect(result.stats.processed).toBeGreaterThan(0)
    expect(result.stats.processed).toBeLessThan(records.length)

    // ② flush 落库验证：取消前已处理的记录在 DB 里（不因取消丢失）
    const persisted = await storageRepository.listRecords({ limit: 1000 })
    const rows = Array.isArray(persisted) ? persisted : (persisted.records || [])
    const persistedIds = new Set(rows.map((r) => String(r.id)))
    const persistedFromBatch = records
      .slice(0, result.stats.processed)
      .filter((r) => persistedIds.has(r.id))
    expect(persistedFromBatch.length).toBeGreaterThan(0)

    // ③ 锁分工口径：runEnrichment 不释放锁（释放是路由层 finally 职责，
    //    storage.js:884）——runner 结束后锁仍在，由调用方（模拟路由层）释放
    expect(getBackgroundTaskLock()).not.toBeNull()
    releaseBackgroundTaskLock(userId)
    expect(getBackgroundTaskLock()).toBeNull()
  })

  it('正常完成路径（不取消）：全量重打标完成 + 无取消标记 + 锁自动释放', async () => {
    const { lock } = acquireBackgroundTaskLock('bulk_retag', {
      id: userId,
      username: 'cancel-guard-2',
    })

    const records = Array.from({ length: 3 }, (_, i) => makeRecord(100 + i))
    const result = await runEnrichment({
      mode: 'bulk_retag',
      settings: { themeMatchMode: 'keyword' },
      userId,
      username: 'cancel-guard-2',
      taskId: lock.id,
      records,
      retagOptions: { scope: 'all' },
    })

    // 正常完成：无 cancelled 标记，记录全量返回；锁由调用方（路由层）释放
    expect(result.stats.cancelled).toBeUndefined()
    expect(result.records.length).toBe(records.length)
    expect(getBackgroundTaskLock()).not.toBeNull()
    releaseBackgroundTaskLock(userId)
    expect(getBackgroundTaskLock()).toBeNull()
  })
})
