import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-assistant-thread-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-assistant-thread-xx'
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'

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

const describeThread = sqliteAvailable ? describe : describe.skip

describeThread('assistantThreadRepository', () => {
  /** @type {import('./assistantThreadRepository.js').assistantThreadRepository} */
  let repo

  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const mod = await import('./assistantThreadRepository.js')
    repo = mod.assistantThreadRepository
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('isolates threads by user and deletes only own threads', () => {
    const tA = repo.createThread('user-A', 'A 的对话')
    const tB = repo.createThread('user-B', 'B 的对话')

    // 用户 A 看不到 B 的线程
    const aThreads = repo.listThreads('user-A')
    expect(aThreads.find((t) => t.id === tB.id)).toBeUndefined()
    expect(aThreads.find((t) => t.id === tA.id)).toBeDefined()

    // A 不能删 B 的线程
    expect(repo.deleteThread('user-A', tB.id)).toBe(false)
    expect(repo.getThread('user-B', tB.id)).not.toBeNull()

    // A 能删自己的
    expect(repo.deleteThread('user-A', tA.id)).toBe(true)
    expect(repo.getThread('user-A', tA.id)).toBeNull()
  })

  it('appends messages and lists them in order', () => {
    const t = repo.createThread('user-C', '消息顺序')
    repo.appendMessage(t.id, 'user', { question: '第一问' })
    repo.appendMessage(t.id, 'assistant', { answer: '第一答' })
    repo.appendMessage(t.id, 'user', { question: '第二问' })
    const msgs = repo.listMessages('user-C', t.id)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(msgs[0].payload.question).toBe('第一问')
    expect(msgs[1].payload.answer).toBe('第一答')
  })

  it('renames thread title (truncated)', () => {
    const t = repo.createThread('user-D', '短标题')
    const longTitle = '这是一个非常非常非常非常非常非常非常非常非常非常非常长的标题'.repeat(2)
    repo.renameThread(t.id, longTitle)
    const updated = repo.getThread('user-D', t.id)
    expect(updated?.title.length).toBeLessThanOrEqual(41) // 40 + …
  })

  it('caps threads per user at 20 and prunes oldest', () => {
    for (let i = 0; i < 22; i++) {
      repo.createThread('user-E', `线程${i}`)
    }
    const threads = repo.listThreads('user-E')
    expect(threads.length).toBe(20)
  })

  it('appendTurn writes user and assistant in one go', () => {
    const t = repo.createThread('user-G', '成对写入')
    const { user, assistant } = repo.appendTurn(
      t.id,
      { question: '问' },
      { answer: '答' },
      '问',
    )
    expect(user.role).toBe('user')
    expect(assistant.role).toBe('assistant')
    const msgs = repo.listMessages('user-G', t.id)
    expect(msgs).toHaveLength(2)
    expect(repo.getThread('user-G', t.id)?.title).toBe('问')
  })

  it('deleteAllForUser removes all threads and messages', () => {
    const t = repo.createThread('user-F', '待删')
    repo.appendMessage(t.id, 'user', { question: 'x' })
    repo.deleteAllForUser('user-F')
    expect(repo.listThreads('user-F')).toEqual([])
    expect(repo.listMessages('user-F', t.id)).toEqual([])
  })
})
