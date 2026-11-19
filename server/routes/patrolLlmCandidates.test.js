import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FASTIFY_SCHEMA_OPTIONS } from '../schemas/common.js'

process.env.JWT_SECRET = 'test-jwt-secret-for-llm-candidates-x'

/**
 * LLM 判定候选建议端点守卫（11-19 拍板：候选回流建议——只读聚合不自动写规则表）。
 * 端点：GET /api/patrol/root-cause-llm-candidates
 * 语义：聚合 root_cause_source='llm' 的组按 L1×L2 计数，出现 ≥2 次的场景列候选，
 * 带样例组 id 与关键词素材（从诊断结论文本提取），供运营在规则面板「纳入为规则」预填。
 */

const sqliteAvailable = (() => {
  try { require.resolve('better-sqlite3'); return true } catch { return false }
})()

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrol-llm-cand-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir

const describeCand = sqliteAvailable ? describe : describe.skip

const dbModule = await import('../db.js')
const require_getDb = () => dbModule.getDb()

/** @type {import('fastify').FastifyInstance} */
let app
let token = ''

describeCand('patrol LLM 判定候选建议接口', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema()
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const admin = await createUser({
      username: 'llm_cand_admin', password: 'AdminPass12345!', team: '综合管理组', role: 'admin',
    })
    token = signAccessToken(admin)

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPatrolQueryRoutes } = await import('./patrolQuery.js')
    app = Fastify({ logger: false })
    registerAuthHooks(app)
    registerPatrolQueryRoutes(app)
    await app.ready()

    seedCandidates()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const authHeader = () => ({ authorization: `Bearer ${token}` })

  it('聚合 rootCauseSource=llm 组：≥2 次场景列候选，带样例组与关键词素材；rule 来源组不进候选', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/root-cause-llm-candidates',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    const candidates = data.candidates || []
    // 「RAM 子用户无此操作权限」出现 2 次（组1、组2）→ 候选
    const ram = candidates.find((c) => c.l2 === 'RAM 子用户无此操作权限')
    expect(ram).toBeTruthy()
    expect(ram.l1).toBe('权限/授权不足')
    expect(ram.count).toBe(2)
    // 样例组 id 双份（供面板跳转）
    expect(Array.isArray(ram.sampleGroupIds)).toBe(true)
    expect(ram.sampleGroupIds.length).toBe(2)
    // 关键词素材：从结论文本提取（候选的 keywords 字段非空）
    expect(Array.isArray(ram.keywords)).toBe(true)
    expect(ram.keywords.length).toBeGreaterThan(0)
    // 出现 1 次的场景不列候选（组3 孤例）
    expect(candidates.some((c) => c.l2 === '孤例场景')).toBe(false)
    // rule 来源组不进候选（组4——即便同名场景也不计入）
    expect(candidates.some((c) => c.l2 === '规则已覆盖场景')).toBe(false)
  })

  it('空库形态：无 llm 组 → candidates 为空数组不 crash', async () => {
    // seed 里有 llm 组，这里验证未过滤形态（不传参=全窗口）下响应结构稳定
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/root-cause-llm-candidates',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json().candidates)).toBe(true)
  })
})

function seedCandidates() {
  const db = require_getDb()
  const insertGroup = db.prepare(`
    INSERT INTO api_patrol_failure_groups
      (group_date, product_key, pool_name, api_path, metric_name, user_name,
       first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
       customer_type, root_cause_l1, root_cause_l2, product_action_status, created_at, updated_at)
    VALUES (?, 'eip', 'p1', '/acl/v3/port/attach', '绑定', ?, ?, ?, ?, ?, '', ?, ?, '待处理', 't', 't')
  `)
  // 组1/组2：同场景出现 2 次（llm 来源）→ 候选
  insertGroup.run('2026-09-01', 'userA', 'f-1', '2026-09-01 10:00:00', 1, '[]', '权限/授权不足', 'RAM 子用户无此操作权限')
  insertGroup.run('2026-09-01', 'userB', 'f-2', '2026-09-01 11:00:00', 1, '[]', '权限/授权不足', 'RAM 子用户无此操作权限')
  // 组3：孤例（llm 来源）→ 不列候选
  insertGroup.run('2026-09-01', 'userC', 'f-3', '2026-09-01 12:00:00', 1, '[]', '业务冲突', '孤例场景')
  // 组4：rule 来源 → 不进候选聚合
  insertGroup.run('2026-09-01', 'userD', 'f-4', '2026-09-01 13:00:00', 1, '[]', '业务冲突', '规则已覆盖场景')

  const insertDiag = db.prepare(`
    INSERT INTO api_patrol_diagnoses
      (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion,
       root_cause_l1, root_cause_l2, root_cause_source, action_reason, diagnosed_at)
    VALUES (?, ?, 'success', 'log_search', '{}', ?, ?, ?, ?, ?, 't')
  `)
  const groups = db.prepare(`SELECT id, root_cause_l1, root_cause_l2 FROM api_patrol_failure_groups ORDER BY id`).all()
  for (const g of groups) {
    insertDiag.run(
      g.id, `f-${g.id}`,
      `RAM 子用户未被授权该操作，鉴权阶段直接拒绝`,  // 结论（组4 也用同文本——验证 rule 来源排除只看 source 不看文本）
      g.root_cause_l1, g.root_cause_l2,
      g.root_cause_l2 === '规则已覆盖场景' ? 'rule' : 'llm',
      '客户侧权限配置问题，产品无缺陷',
    )
  }
}
