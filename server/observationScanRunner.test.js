import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-obs-scan-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-observation-scan'

let sqliteAvailable = false
try {
  const { closeDb, getDb } = await import('./db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch (err) {
  console.warn('[observationScanRunner.test] sqlite probe failed:', err instanceof Error ? err.message : err)
  sqliteAvailable = false
}

describe.skipIf(!sqliteAvailable)('runObservationMatch end-to-end', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
    // 种子托管产品目录（对齐生产形态：带 analysisPostUseRating 标志）
    const { storageRepository } = await import('./storageRepository.js')
    const { loadManagedProductCatalog } = await import('../src/storage/productCatalogStore.js')
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 1,
      products: [
        {
          key: 'eip',
          name: '弹性公网IP',
          enabled: true,
          analysisPostUseRating: true,
          taxonomyKey: 'eip',
          acceptParentName: true,
          specs: [],
        },
      ],
      deletedKeys: [],
      disabledAnalysisKeys: [],
    })
    await loadManagedProductCatalog({
      getMeta: (k) => storageRepository.getMeta(k),
      putMeta: (k, v) => storageRepository.putMeta(k, v),
    })
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  async function repo() {
    return (await import('./observationRepository.js')).observationRepository
  }

  function seedRecord(db, id, overrides = {}) {
    db.prepare(
      `INSERT INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id, ticket_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      JSON.stringify({
        id,
        dataSourceType: 'complaint_ticket',
        product: '弹性公网IP',
        productKey: 'eip',
        painPoint: '退订入口找不到',
        customerRequest: '想退订退不掉',
        ticketId: `T-${id}`,
        importMonth: '2026-10',
        ...overrides,
      }),
      '2026-10',
      overrides.dataSourceType || 'complaint_ticket',
      'local',
      '',
      overrides.ticketId || `T-${id}`,
    )
  }

  it('anchor hit yields high suggestion without LLM; scan skips dismissed combos', async () => {
    const r = await repo()
    const { getDb } = await import('./db.js')
    const db = getDb()

    seedRecord(db, 'scan-rec-1')
    seedRecord(db, 'scan-rating-1', {
      dataSourceType: 'post_use_rating',
      ticketId: '',
      commentText: '折腾半天没搞定',
      lowScoreReason: '服务不好用/操作过于复杂',
      originalTicketId: 'T-scan-rec-1',
      painPoint: undefined,
    })

    // 种子 issue：首条证据 = scan-rec-1（工单）
    const issue = r.putIssue(
      {
        productKey: 'eip',
        productName: '弹性公网IP',
        title: '退订入口难找',
        summary: '控制台找不到退订/取消入口',
        keywords: ['退订'],
      },
      {
        firstLink: { recordId: 'scan-rec-1', recordDataSource: 'complaint_ticket', ticketId: 'T-scan-rec-1' },
        actor: { username: 'seed' },
      },
    )

    const { runObservationMatch } = await import('./observationScanRunner.js')
    const result = await runObservationMatch({
      records: [],
      recordIds: ['scan-rec-1', 'scan-rating-1'],
      settings: {},
      userId: 'u-test',
      username: 'tester',
      touch: () => {},
      cancelled: () => false,
      yieldToEventLoop: async () => {},
    })

    // scan-rec-1 已是 confirmed（种子首条证据）→ putLink 矩阵跳过，不产生新建议
    // scan-rating-1 锚点命中 T-scan-rec-1 → high 直判（无 LLM 配置时也成立）
    expect(result.stats.total).toBeGreaterThanOrEqual(1)
    expect(result.stats.anchorHits).toBe(1)
    expect(result.stats.suggestions).toBe(1)

    const links = r.listLinksByRecord('scan-rating-1')
    const suggestion = links.find((l) => l.linkStatus === 'pending_suggest')
    expect(suggestion).toBeTruthy()
    expect(suggestion?.matchConfidence).toBe('high')
    expect(suggestion?.linkSource).toBe('auto_anchor')
    expect(suggestion?.issueId).toBe(issue.id)

    // 再跑一次：pending 已在（UNIQUE 组合）→ 不重复产生
    const result2 = await runObservationMatch({
      records: [],
      recordIds: ['scan-rating-1'],
      settings: {},
      userId: 'u-test',
      username: 'tester',
      touch: () => {},
      cancelled: () => false,
      yieldToEventLoop: async () => {},
    })
    expect(result2.stats.suggestions).toBe(0)
  })

  it('cancel flag stops scan with cancelled stats', async () => {
    const { getDb } = await import('./db.js')
    const db = getDb()
    for (let i = 0; i < 6; i += 1) seedRecord(db, `scan-cancel-${i}`)
    const { runObservationMatch } = await import('./observationScanRunner.js')
    const result = await runObservationMatch({
      records: [],
      recordIds: ['scan-cancel-0', 'scan-cancel-1', 'scan-cancel-2', 'scan-cancel-3', 'scan-cancel-4', 'scan-cancel-5'],
      settings: {},
      userId: 'u-test',
      username: 'tester',
      touch: () => {},
      cancelled: () => true, // 立即取消
      yieldToEventLoop: async () => {},
    })
    expect(result.stats.cancelled).toBe(true)
  })

  it('records outside catalog or non-negative ratings are excluded from pool', async () => {
    const { getDb } = await import('./db.js')
    const db = getDb()
    seedRecord(db, 'scan-rating-pos', {
      dataSourceType: 'post_use_rating',
      ticketId: '',
      commentText: '挺好的',
      lowScoreReason: '满意',
      originalTicketId: 'T-scan-rec-1',
    })
    const { runObservationMatch } = await import('./observationScanRunner.js')
    const result = await runObservationMatch({
      records: [],
      recordIds: ['scan-rating-pos'],
      settings: {},
      userId: 'u-test',
      username: 'tester',
      touch: () => {},
      cancelled: () => false,
      yieldToEventLoop: async () => {},
    })
    // 满意 = 非实质负面 → 候选池为空（total 0）
    expect(result.stats.total).toBe(0)
    expect(result.stats.suggestions).toBe(0)
  })
})
