import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * G3-4 端到端回归（TASKS 验收）：
 * 种子 gen issues（含 cross_product）→ 识别任务（G-pass 建议 + M-pass 跨产品匹配）
 * → 抽屉采纳（hint adopt）→ 队列三选一（reviewSuggestion）
 * → 计数刷新（refreshAggregates）→ 清单/详情 → CSV 导出。
 *
 * 纪律：先设 AUTH_DATABASE_PATH 再动态 import；真实 API 通路（fastify inject）+ 真实 runner。
 */

const tempDir = mkdtempSync(join(tmpdir(), 'gen-e2e-test-'))
process.env.AUTH_DATABASE_PATH = join(tempDir, 'test.db')

/** @type {import('better-sqlite3').Database} */
let db
/** @type {any} */
let app
/** @type {typeof import('./generalizationRepository.js').generalizationRepository} */
let repo

beforeAll(async () => {
  const businessDb = await import('./businessDb.js')
  const dbModule = await import('./db.js')
  db = dbModule.getDb()
  businessDb.initBusinessSchema()
  const repoModule = await import('./generalizationRepository.js')
  repo = repoModule.generalizationRepository
  const { registerGeneralizationRoutes } = await import('./routes/generalization.js')
  const Fastify = (await import('fastify')).default
  const { FASTIFY_SCHEMA_OPTIONS } = await import('./schemas/common.js')
  app = Fastify({ ...FASTIFY_SCHEMA_OPTIONS })
  app.decorateRequest('user', null)
  app.decorateRequest('apiKey', null)
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'u-e2e', username: 'e2e-admin', role: 'admin' }
  })
  registerGeneralizationRoutes(app)
  await app.ready()
})

afterAll(async () => {
  await app?.close?.()
  rmSync(tempDir, { recursive: true, force: true })
})

/** 注入 LLM mock（judge yes + matcher same）——通过 enrichRunner 的 deps 透传不了路由层，改在 scan 路径注入 transport。 */
// 说明：scan 路由走 runEnrichment（真实 transport 注入链）。端到端 mock LLM 的最小路径：
// monkey-patch llmClient 的 llmChatCompletion（runner 内 judge/matcher 的 deps.llm 缺省时走它）。
/** @type {any} */
let llmMock = null

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
  db.prepare('DELETE FROM records WHERE id = ?').run(id)
  db.prepare('INSERT INTO records (id, payload) VALUES (?, ?)').run(id, payload)
}

describe('G3-4 · 举一反三全链路端到端回归', () => {
  it('链路一：种子 cross_product issue → 新工单 → M-pass 全库跨产品命中 → 队列三选一 confirm → 计数刷新', async () => {
    // 1. 种子：现有 gen issue（跨产品范畴）+ 另一产品的新工单（跨产品召回场景）
    const seeded = repo.putIssue({
      productKey: 'eip',
      productName: '弹性公网IP',
      title: '批量操作部分失败无回滚',
      summary: '批量接口事务未包裹导致部分失败',
      category: 'code_logic',
      scope: 'cross_product',
      keywords: ['批量删除', '部分失败'],
      rootCause: '批量接口事务未包裹',
      optimization: '服务端统一包裹事务并回滚',
    })
    seedRecord('rec-c2', {
      productKey: 'sg', // 不同产品——跨产品召回
      product: '安全组',
      painPoint: '批量删除规则只删了一半就停了',
    })
    // 附已确认证据（供 M-pass 代表性证据）
    seedRecord('rec-seed1')
    repo.putLink({
      issueId: seeded.id,
      recordId: 'rec-seed1',
      recordDataSource: 'complaint_ticket',
      ticketId: 'T-rec-seed1',
      linkStatus: 'confirmed',
      linkSource: 'manual',
      matchConfidence: 'high',
      matchReason: '人工挂接',
      matchedExcerpt: '',
      proposedAt: '',
      reviewedBy: 'e2e-admin',
      reviewedAt: '',
      createdAt: '2026-10-01T00:00:00Z',
    })

    // 2. 直接跑 gen runner 两段（deps mock LLM：G-pass no / M-pass same）
    const { runGeneralizationPass } = await import('./generalizationScanRunner.js')
    await runGeneralizationPass({
      settings: null,
      userId: 'u-e2e',
      username: 'e2e-admin',
      touch: () => {},
      cancelled: () => false,
      yieldToEventLoop: async () => {},
      deps: {
        // 按调用序返回：第 1 次 = G-pass judge（no——已有同类问题在库）；后续 = M-pass matcher（decision: same）
        llm: (() => {
          let call = 0
          return async () => {
            call += 1
            const payload =
              call === 1
                ? { needsGeneralization: 'no', reason: '已有同类问题在库' }
                : { decision: 'same', confidence: 'medium', reason: '同类批量失败问题模式' }
            return { choices: [{ message: { content: JSON.stringify(payload) } }] }
          }
        })(),
      },
    })

    // 3. M-pass 跨产品命中 → pending_suggest + 【跨产品】前缀
    const links = repo.listLinksByRecord('rec-c2')
    expect(links).toHaveLength(1)
    expect(links[0].issueId).toBe(seeded.id)
    expect(links[0].linkStatus).toBe('pending_suggest')
    expect(String(links[0].matchReason)).toContain('跨产品')

    // 4. 队列可见 + pendingCount 计数
    const pending = repo.listPendingSuggestions({ page: 1, pageSize: 10 })
    expect(pending.total).toBeGreaterThanOrEqual(1)
    const matched = pending.suggestions.find((s) => s.recordId === 'rec-c2')
    expect(Boolean(matched)).toBe(true)

    // 5. 三选一 confirm → 计数刷新（refreshAggregates 重算全部 confirmed links：
    //    种子 rec-seed1 + 新确认 rec-c2 = 2；putIssue 返回值 count 未刷为 0 属正常——懒刷新语义）
    expect(seeded.occurrenceCount).toBe(0)
    const reviewed = repo.reviewSuggestion(links[0].id, 'confirm', { actor: { username: 'e2e-admin' } })
    expect(reviewed.action).toBe('confirmed')
    const updated = repo.getIssue(seeded.id)
    expect(updated.occurrenceCount).toBe(2)
    expect(repo.pendingCount().total).toBe(0)
  })

  it('链路二：G-pass 建议落 hint → API 采纳（adopt）建 issue + 首条 confirmed → 横幅计数（hints 字段）', async () => {
    seedRecord('rec-g-e2e')
    // G-pass 直接落 hint（模拟识别完成态——判定逻辑 G2-3 已单测覆盖）
    repo.putHint('rec-g-e2e', {
      status: 'pending',
      suggested: 'yes',
      category: 'console_ux',
      scope: 'multi_scenario',
      confidence: 'medium',
      reason: '控制台退订入口路径过深',
      promptVersion: 'g1',
      suggestedAt: new Date().toISOString(),
    })

    // API 通路：读取 hint（抽屉卡数据源）
    const hintRes = await app.inject({ method: 'GET', url: '/api/generalization/records/rec-g-e2e/hint' })
    expect(hintRes.statusCode).toBe(200)
    expect(hintRes.json().hint.status).toBe('pending')

    // 横幅计数：pendingCount hints 字段
    const before = repo.pendingCount()
    expect(before.hints).toBe(1)
    expect(before.hintsMedium).toBe(1)

    // API 采纳：adopt（建 issue + 首条 confirmed link + 回链）
    const adoptRes = await app.inject({
      method: 'POST',
      url: '/api/generalization/hints/rec-g-e2e/adopt',
    })
    expect(adoptRes.statusCode).toBe(200)
    const adopted = adoptRes.json()
    expect(adopted.hint.status).toBe('adopted')
    expect(adopted.issue.category).toBe('console_ux')
    expect(adopted.issue.occurrenceCount).toBe(1)

    // 首条证据 = 宿主记录 confirmed
    const links = repo.listLinksByIssue(adopted.issue.id)
    expect(links).toHaveLength(1)
    expect(links[0].recordId).toBe('rec-g-e2e')
    expect(links[0].linkStatus).toBe('confirmed')

    // 横幅计数归零（hints 被采纳）
    expect(repo.pendingCount().hints).toBe(0)
  })

  it('链路三：举措升级（from-action API）→ 双向反查 → Tab 清单 → CSV 导出', async () => {
    // 1. 种子举措（带证据：2 投诉/咨询 + 1 评价——过滤验证）
    const actionPayload = JSON.stringify({
      evidenceRecordIds: ['rec-a1', 'rec-a2', 'rec-a3'],
      content: '为批量接口补事务回滚',
      detail: '排查确认事务包裹缺失，已安排开发修复',
    })
    db.prepare('DELETE FROM action_items WHERE id = ?').run('act-e2e')
    db.prepare(
      `INSERT INTO action_items (id, product_key, product_name, status, source, first_proposed_at, schedule_at, warning_level, payload)
       VALUES (?, 'eip', '弹性公网IP', 'in_progress', 'ticket', '2026-11-01', '', 'none', ?)`,
    ).run('act-e2e', actionPayload)
    seedRecord('rec-a1')
    seedRecord('rec-a2')
    seedRecord('rec-a3', { dataSourceType: 'post_use_rating' }) // 评价——应被过滤

    // 2. 升级（API）：optimization 预填、root_cause 空、证据过滤
    const upgradeRes = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: {
        actionItemId: 'act-e2e',
        mode: 'create',
        title: '批量接口事务缺失',
        summary: '批量操作部分失败无回滚',
        category: 'code_logic',
        scope: 'multi_scenario',
      },
    })
    expect(upgradeRes.statusCode).toBe(200)
    const upgraded = upgradeRes.json()
    expect(upgraded.issue.originActionId).toBe('act-e2e')
    expect(upgraded.issue.rootCause).toBe('') // 23:39：不预填
    expect(upgraded.evidenceLinked).toBe(2) // 评价被过滤
    expect(upgraded.issue.occurrenceCount).toBe(2)

    // 3. 409 防重：同举措再次升级被拦
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: {
        actionItemId: 'act-e2e',
        mode: 'create',
        title: 'x',
        summary: 'y',
        category: 'api_doc',
        scope: 'multi_scenario',
      },
    })
    expect(dupRes.statusCode).toBe(409)

    // 4. 双向反查：中间表
    const forAction = repo.listIssuesForAction('act-e2e')
    expect(forAction).toHaveLength(1)
    expect(forAction[0].issueId).toBe(upgraded.issue.id)
    const refs = repo.listActionRefsForIssue(upgraded.issue.id)
    expect(refs).toHaveLength(1)
    expect(refs[0].kind).toBe('created')

    // 5. Tab 清单 API（actionItemId 筛选）
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/generalization/issues?actionItemId=act-e2e',
    })
    expect(listRes.statusCode).toBe(200)
    expect(listRes.json().total).toBe(1)

    // 6. CSV 导出（纯 builder：含升级件的根因/优化/来源举措）
    const { buildGeneralizationIssuesCsv } = await import('../src/lib/generalization/generalizationExportCsv.js')
    const issues = listRes.json().issues
    const { csv, rowCount } = buildGeneralizationIssuesCsv({
      issues,
      linksByIssue: [{ issueId: upgraded.issue.id, links: repo.listLinksByIssue(upgraded.issue.id), actionRefs: refs }],
    })
    expect(rowCount).toBe(1)
    expect(csv).toContain('批量接口事务缺失') // 标题列
    expect(csv).toContain('编码逻辑') // 范畴列（中文标签——对齐状态列本地化）
    expect(csv).toContain('act-e2e') // 来源举措列
    expect(csv).toContain('进行中')
  })

  it('链路四：关闭弹窗语义——纯状态流转豁免必填（terminated 备注可选）+ 终态后再升级放行', async () => {
    // 种子 + 升级件
    db.prepare('DELETE FROM action_items WHERE id = ?').run('act-close')
    db.prepare(
      `INSERT INTO action_items (id, product_key, product_name, status, source, first_proposed_at, schedule_at, warning_level, payload)
       VALUES (?, 'sg', '安全组', 'in_progress', 'ticket', '2026-11-01', '', 'none', ?)`,
    ).run(
      'act-close',
      JSON.stringify({ evidenceRecordIds: [], content: '优化控制台路径', detail: '详情' }),
    )
    const upRes = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: {
        actionItemId: 'act-close',
        mode: 'create',
        title: '控制台路径过深',
        summary: '退订入口翻三页才找到',
        category: 'console_ux',
        scope: 'multi_scenario',
      },
    })
    expect(upRes.statusCode).toBe(200)
    const issueId = upRes.json().issue.id

    // 纯状态流转（root_cause 空）：terminated 放行（豁免必填）
    const closeRes = await app.inject({
      method: 'PATCH',
      url: `/api/generalization/issues/${issueId}`,
      payload: { status: 'terminated', notes: '暂不排查，后续再开' },
    })
    expect(closeRes.statusCode).toBe(200)
    expect(closeRes.json().issue.status).toBe('terminated')

    // 终态后再升级（同举措）放行——开新一轮
    const reUpRes = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: {
        actionItemId: 'act-close',
        mode: 'create',
        title: '控制台路径过深（新一轮）',
        summary: '复查发现同类反馈',
        category: 'console_ux',
        scope: 'multi_scenario',
      },
    })
    expect(reUpRes.statusCode).toBe(200)
    expect(reUpRes.json().issue.id).not.toBe(issueId)
  })
})
