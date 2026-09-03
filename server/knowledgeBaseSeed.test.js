import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-kb-seed-'))
const tmpKbDir = path.join(tmpDir, 'kb')
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-kb-seed-xx'
process.env.KNOWLEDGE_BASE_DIR = tmpKbDir

import { closeDb, getDb } from './db.js'
import { seedKnowledgeBasesIfEmpty } from './knowledgeBaseSeed.js'
import { countKnowledgeBases, listKnowledgeBases } from './knowledgeBaseRepository.js'

function writeKbFile(subDir, productLine, productName, details) {
  const dir = path.join(tmpKbDir, subDir)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${productLine}_biz_knowledge_base.json`),
    JSON.stringify({ productLine, productName, exportDate: '2026-09-04', modules: [], details }),
  )
}

describe('knowledgeBaseSeed', () => {
  beforeAll(() => {
    closeDb()
    getDb()
  })

  afterAll(() => {
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    getDb().exec('DELETE FROM knowledge_bases')
    fs.rmSync(tmpKbDir, { recursive: true, force: true })
    fs.mkdirSync(tmpKbDir, { recursive: true })
  })

  it('seeds from filesystem when DB is empty', async () => {
    writeKbFile('EIP_Knowledge_Base', 'eip', '弹性公网IP', [{ name: 'f1' }])
    const result = await seedKnowledgeBasesIfEmpty()
    expect(result.seeded).toBe(1)
    expect(result.skipped).toBe(false)
    expect(countKnowledgeBases()).toBe(1)
    const list = listKnowledgeBases()
    expect(list[0].productKey).toBe('eip')
    expect(list[0].uploadedByUsername).toBe('system-seed')
  })

  it('skips seeding when DB already has KBs', async () => {
    writeKbFile('EIP_Knowledge_Base', 'eip', '弹性公网IP', [{ name: 'f1' }])
    await seedKnowledgeBasesIfEmpty()
    expect(countKnowledgeBases()).toBe(1)
    // 再调一次，不应重复导入也不应清空
    const result = await seedKnowledgeBasesIfEmpty()
    expect(result.skipped).toBe(true)
    expect(result.seeded).toBe(0)
    expect(countKnowledgeBases()).toBe(1)
  })

  it('seeds nothing when dir has no KB files', async () => {
    const result = await seedKnowledgeBasesIfEmpty()
    expect(result.seeded).toBe(0)
    expect(countKnowledgeBases()).toBe(0)
  })

  it('seeds multiple products', async () => {
    writeKbFile('EIP', 'eip', '弹性公网IP', [{ name: 'f1' }])
    writeKbFile('VPC', 'vpc', '虚拟私有云', [{ name: 'g1' }])
    const result = await seedKnowledgeBasesIfEmpty()
    expect(result.seeded).toBe(2)
    expect(countKnowledgeBases()).toBe(2)
  })
})
