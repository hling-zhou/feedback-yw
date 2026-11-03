import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * G4-1 反馈库三态筛选：listRecords generalizationFilter（先过滤后分页）+ 投影附 generalization flag。
 * 纪律：先设 AUTH_DATABASE_PATH 再动态 import。
 */

const tempDir = mkdtempSync(join(tmpdir(), 'gen-filter-test-'))
process.env.AUTH_DATABASE_PATH = join(tempDir, 'test.db')

/** @type {import('better-sqlite3').Database} */
let db
/** @type {typeof import('./storageRepository.js').storageRepository} */
let storageRepo
/** @type {typeof import('./generalizationRepository.js').generalizationRepository} */
let genRepo

const seedRecord = (id) => {
  const payload = JSON.stringify({
    id,
    ticketId: `T-${id}`,
    dataSourceType: 'complaint_ticket',
    productKey: 'eip',
    product: '弹性公网IP',
    painPoint: '痛点',
    import_month: '2026-10',
  })
  db.prepare('DELETE FROM records WHERE id = ?').run(id)
  db.prepare('INSERT INTO records (id, payload) VALUES (?, ?)').run(id, payload)
}

beforeAll(async () => {
  const businessDb = await import('./businessDb.js')
  const dbModule = await import('./db.js')
  db = dbModule.getDb()
  businessDb.initBusinessSchema()
  storageRepo = (await import('./storageRepository.js')).storageRepository
  genRepo = (await import('./generalizationRepository.js')).generalizationRepository
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  db.prepare('DELETE FROM generalization_issue_action_refs').run()
  db.prepare('DELETE FROM generalization_issue_links').run()
  db.prepare('DELETE FROM generalization_issues').run()
  db.prepare('DELETE FROM generalization_hints').run()
  db.prepare('DELETE FROM records').run()
})

describe('G4-1 listRecords 三态筛选 + 投影 flag', () => {
  it('三态各归其位：linked（confirmed link）/ suggested（hint 未采纳）/ none（均无）', () => {
    seedRecord('rec-linked')
    seedRecord('rec-suggested')
    seedRecord('rec-plain1')
    seedRecord('rec-plain2')

    // rec-linked：建 issue + confirmed link
    const issue = genRepo.putIssue({
      productKey: 'eip', productName: '弹性公网IP',
      title: 't', summary: 's', category: 'code_logic', scope: 'multi_scenario',
    })
    genRepo.putLink({
      issueId: issue.id, recordId: 'rec-linked',
      recordDataSource: 'complaint_ticket', ticketId: 'T-rec-linked',
      linkStatus: 'confirmed', linkSource: 'manual',
      matchConfidence: 'high', matchReason: '人工', matchedExcerpt: '',
      proposedAt: '', reviewedBy: 'u', reviewedAt: '', createdAt: '2026-11-01T00:00:00Z',
    })
    // rec-suggested：只落 pending hint（未采纳）
    genRepo.putHint('rec-suggested', { status: 'pending', suggested: 'yes', confidence: 'medium' })
    // dismissed hint 算 suggested 吗？——TASKS 口径"被建议"= hint 存在（三态：已关联/被建议/均无）；
    // dismissed 是"被建议过但已忽略"——归 suggested（hint 行存在）

    // 三态筛选（先过滤后分页——total 与 records 一致）
    const linked = storageRepo.listRecords({ generalizationFilter: 'linked' })
    expect(linked.total).toBe(1)
    expect(linked.records.map((r) => r.id)).toEqual(['rec-linked'])

    const suggested = storageRepo.listRecords({ generalizationFilter: 'suggested' })
    expect(suggested.total).toBe(1)
    expect(suggested.records.map((r) => r.id)).toEqual(['rec-suggested'])

    const none = storageRepo.listRecords({ generalizationFilter: 'none' })
    expect(none.total).toBe(2)
    expect(none.records.map((r) => r.id).sort()).toEqual(['rec-plain1', 'rec-plain2'].sort())
  })

  it('无筛选时投影附 generalization flag（前端复合筛选消费）', () => {
    seedRecord('rec-f1')
    seedRecord('rec-f2')
    genRepo.putHint('rec-f2', { status: 'pending', suggested: 'yes' })

    const list = storageRepo.listRecords({})
    const byId = new Map(list.records.map((r) => [r.id, r]))
    expect(byId.get('rec-f1').generalization).toBe('none')
    expect(byId.get('rec-f2').generalization).toBe('suggested')
  })

  it('confirmed 优先于 hint（同记录既有 confirmed 又有 hint → linked）', () => {
    seedRecord('rec-both')
    genRepo.putHint('rec-both', { status: 'pending', suggested: 'yes' })
    const issue = genRepo.putIssue({
      productKey: 'eip', productName: '弹性公网IP',
      title: 't2', summary: 's2', category: 'api_doc', scope: 'cross_product',
    })
    genRepo.putLink({
      issueId: issue.id, recordId: 'rec-both',
      recordDataSource: 'complaint_ticket', ticketId: 'T-rec-both',
      linkStatus: 'confirmed', linkSource: 'manual',
      matchConfidence: 'high', matchReason: '人工', matchedExcerpt: '',
      proposedAt: '', reviewedBy: 'u', reviewedAt: '', createdAt: '2026-11-01T00:00:00Z',
    })

    const list = storageRepo.listRecords({})
    expect(list.records.find((r) => r.id === 'rec-both').generalization).toBe('linked')
    // suggested 筛选不含它（confirmed 优先）
    const suggested = storageRepo.listRecords({ generalizationFilter: 'suggested' })
    expect(suggested.total).toBe(0)
  })

  it('非法筛选值忽略（等价无筛选）', () => {
    seedRecord('rec-x')
    const list = storageRepo.listRecords({ generalizationFilter: 'bogus' })
    expect(list.total).toBe(1)
  })

  it('G4-2：hintsOutdated 探测——旧 promptVersion 的 pending 计数', () => {
    seedRecord('rec-o1')
    seedRecord('rec-o2')
    seedRecord('rec-o3')
    genRepo.putHint('rec-o1', { status: 'pending', confidence: 'high', promptVersion: 'g0' }) // 旧版本
    genRepo.putHint('rec-o2', { status: 'pending', confidence: 'medium', promptVersion: 'g1' }) // 当前版本
    genRepo.putHint('rec-o3', { status: 'dismissed', confidence: 'high', promptVersion: 'g0' }) // 旧版本但非 pending——不计
    const breakdown = genRepo.pendingCount()
    expect(breakdown.hints).toBe(2)
    expect(breakdown.hintsOutdated).toBe(1)
  })
})
