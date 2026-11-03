import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'

/**
 * 举一反三路由级测试 —— docs/DESIGN-20261102-1.md §4.1 / TASKS G0-5
 * 纪律：先设 AUTH_DATABASE_PATH 再动态 import（db.js 模块顶层算路径）；
 * onRequest 注入 request.user 绕过 requireAdmin。
 */

const tempDir = mkdtempSync(join(tmpdir(), 'gen-routes-test-'))
process.env.AUTH_DATABASE_PATH = join(tempDir, 'test.db')

/** @type {import('fastify').FastifyInstance} */
let app
/** @type {import('better-sqlite3').Database} */
let db
/** @type {typeof import('./generalizationRepository.js').generalizationRepository} */
let repo

beforeAll(async () => {
  process.env.AUTH_DATABASE_PATH = join(tempDir, 'test.db')
  const businessDb = await import('../businessDb.js')
  const dbModule = await import('../db.js')
  db = dbModule.getDb()
  businessDb.initBusinessSchema()
  const repoModule = await import('../generalizationRepository.js')
  repo = repoModule.generalizationRepository

  const { registerGeneralizationRoutes } = await import('./generalization.js')
  const { FASTIFY_SCHEMA_OPTIONS } = await import('../schemas/common.js')
  app = Fastify({ ...FASTIFY_SCHEMA_OPTIONS })
  app.decorateRequest('user', null)
  app.decorateRequest('apiKey', null)
  app.addHook('onRequest', async (request) => {
    request.user = { id: 'u-admin', username: 'admin', role: 'admin' }
  })
  registerGeneralizationRoutes(app)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  rmSync(tempDir, { recursive: true, force: true })
})

const VALID_ISSUE = {
  productKey: 'eip',
  productName: '弹性公网IP',
  title: '退订入口难找',
  summary: '控制台找不到退订入口，列表超 50 条翻不到',
  category: 'console_ux',
  scope: 'multi_scenario',
}

describe('GET/POST /api/generalization/issues', () => {
  it('新建 issue 全链路（audit + similarHints 返回）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generalization/issues',
      payload: VALID_ISSUE,
    })
    if (res.statusCode !== 200) throw new Error(`create failed: ${res.body.slice(0, 300)}`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.issue.id).toBeTruthy()
    expect(body.issue.category).toBe('console_ux')
    expect(Array.isArray(body.similarHints)).toBe(true)
    // audit 落库
    const audits = db
      .prepare(`SELECT action FROM audit_log WHERE action = 'generalization.issue_create'`)
      .all()
    expect(audits.length).toBeGreaterThanOrEqual(1)
  })

  it('非法 body 400（缺 category/scope）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generalization/issues',
      payload: { ...VALID_ISSUE, category: '', scope: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('STRICT 未知字段 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generalization/issues',
      payload: { ...VALID_ISSUE, smuggled: 1 },
    })
    if (res.statusCode !== 400) throw new Error(`STRICT failed: ${res.body.slice(0, 300)}`)
    expect(res.statusCode).toBe(400)
  })

  it('清单 + 筛选（category 反查）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/generalization/issues?category=console_ux&page=1&pageSize=10',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBeGreaterThanOrEqual(1)
    expect(body.issues[0].category).toBe('console_ux')
  })
})

describe('GET/PATCH/DELETE /api/generalization/issues/:id', () => {
  it('详情含 links + actionRefs；PATCH 补全两字段；纯状态流转豁免；删除级联', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/generalization/issues',
      payload: VALID_ISSUE,
    })
    const { issue } = created.json()

    const detail = await app.inject({ method: 'GET', url: `/api/generalization/issues/${issue.id}` })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().actionRefs).toEqual([])

    // PATCH 空值 400（防清空绕过）
    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: `/api/generalization/issues/${issue.id}`,
      payload: { rootCause: '' },
    })
    expect(emptyPatch.statusCode).toBe(400)

    // PATCH 合法补全
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/generalization/issues/${issue.id}`,
      payload: { rootCause: '导航层级过深', optimization: '收口至一级菜单' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().issue.rootCause).toBe('导航层级过深')

    // 纯状态流转（contentPatch 豁免——已补全后关闭）
    const closed = await app.inject({
      method: 'PATCH',
      url: `/api/generalization/issues/${issue.id}`,
      payload: { status: 'completed' },
    })
    expect(closed.statusCode).toBe(200)
    expect(closed.json().issue.status).toBe('completed')

    // 不存在的 404
    const missing = await app.inject({ method: 'GET', url: '/api/generalization/issues/nope' })
    expect(missing.statusCode).toBe(404)

    // 删除
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/generalization/issues/${issue.id}`,
    })
    expect(removed.statusCode).toBe(200)
    expect(removed.json().ok).toBe(true)
  })
})

describe('from-action 升级双模式 + 409 防重', () => {
  it('mode=create：新建 + 证据过滤挂载 + audit；in_progress 409；终态后再升级', async () => {
    // 种子举措（含混合证据：投诉/咨询/评价）
    const { randomId } = await import('../../src/lib/randomId.js')
    const actionId = randomId()
    const recTicket = randomId()
    const recConsult = randomId()
    const recRating = randomId()
    db.prepare(`INSERT INTO records (id, payload) VALUES (?, ?)`).run(
      recTicket,
      JSON.stringify({ id: recTicket, ticketId: 'T1', dataSourceType: 'complaint_ticket' }),
    )
    db.prepare(`INSERT INTO records (id, payload) VALUES (?, ?)`).run(
      recConsult,
      JSON.stringify({ id: recConsult, ticketId: 'T2', dataSourceType: 'consultation_ticket' }),
    )
    db.prepare(`INSERT INTO records (id, payload) VALUES (?, ?)`).run(
      recRating,
      JSON.stringify({ id: recRating, dataSourceType: 'post_use_rating', commentText: '不好用' }),
    )
    db.prepare(
      `INSERT INTO action_items (id, product_key, product_name, status, source, first_proposed_at, schedule_at, warning_level, payload)
       VALUES (?, 'eip', '弹性公网IP', 'in_progress', 'ticket', '2026-11-01', '', 'none', ?)`,
    ).run(
      actionId,
      JSON.stringify({
        id: actionId,
        content: '优化批量删除接口事务',
        evidenceRecordIds: [recTicket, recConsult, recRating],
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: {
        actionItemId: actionId,
        mode: 'create',
        title: '批量删除接口部分失败',
        summary: '批量删除安全组只成功一半',
        category: 'code_logic',
        scope: 'multi_scenario',
        optimization: '包裹事务并回滚部分失败',
      },
    })
    if (res.statusCode !== 200) throw new Error(`from-action failed: ${res.body.slice(0, 300)}`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.issue.originActionId).toBe(actionId)
    expect(body.issue.rootCause).toBe('') // 23:39：不预填
    expect(body.evidenceLinked).toBe(2) // 评价在路由层 collectActionEvidence 被过滤（不进 evidence 数组）
    expect(body.issue.occurrenceCount).toBe(2)

    // 409：in_progress 升级件存在
    const again = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: {
        actionItemId: actionId,
        mode: 'create',
        title: 'B 问题', summary: 's', category: 'api_doc', scope: 'multi_scenario',
      },
    })
    expect(again.statusCode).toBe(409)

    // 终态后再升级（开新一轮——00:07 定稿）
    repo.updateIssue(body.issue.id, { status: 'terminated' })
    const third = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: {
        actionItemId: actionId,
        mode: 'create',
        title: 'C 问题（新一轮）', summary: 's', category: 'api_doc', scope: 'multi_scenario',
      },
    })
    expect(third.statusCode).toBe(200)
    expect(third.json().issue.title).toContain('新一轮')

    // mode=link 缺 issueId → 400
    const linkNoId = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: { actionItemId: actionId, mode: 'link' },
    })
    expect(linkNoId.statusCode).toBe(400)

    // 举措不存在 → 404
    const ghost = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: { actionItemId: 'ghost', mode: 'create', title: 't', summary: 's', category: 'api_doc', scope: 'multi_scenario' },
    })
    expect(ghost.statusCode).toBe(404)

    // from-action audit 落库
    const audits = db
      .prepare(`SELECT action FROM audit_log WHERE action = 'generalization.from_action'`)
      .all()
    expect(audits.length).toBeGreaterThanOrEqual(2)
  })

  it('mode=link：关联已有 in_progress issue + 证据挂载', async () => {
    // 种子 issue + 举措（一条投诉证据）
    const created = await app.inject({
      method: 'POST',
      url: '/api/generalization/issues',
      payload: { ...VALID_ISSUE, title: 'link 模式目标问题' },
    })
    const { issue } = created.json()
    const { randomId } = await import('../../src/lib/randomId.js')
    const actionId = randomId()
    const recId = randomId()
    db.prepare(`INSERT INTO records (id, payload) VALUES (?, ?)`).run(
      recId,
      JSON.stringify({ id: recId, ticketId: 'TL1', dataSourceType: 'complaint_ticket' }),
    )
    db.prepare(
      `INSERT INTO action_items (id, product_key, product_name, status, source, first_proposed_at, schedule_at, warning_level, payload)
       VALUES (?, 'eip', '弹性公网IP', 'in_progress', 'ticket', '2026-11-01', '', 'none', ?)`,
    ).run(
      actionId,
      JSON.stringify({ id: actionId, content: '举措 L', evidenceRecordIds: [recId] }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/generalization/from-action',
      payload: { actionItemId: actionId, mode: 'link', issueId: issue.id },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().evidenceLinked).toBe(1)
    expect(res.json().issue.occurrenceCount).toBe(1)
    // 中间表 kind=linked
    const refs = repo.listIssuesForAction(actionId)
    expect(refs[0].kind).toBe('linked')
    // issue 详情含来源举措（实时解析）
    const detail = await app.inject({ method: 'GET', url: `/api/generalization/issues/${issue.id}` })
    expect(detail.json().actionRefs).toHaveLength(1)
    expect(detail.json().actionRefs[0].actionTitle).toBe('举措 L')
  })
})

describe('hints adopt/dismiss 端点', () => {
  it('adopt：建 issue + 首条 link + adopted 回链；dismiss：忽略记忆', async () => {
    const { randomId } = await import('../../src/lib/randomId.js')
    const recId = randomId()
    db.prepare(`INSERT INTO records (id, payload) VALUES (?, ?)`).run(
      recId,
      JSON.stringify({
        id: recId, ticketId: 'TH1', productKey: 'eip', product: '弹性公网IP',
        dataSourceType: 'complaint_ticket', requestScene: '退订', painPoint: '退订入口找不到',
      }),
    )
    repo.putHint(recId, {
      suggested: 'yes', category: 'console_ux', scope: 'multi_scenario',
      confidence: 'medium', reason: '控制台路径过深', status: 'pending',
    })

    const adopt = await app.inject({
      method: 'POST',
      url: `/api/generalization/hints/${recId}/adopt`,
    })
    expect(adopt.statusCode).toBe(200)
    const adoptBody = adopt.json()
    expect(adoptBody.hint.status).toBe('adopted')
    expect(adoptBody.issue.occurrenceCount).toBe(1)

    // 无 pending 时再 adopt → 400
    const reAdopt = await app.inject({
      method: 'POST',
      url: `/api/generalization/hints/${recId}/adopt`,
    })
    expect(reAdopt.statusCode).toBe(400)

    // dismiss 路径
    const rec2 = randomId()
    db.prepare(`INSERT INTO records (id, payload) VALUES (?, ?)`).run(
      rec2,
      JSON.stringify({ id: rec2, dataSourceType: 'complaint_ticket' }),
    )
    repo.putHint(rec2, { suggested: 'yes', status: 'pending' })
    const dismiss = await app.inject({
      method: 'POST',
      url: `/api/generalization/hints/${rec2}/dismiss`,
    })
    expect(dismiss.statusCode).toBe(200)
    expect(dismiss.json().hint.status).toBe('dismissed')
    expect(repo.getHint(rec2).status).toBe('dismissed')
  })
})

describe('scan 端点（G2-4/G3-3 已接线：后台任务启动）', () => {
  it('启动 observation_match 任务 + generalizationOnly 透传 + taskId 返回 + audit 落库', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generalization/scan',
      payload: { importMonth: '2026-10', generalizationOnly: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.taskId).toBeTruthy()
    expect(body.message).toContain('跳过留观段')
    // audit：scan_start 动作 + taskId/importMonth 主体
    const { getDb } = await import('../db.js')
    const auditRow = getDb()
      .prepare(`SELECT action, detail_json FROM audit_log WHERE action = 'generalization.scan_start' ORDER BY created_at DESC LIMIT 1`)
      .get()
    expect(Boolean(auditRow)).toBe(true)
    const audit = /** @type {any} */ (auditRow)
    expect(JSON.parse(audit.detail_json || '{}').taskId).toBe(body.taskId)
    // 后台异步任务在测试库跑——结果写独立 meta key（轮询断言，容许并行跑时 CPU 竞争）
    for (let i = 0; i < 40; i += 1) {
      const { storageRepository: repo } = await import('../storageRepository.js')
      const result = repo.getMeta('generalization_scan_last_result')
      if (result && /** @type {any} */ (result).finishedAt) break
      await new Promise((r) => setTimeout(r, 250))
    }
    const { storageRepository: repo } = await import('../storageRepository.js')
    const result = repo.getMeta('generalization_scan_last_result')
    expect(Boolean(result)).toBe(true)
    const typed = /** @type {any} */ (result)
    expect(typed.taskId).toBe(body.taskId)
  })

  it('generalizationOnly=false 时消息为两段模式（留观+举一反三）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generalization/scan',
      payload: { importMonth: '2026-10' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().message).toContain('留观与举一反三')
    // 等待后台任务完成释放锁，避免影响后续测试用例
    await new Promise((r) => setTimeout(r, 500))
  })
})

describe('队列 / 搜索 / 记录反查', () => {
  it('pending-count / matches / records search / record links', async () => {
    const count = await app.inject({ method: 'GET', url: '/api/generalization/matches/pending-count' })
    expect(count.statusCode).toBe(200)
    expect(typeof count.json().total).toBe('number')

    const matches = await app.inject({ method: 'GET', url: '/api/generalization/matches?page=1' })
    expect(matches.statusCode).toBe(200)

    // 搜索：种子记录后按 ticket 搜（只搜投诉/咨询域）
    const { randomId } = await import('../../src/lib/randomId.js')
    const recId = randomId()
    db.prepare(`INSERT INTO records (id, payload) VALUES (?, ?)`).run(
      recId,
      JSON.stringify({ id: recId, ticketId: 'SRCH1', dataSourceType: 'complaint_ticket', painPoint: '搜索目标痛点' }),
    )
    const search = await app.inject({
      method: 'GET',
      url: '/api/generalization/records/search?query=SRCH1',
    })
    expect(search.statusCode).toBe(200)
    expect(search.json().records[0].ticketId).toBe('SRCH1')

    // 记录反查 links（空数组也 200）
    const recLinks = await app.inject({
      method: 'GET',
      url: `/api/generalization/records/${recId}/links`,
    })
    expect(recLinks.statusCode).toBe(200)
    expect(recLinks.json().links).toEqual([])

    // hint 读取端点
    const hint = await app.inject({ method: 'GET', url: `/api/generalization/records/${recId}/hint` })
    expect(hint.statusCode).toBe(200)
    expect(hint.json().hint).toBeNull()
  })
})
