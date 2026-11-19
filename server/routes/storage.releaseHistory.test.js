/**
 * 路由级链路守卫：客户端任务（用后即评导入三类，11-19 拍板）的历史写入点——
 * acquire → touch finished → DELETE 释放 → 历史写入断言（fastify app.inject 真实 HTTP 链路）。
 * 守卫锚定在链路层（防缺陷触发规则 §4）：纯函数层守卫抓不到「前端 touch → 服务端读 meta」的链路形态断裂。
 * 红绿证明：注入「跳过 finished 写历史」反向 bug 时前两用例必须红（2026-11-19 已证）。
 * 纪律：先设 AUTH_DATABASE_PATH/SERVER_DATA_DIR 再动态 import。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'

const tempDir = mkdtempSync(join(tmpdir(), 'fi-release-history-test-'))
process.env.AUTH_DATABASE_PATH = join(tempDir, 'test.db')
process.env.SERVER_DATA_DIR = tempDir
process.env.JWT_SECRET = 'test-jwt-secret-release-history-xx'

/** @type {import('fastify').FastifyInstance} */
let app
let getTaskHistory
let acquireBackgroundTaskLock
let touchBackgroundTask

beforeAll(async () => {
  const dbModule = await import('../db.js')
  dbModule.getDb()
  const { storageRepository } = await import('../storageRepository.js')
  await storageRepository.init()

  const lockModule = await import('../backgroundTaskLock.js')
  getTaskHistory = lockModule.getTaskHistory
  acquireBackgroundTaskLock = lockModule.acquireBackgroundTaskLock
  touchBackgroundTask = lockModule.touchBackgroundTask

  const { registerStorageRoutes } = await import('./storage.js')
  const { FASTIFY_SCHEMA_OPTIONS } = await import('../schemas/common.js')
  app = Fastify({ ...FASTIFY_SCHEMA_OPTIONS })
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    request.user = { id: 'u1', username: 'alice', role: 'admin' }
  })
  registerStorageRoutes(app)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('DELETE /api/storage/background-task 按 meta.finished 写历史（真实 HTTP 链路）', () => {
  it('用后即评导入锁：touch finished → DELETE → 写 success 历史且锁清空', async () => {
    // ① acquire 客户端锁（渠道包导入真实形态）
    const { lock } = acquireBackgroundTaskLock('import', {
      id: 'u1',
      username: 'alice',
      progress: '正在解析双文件…',
      meta: {
        phase: 'client',
        importKind: 'postUseChannel',
        importMonth: '2026-10',
        dataSourceType: 'post_use_rating',
      },
    })
    expect(lock.id).toBeTruthy()

    // ② touch finished 终态（前端收尾链行为）
    touchBackgroundTask(lock.id, {
      meta: {
        finished: {
          status: 'success',
          source: '用后即评双文件',
          summary: { detail: '新增 42' },
        },
      },
    })

    // ③ DELETE 释放（前端 releaseSharedBackgroundTask 行为）
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/storage/background-task?taskId=${encodeURIComponent(lock.id)}`,
    })
    expect(res.statusCode).toBe(200)

    // ④ 断言：历史写入（含 importMonth→dataMonth 映射），锁清空
    const history = getTaskHistory()
    expect(history).toHaveLength(1)
    const entry = history[0]
    expect(entry.id).toBe(lock.id)
    expect(entry.type).toBe('import')
    expect(entry.status).toBe('success')
    expect(entry.source).toBe('用后即评双文件')
    expect(entry.username).toBe('alice')
    expect(entry.dataMonth).toBe('2026-10')
    expect(entry.dataSourceType).toBe('post_use_rating')
    expect(entry.summary?.detail).toBe('新增 42')
    expect(entry.error).toBeUndefined()
  })

  it('failed 终态：写 failed 历史带 error', async () => {
    const { lock } = acquireBackgroundTaskLock('import', {
      id: 'u1',
      username: 'alice',
      progress: '正在导入省代表回访…',
      meta: {
        phase: 'client',
        importKind: 'customerVisit',
        importMonth: '2026-09',
        dataSourceType: 'post_use_rating',
      },
    })
    touchBackgroundTask(lock.id, {
      meta: {
        finished: {
          status: 'failed',
          source: '省代表回访导入',
          error: '写盘失败',
        },
      },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/storage/background-task?taskId=${encodeURIComponent(lock.id)}`,
    })
    expect(res.statusCode).toBe(200)
    const history = getTaskHistory()
    const entry = history[0]
    expect(entry.status).toBe('failed')
    expect(entry.error).toBe('写盘失败')
    expect(entry.dataMonth).toBe('2026-09')
  })

  it('无 finished 的释放（analysis/customer_restore 既有路径）不写历史', async () => {
    const before = getTaskHistory().length
    const { lock } = acquireBackgroundTaskLock('import', {
      id: 'u1',
      username: 'alice',
      progress: '正在导入分析结果…',
      meta: { importKind: 'analysis', batchName: '导入分析结果' },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/storage/background-task?taskId=${encodeURIComponent(lock.id)}`,
    })
    expect(res.statusCode).toBe(200)
    expect(getTaskHistory().length).toBe(before)
  })

  it('释放他人/不存在的锁 404，不写历史', async () => {
    const before = getTaskHistory().length
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/storage/background-task?taskId=nonexistent',
    })
    expect(res.statusCode).toBe(404)
    expect(getTaskHistory().length).toBe(before)
  })
})
