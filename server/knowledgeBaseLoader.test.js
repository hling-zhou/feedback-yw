import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-kb-loader-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-kb-loader-xx'

import { closeDb, getDb } from './db.js'
import {
  clearKnowledgeBaseCache,
  getKnowledgeBase,
  retrieveSnippets,
  scoreFeature,
} from './knowledgeBaseLoader.js'
import { upsertKnowledgeBase } from './knowledgeBaseRepository.js'

const EIP_DETAILS = [
  {
    id: 'f1',
    name: '独享带宽订购',
    aliases: '独享带宽',
    description: 'K版和P版独享带宽的订购流程',
    scenarios: [{ name: 'K版独享带宽订购' }],
    globalRules: [
      { content: 'K版独享带宽订购时从Redis预创建队列弹出带宽标识。' },
      { content: 'P版独享带宽订购需校验配额。' },
    ],
  },
  {
    id: 'f2',
    name: '共享带宽',
    aliases: '共享带宽池',
    description: '共享带宽资源池的加入与移除',
    scenarios: [{ name: '共享带宽加入' }],
    globalRules: [{ content: '共享带宽加入需校验成员带宽状态。' }],
  },
]

describe('knowledgeBaseLoader (DB-backed)', () => {
  beforeAll(() => {
    closeDb()
    getDb() // 触发 initBusinessSchema（含 knowledge_bases 表）
    upsertKnowledgeBase({
      productKey: 'eip',
      productName: '弹性公网IP',
      exportDate: '2026-09-04',
      payload: JSON.stringify({
        productLine: 'eip',
        productName: '弹性公网IP',
        exportDate: '2026-09-04',
        modules: [],
        details: EIP_DETAILS,
      }),
      user: { username: 'test' },
    })
  })

  afterAll(() => {
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    clearKnowledgeBaseCache()
  })

  it('loads KB from DB indexed by productLine', () => {
    const kb = getKnowledgeBase('eip')
    expect(kb).not.toBeNull()
    expect(kb?.productName).toBe('弹性公网IP')
    expect(kb?.details.length).toBe(2)
  })

  it('returns null for unknown productKey', () => {
    expect(getKnowledgeBase('unknown')).toBeNull()
    expect(getKnowledgeBase('')).toBeNull()
  })

  it('scoreFeature: name in text scores higher than token-only', () => {
    const feature = {
      name: '独享带宽订购',
      aliases: '独享带宽',
      description: '订购流程',
      scenarios: [],
      globalRules: [],
    }
    const nameHit = scoreFeature(feature, [], '客户反映独享带宽订购失败')
    const tokenHit = scoreFeature(feature, ['订购'], '无关文本')
    const zero = scoreFeature(feature, ['不命中'], '无关文本')
    expect(nameHit).toBeGreaterThan(tokenHit)
    expect(nameHit).toBe(5)
    expect(tokenHit).toBe(1)
    expect(zero).toBe(0)
  })

  it('retrieveSnippets returns sorted snippets truncated to budget', () => {
    const snippets = retrieveSnippets('eip', '独享带宽订购失败，提示配额不足', ['独享带宽', '订购'], {
      budget: 80,
    })
    expect(snippets.length).toBeGreaterThan(0)
    expect(snippets[0].title).toBe('独享带宽订购')
    expect(snippets[0].productKey).toBe('eip')
    const totalLen = snippets.reduce((n, s) => n + s.content.length, 0)
    expect(totalLen).toBeLessThanOrEqual(80)
  })

  it('retrieveSnippets returns empty when no feature matches', () => {
    expect(retrieveSnippets('eip', '完全不相关的文本', ['不命中'])).toEqual([])
  })

  it('retrieveSnippets returns empty for unknown productKey', () => {
    expect(retrieveSnippets('unknown', '独享带宽', ['独享带宽'])).toEqual([])
  })
})
