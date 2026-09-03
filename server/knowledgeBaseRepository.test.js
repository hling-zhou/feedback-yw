import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-kb-repo-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-kb-repo-xx'

import { closeDb, getDb } from './db.js'
import {
  countKnowledgeBases,
  deleteKnowledgeBase,
  getKnowledgeBaseRow,
  listKnowledgeBases,
  upsertKnowledgeBase,
} from './knowledgeBaseRepository.js'

function kbPayload(productLine, productName, details) {
  return JSON.stringify({ productLine, productName, exportDate: '2026-09-04', modules: [], details })
}

describe('knowledgeBaseRepository', () => {
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
  })

  it('upsert inserts and lists', () => {
    expect(countKnowledgeBases()).toBe(0)
    const summary = upsertKnowledgeBase({
      productKey: 'eip',
      productName: '弹性公网IP',
      exportDate: '2026-09-04',
      payload: kbPayload('eip', '弹性公网IP', [{ name: 'f1' }]),
      user: { id: 'u1', username: 'alice' },
    })
    expect(summary.productKey).toBe('eip')
    expect(summary.sizeBytes).toBeGreaterThan(0)
    expect(summary.uploadedByUsername).toBe('alice')

    const list = listKnowledgeBases()
    expect(list).toHaveLength(1)
    expect(list[0].productName).toBe('弹性公网IP')
    expect(list[0].uploadedByUsername).toBe('alice')
    expect(countKnowledgeBases()).toBe(1)
  })

  it('upsert replaces existing productKey (overwrite)', () => {
    upsertKnowledgeBase({
      productKey: 'eip',
      productName: '旧名',
      payload: kbPayload('eip', '旧名', [{ name: 'f1' }]),
      user: { username: 'alice' },
    })
    upsertKnowledgeBase({
      productKey: 'eip',
      productName: '新名',
      exportDate: '2026-10-01',
      payload: kbPayload('eip', '新名', [{ name: 'f1' }, { name: 'f2' }]),
      user: { username: 'bob' },
    })
    expect(countKnowledgeBases()).toBe(1)
    const list = listKnowledgeBases()
    expect(list[0].productName).toBe('新名')
    expect(list[0].uploadedByUsername).toBe('bob')
    expect(list[0].exportDate).toBe('2026-10-01')
    const row = getKnowledgeBaseRow('eip')
    expect(row).not.toBeNull()
    const parsed = JSON.parse(row.payload)
    expect(parsed.details).toHaveLength(2)
  })

  it('getKnowledgeBaseRow returns null for missing', () => {
    expect(getKnowledgeBaseRow('missing')).toBeNull()
  })

  it('deleteKnowledgeBase removes and returns flag', () => {
    upsertKnowledgeBase({
      productKey: 'vpc',
      productName: '虚拟私有云',
      payload: kbPayload('vpc', '虚拟私有云', []),
      user: { username: 'alice' },
    })
    expect(deleteKnowledgeBase('vpc')).toBe(true)
    expect(countKnowledgeBases()).toBe(0)
    expect(deleteKnowledgeBase('vpc')).toBe(false)
  })

  it('upsert throws on empty productKey/payload', () => {
    expect(() => upsertKnowledgeBase({ productKey: '', payload: '{}' })).toThrow()
    expect(() => upsertKnowledgeBase({ productKey: 'eip', payload: '' })).toThrow()
  })
})
