import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * generalizationScanRunner 端到端单测——TASKS G2-4 验收：
 * 后台任务可跑可取消 → hint 写表；重试不重判已有 hint；降级时跳过。
 * 纪律：先设 AUTH_DATABASE_PATH 再动态 import。
 */

const tempDir = mkdtempSync(join(tmpdir(), 'gen-scan-test-'))
process.env.AUTH_DATABASE_PATH = join(tempDir, 'test.db')

/** @type {import('better-sqlite3').Database} */
let db
/** @type {typeof import('./generalizationRepository.js').generalizationRepository} */
let repo
/** @type {typeof import('./generalizationScanRunner.js').runGeneralizationPass} */
let runGeneralizationPass

beforeAll(async () => {
  process.env.AUTH_DATABASE_PATH = join(tempDir, 'test.db')
  const businessDb = await import('./businessDb.js')
  const dbModule = await import('./db.js')
  db = dbModule.getDb()
  businessDb.initBusinessSchema()
  const repoModule = await import('./generalizationRepository.js')
  repo = repoModule.generalizationRepository
  const runnerModule = await import('./generalizationScanRunner.js')
  runGeneralizationPass = runnerModule.runGeneralizationPass
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

const seedRecord = (id, overrides = {}) => {
  const payload = JSON.stringify({
    id,
    ticketId: `T-${id}`,
    dataSourceType: 'complaint_ticket',
    productKey: 'eip',
    product: '弹性公网IP',
    painPoint: '批量删除安全组只成功一半，报部分失败',
    customerRequest: '想批量删除失败的那些',
    handlingText: '客户反馈问题。处理意见：定位为批量接口事务未包裹、部分失败未回滚，开发已修复。',
    import_month: '2026-10',
    ...overrides,
  })
  db.prepare('INSERT INTO records (id, payload) VALUES (?, ?)').run(id, payload)
}

const seedIssue = (overrides = {}) =>
  repo.putIssue({
    productKey: 'eip',
    productName: '弹性公网IP',
    title: '批量删除接口部分失败',
    summary: '批量操作部分成功无回滚',
    category: 'code_logic',
    scope: 'multi_scenario',
    keywords: ['批量删除'],
    ...overrides,
  })

const makeOpts = (llmJson, overrides = {}) => ({
  settings: null,
  userId: 'u-test',
  username: 'tester',
  touch: () => {},
  cancelled: () => false,
  yieldToEventLoop: async () => {},
  deps: {
    llm: async () => ({
      choices: [{ message: { content: JSON.stringify(llmJson) } }],
    }),
  },
  ...overrides,
})

describe('runGeneralizationPass 端到端', () => {
  it('G-pass：yes 判定落 hint + M-pass：keywords 命中 → pending_suggest（全流程）', async () => {
    const rec1 = 'rec-g1'
    const rec2 = 'rec-m1'
    seedRecord(rec1)
    seedRecord(rec2)
    seedIssue() // M-pass 目标 issue（keywords 批量删除）

    // LLM 统一返回：G-pass 判 yes / M-pass 判 same（同一 mock 按调用序都覆盖）
    const result = await runGeneralizationPass(
      makeOpts({ needsGeneralization: 'yes', category: 'code_logic', scope: 'multi_scenario', confidence: 'medium', reason: '事务未包裹同类缺陷' }),
    )

    // G-pass：hint 落库
    expect(result.stats.gPassHints).toBe(2)
    const hint1 = repo.getHint(rec1)
    expect(hint1).toMatchObject({ status: 'pending', category: 'code_logic', promptVersion: 'g1' })

    // M-pass：keywords 命中 → LLM same → pending_suggest
    expect(result.stats.suggestions).toBe(2)
    const links = repo.listLinksByRecord(rec1)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ linkStatus: 'pending_suggest', matchConfidence: 'medium' })
    expect(result.stats.processed).toBe(2)
  })

  it('重试不重判：三态 hint 跳过；gPassRetry 只重判 pending（G4-2 人工决策不覆盖）', async () => {
    const rec = 'rec-skip'
    seedRecord(rec)
    repo.putHint(rec, { status: 'dismissed', reason: '旧建议', promptVersion: 'g0' })

    let llmCalled = 0
    const result = await runGeneralizationPass(
      makeOpts({ needsGeneralization: 'yes', category: 'api_doc', scope: 'multi_scenario', confidence: 'high', reason: 'r' }, {
        deps: {
          llm: async () => {
            llmCalled += 1
            return {
              choices: [{ message: { content: JSON.stringify({ needsGeneralization: 'yes', category: 'api_doc', scope: 'multi_scenario', confidence: 'high', reason: 'r' }) } }],
            }
          },
        },
      }),
    )
    // dismissed hint 存在 → G-pass 跳过（llmCalled 只计 M-pass；无 issue 时为 0）
    expect(result.stats.gPassSkipped).toBe(1)
    expect(result.stats.gPassHints).toBe(0)
    expect(repo.getHint(rec).status).toBe('dismissed') // 未被覆盖

    // gPassRetry=true：人工决策态（dismissed）不覆盖——G4-2 语义收紧
    const result2 = await runGeneralizationPass(
      makeOpts(null, {
        gPassRetry: true,
        deps: {
          llm: async () => ({
            choices: [{ message: { content: JSON.stringify({ needsGeneralization: 'yes', category: 'console_ux', scope: 'multi_scenario', confidence: 'medium', reason: '重判' }) } }],
          }),
        },
      }),
    )
    expect(result2.stats.gPassHints).toBe(0)
    expect(repo.getHint(rec).status).toBe('dismissed') // 仍不被覆盖
    void llmCalled
  })

  it('G4-2：gPassRetry 重判 pending（含旧版本 outdated 计数）', async () => {
    const rec1 = 'rec-pending-old'
    const rec2 = 'rec-pending-cur'
    seedRecord(rec1)
    seedRecord(rec2)
    // rec1：旧版本 pending（promptVersion 过时——outdated 探测应计数）
    repo.putHint(rec1, { status: 'pending', suggested: 'yes', category: 'api_doc', confidence: 'medium', promptVersion: 'g0' })
    // rec2：当前版本 pending
    repo.putHint(rec2, { status: 'pending', suggested: 'yes', category: 'code_logic', confidence: 'high', promptVersion: 'g1' })

    const result = await runGeneralizationPass(
      makeOpts(null, {
        gPassRetry: true,
        deps: {
          llm: async () => ({
            choices: [{ message: { content: JSON.stringify({ needsGeneralization: 'yes', category: 'console_ux', scope: 'multi_scenario', confidence: 'medium', reason: '重判' }) } }],
          }),
        },
      }),
    )
    // 无 gPassRetry 时两态 pending 均跳过；gPassRetry=true 重判 → 两 hint 被覆盖为新判定
    expect(result.stats.gPassHints).toBe(2)
    expect(result.stats.gPassOutdated).toBe(1) // 旧版本 pending 计 outdated
    expect(repo.getHint(rec1).category).toBe('console_ux')
    expect(repo.getHint(rec1).promptVersion).toBe('g1') // 刷新为当前版本
    expect(repo.getHint(rec2).category).toBe('console_ux')
  })

  it('已确认关联 in_progress issue 的记录：G-pass 跳过（建议冗余）', async () => {
    const rec = 'rec-linked'
    seedRecord(rec)
    const issue = seedIssue()
    repo.putLink({
      id: 'l-seed', issueId: issue.id, recordId: rec,
      recordDataSource: 'complaint_ticket', ticketId: `T-${rec}`,
      linkStatus: 'confirmed', linkSource: 'manual',
      matchConfidence: '', matchReason: '', matchedExcerpt: '',
      proposedAt: '', reviewedBy: '', reviewedAt: '', createdAt: '2026-11-01T00:00:00Z',
    })

    const result = await runGeneralizationPass(
      makeOpts({ needsGeneralization: 'yes', category: 'code_logic', scope: 'multi_scenario', confidence: 'high', reason: 'r' }),
    )
    expect(result.stats.gPassSkipped).toBe(1)
    expect(result.stats.gPassHints).toBe(0)
    expect(repo.getHint(rec)).toBeNull()
  })

  it('取消协作：cancelled=true 中途退出', async () => {
    seedRecord('rec-cancel')
    const result = await runGeneralizationPass(
      makeOpts({ needsGeneralization: 'yes', category: 'api_doc', scope: 'multi_scenario', confidence: 'high', reason: 'r' }, {
        cancelled: () => true,
      }),
    )
    expect(result.stats.cancelled).toBe(true)
    expect(result.warnings.some((w) => w.includes('取消'))).toBe(true)
  })

  it('LLM 异常：G-pass 静默跳过（judgeGeneralizationForRecord 内建）+ M-pass matcher 内建降级字面判别', async () => {
    const rec = 'rec-degrade'
    seedRecord(rec)
    seedIssue({ keywords: ['批量删除'] })

    const result = await runGeneralizationPass(
      makeOpts(null, {
        deps: {
          llm: async () => {
            throw new Error('llm down')
          },
        },
      }),
    )
    // G-pass：judge 内建静默 → 无 hint
    expect(result.stats.gPassHints).toBe(0)
    // M-pass：matcher 内建降级（LLM 异常 → 字面/关键词评分，不出 high）
    expect(result.stats.suggestions).toBe(1)
    const links = repo.listLinksByRecord(rec)
    expect(links[0].matchReason).toContain('降级判别')
    expect(links[0].matchConfidence).not.toBe('high')
  })

  it('跨产品命中：issue 产品 ≠ 记录产品照样 M-pass 建议且计数', async () => {
    const rec = 'rec-cross'
    seedRecord(rec)
    seedIssue({ productKey: 'vpn', productName: 'VPN 网关', keywords: ['批量删除'] })

    // M-pass LLM 返回 same（G-pass 返回 no——同 mock 双用）
    const result = await runGeneralizationPass(
      makeOpts({ needsGeneralization: 'no', decision: 'same', confidence: 'medium', reason: '各产品批量接口同缺回滚' }),
    )
    expect(result.stats.suggestions).toBe(1)
    expect(result.stats.crossProductMatches).toBe(1)
    const links = repo.listLinksByRecord(rec)
    expect(links[0].matchReason).toContain('【跨产品】')
  })

  it('无 issue / 无记录：空跑不报错', async () => {
    const result = await runGeneralizationPass(makeOpts(null))
    expect(result.stats.total).toBe(0)
    expect(result.warnings).toEqual([])
  })
})
