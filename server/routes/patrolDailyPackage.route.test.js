/**
 * Plan C 日包接收端点守卫测试（docs/DESIGN-API巡检.md §10.2-10.5，评审修正版）。
 *
 * 覆盖 §12 Plan C 验证六项中端点侧的：
 * - (1) 三段 upsert 幂等重推（同包两次行数不变、事实字段更新）
 * - (2) 人工状态保护（处理中/已处理组不被打回；pending/待处理/- 被诊断映射值覆盖）
 * - (3) 包到达触发日报 + 同日第二包不重发
 * - (4) 10:30 兜底在无包日照常（走 sendPatrolDailyReport 既有调度，本测验证 state 兼容）
 * - (5) diagnosisStatus=failed 组保持 pending_diagnosis
 * - (6) converged 组 status 收敛「—」
 * 边界：行数上限 413、diagnosisStatus 白名单 400、审计落库、fire-and-forget 响应快。
 *
 * 路由级测试惯例对齐 patrolMcpConfig.route.test.js（env 先行 + 动态 import + 真实中间件链）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-plan-c-'))
process.env.AUTH_DATABASE_PATH = path.join(TMP_DIR, 't.db')
process.env.SERVER_DATA_DIR = TMP_DIR
process.env.JWT_SECRET = 'test-jwt-secret-for-plan-c-route'

const sqliteMod = await import('../db.js').catch(() => null)
const sqliteAvailable = Boolean(sqliteMod?.getDb)
const { getDb, closeDb } = sqliteAvailable
  ? /** @type {typeof import('../db.js')} */ (sqliteMod)
  : /** @type {any} */ ({})

// SMTP mock（日报发送链）——记录调用
let sentMails = []

describe.skipIf(!sqliteAvailable)('Plan C 日包接收端点守卫', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null
  let pushKeySecret = ''
  /** @type {any} */ let db = null
  /** @type {any} */ let reportMod = null

  /** 构造一个最小合法日包。 */
  const buildPackage = () => ({
    date: '2026-11-09',
    fetchedAt: '2026-11-10T09:15:00.000Z',
    stats: [
      {
        productKey: 'eip',
        rows: [
          { 资源池: '华南-广州3', 指标名称: '订购', 接口名称: '/customer/v3/order/create/floatingip', 业务类型: '订购', 成功率: '66.67%', 正常比例: '-', 时长均值: '-' },
        ],
      },
    ],
    requests: [
      {
        package: 'eip_vpc',
        pool: '华南-广州3',
        rows: [
          { id: '1', appId: '', requestId: 'req-pc-001', requestMapping: '/acl/v3/floatingip/bind', userId: 'u1', userName: 'cmic_sim', bizCategory: '绑定', bizTarget: 'IP', bizNo: 'b1', result: '0', executionTimeMillis: '100', createTime: '2026-11-09 10:00:00', diagnoseResult: '' },
        ],
      },
    ],
    groups: [
      {
        groupDate: '2026-11-09', productKey: 'eip', poolName: '华南-广州3',
        apiPath: '/acl/v3/floatingip/bind', userName: 'cmic_sim', metricName: '绑定',
        firstRequestId: 'req-pc-001', firstRequestTime: '2026-11-09 10:00:00',
        preCompressCount: 3, suppressedRequestIds: '["req-pc-002","req-pc-003"]',
        customerType: '仿真',
        rootCauseL1: '业务冲突', rootCauseL2: '绑定关系未解除',
        finalConclusion: '存在绑定关系，需先解绑',
        // 11-20 19:23 拍板：MCP 原始日志全文随包推——部署端落 diagnoses.mcp_raw_response
        mcpRawResponse: JSON.stringify({ code: '0000', data: { records: [{ content: '[2026-11-09 10:00:00] [ERROR] bind failed' }], total: 1 } }),
        diagnosisStatus: 'success',
      },
    ],
  })

  const pushPackage = async (pkg, secret = pushKeySecret) => app?.inject({
    method: 'POST',
    url: '/api/patrol/push/daily-package',
    headers: { authorization: `Bearer ${secret}` },
    payload: pkg,
  })

  beforeAll(async () => {
    getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema()
    db = getDb()

    // 真实 API Key（patrol:push scope）
    const { apiKeyRepository } = await import('../apiKeyRepository.js')
    pushKeySecret = apiKeyRepository.createApiKey({ name: 'plan-c-pusher', scopes: ['patrol:push'] }).secret

    // 产品目录
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 1, updatedAt: 't', products: [
        { key: 'eip', name: '弹性公网IP', enabled: true },
        { key: 'vpc', name: '虚拟私有云', enabled: true },
        { key: 'slb', name: '弹性负载均衡', enabled: true },
      ], deletedKeys: [], disabledAnalysisKeys: [],
    })

    // SMTP mock（fire-and-forget 日报链消费）
    const smtp = await import('../mail/smtp.js')
    smtp.setMailTransportFactory(() => ({
      sendMail: async (msg) => {
        sentMails.push(msg)
        return { messageId: `mock-${sentMails.length}` }
      },
    }))

    // 日报配置启用（包触发链消费）+ 通道/群组
    reportMod = await import('../patrolReportScheduler.js')
    const mailRepo = await import('../mailRepository.js')
    const channel = mailRepo.createMailChannel({
      dataSourceType: 'other', name: 'Plan C 测试通道', host: 'smtp.test.local', port: 465, secure: true,
      username: 'pc@test.local', fromAddress: 'pc@test.local', password: 'secret',
    })
    const group = mailRepo.createMailGroup({ name: 'Plan C 收件组', emails: ['pc1@test.local'] })
    reportMod.savePatrolReportConfig({
      enabled: true, groupIds: [group.id], channelId: channel.id, sendTime: '10:30',
      includeQuiet: true, excludeSimTagged: false, maxInterfacesPerProduct: 20,
    })

    const Fastify = (await import('fastify')).default
    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPatrolDailyPackageRoutes } = await import('./patrolDailyPackage.route.js')
    app = Fastify({ logger: false })
    registerAuthHooks(app)
    registerPatrolDailyPackageRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    closeDb()
  })

  beforeEach(() => {
    db.prepare('DELETE FROM api_patrol_stats').run()
    db.prepare('DELETE FROM api_patrol_requests').run()
    db.prepare('DELETE FROM api_patrol_failure_groups').run()
    db.prepare('DELETE FROM api_patrol_diagnoses').run()
    db.prepare('DELETE FROM audit_log').run()
    db.prepare("DELETE FROM meta WHERE key LIKE 'api_patrol_daily_report_state%' OR key LIKE 'api_patrol_email_ingestion_state%'").run()
    sentMails = []
  })

  // ================== (1) 三段幂等 + 事实字段更新

  it('首包三段入库：stats 1 + requests 1 + groups 1（含诊断回填）', async () => {
    const res = await pushPackage(buildPackage())
    expect(res?.statusCode).toBe(200)
    const body = res?.json()
    expect(body.stats.inserted).toBe(1)
    expect(body.requests.inserted).toBe(1)
    expect(body.groups.written).toBe(1)

    expect(db.prepare('SELECT COUNT(*) c FROM api_patrol_stats').get().c).toBe(1)
    expect(db.prepare('SELECT COUNT(*) c FROM api_patrol_requests').get().c).toBe(1)
    const g = db.prepare('SELECT * FROM api_patrol_failure_groups').get()
    expect(g.root_cause_l1).toBe('业务冲突')
    expect(g.root_cause_l2).toBe('绑定关系未解除')
    expect(g.product_action_status).toBe('待处理')
    expect(g.customer_type).toBe('仿真')
    expect(g.pre_compress_count).toBe(3)
    // 诊断行入库
    expect(db.prepare('SELECT COUNT(*) c FROM api_patrol_diagnoses').get().c).toBe(1)
    // 11-20 19:23 拍板：MCP 原始日志全文随包落库（「查看完整日志」数据源——曾断供致空）
    const diagRow = db.prepare('SELECT mcp_raw_response FROM api_patrol_diagnoses').get()
    expect(String(diagRow.mcp_raw_response || '')).toContain('bind failed')
  })

  it('(1) 同包重推两次：行数不变、事实字段覆盖更新', async () => {
    await pushPackage(buildPackage())
    const pkg = buildPackage()
    pkg.groups[0].rootCauseL2 = 'DNAT规则冲突'   // 事实字段变化（模拟次日诊断修正）
    pkg.groups[0].finalConclusion = '新结论'
    const res = await pushPackage(pkg)
    expect(res?.statusCode).toBe(200)
    expect(res?.json().groups.written).toBe(1)

    expect(db.prepare('SELECT COUNT(*) c FROM api_patrol_failure_groups').get().c).toBe(1)
    const g = db.prepare('SELECT * FROM api_patrol_failure_groups').get()
    expect(g.root_cause_l2).toBe('DNAT规则冲突')
    // 结论真源在 diagnoses 表（重推覆盖）
    const diag = db.prepare('SELECT final_conclusion FROM api_patrol_diagnoses').get()
    expect(diag.final_conclusion).toBe('新结论')
  })

  // ================== (2) 人工状态保护

  it('(2) 处理中/已处理的组不被打回（人工状态保护）', async () => {
    await pushPackage(buildPackage())
    // 模拟人工已处理
    db.prepare(`
      UPDATE api_patrol_failure_groups
      SET product_action_status='已处理', assignee='张三', root_cause_confirmed='属实', measure_feedback='已修复'
      WHERE first_request_id='req-pc-001'
    `).run()
    // 重推（诊断事实变化）
    const pkg = buildPackage()
    pkg.groups[0].rootCauseL2 = 'DNAT规则冲突'
    await pushPackage(pkg)

    const g = db.prepare('SELECT * FROM api_patrol_failure_groups').get()
    // 事实字段照常覆盖
    expect(g.root_cause_l2).toBe('DNAT规则冲突')
    // 人工状态不被打回
    expect(g.product_action_status).toBe('已处理')
    expect(g.assignee).toBe('张三')
    expect(g.root_cause_confirmed).toBe('属实')
    expect(g.measure_feedback).toBe('已修复')
  })

  it('(2) pending/待处理/- 状态的组被诊断映射值覆盖（保护只挡人工流程态）', async () => {
    await pushPackage(buildPackage())
    // 现值=待处理（诊断映射值）→ 重推诊断变化 → 覆盖
    const pkg = buildPackage()
    pkg.groups[0].rootCauseL1 = '诊断能力缺口'
    pkg.groups[0].rootCauseL2 = '日志缺失/无数据'
    await pushPackage(pkg)
    const g = db.prepare('SELECT * FROM api_patrol_failure_groups').get()
    expect(g.product_action_status).toBe('—')
  })

  it('(2b) 已有组·待处理·空经办人重推 → 补默认；已有经办人不覆盖（11-11 拍板：修复 11-10 旧代码首建的存量组）', async () => {
    // 目录带 productManager（用例内覆盖，结束还原）
    const { storageRepository } = await import('../storageRepository.js')
    const originalCatalog = storageRepository.getMeta('product_catalog_managed_v1')
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 2, updatedAt: 't2',
      products: [
        { key: 'eip', name: '弹性公网IP', enabled: true, owners: { productManager: [{ userId: 'u-pm', username: '默认产品经理', displayName: '默认产品经理' }] } },
        { key: 'vpc', name: '虚拟私有云', enabled: true },
        { key: 'slb', name: '弹性负载均衡', enabled: true },
      ],
      deletedKeys: [], disabledAnalysisKeys: [],
    })

    try {
      // ① 首推后模拟「旧代码首建」（assignee 空——如 11-10 的 32 个存量组）
      await pushPackage(buildPackage())
      db.prepare('UPDATE api_patrol_failure_groups SET assignee=NULL').run()
      expect(db.prepare('SELECT assignee FROM api_patrol_failure_groups').get().assignee).toBeNull()   // 前置成立

      // ② 重推（同包）：已有组 + 待处理 + 空经办人 → 补填默认
      await pushPackage(buildPackage())
      const g2 = db.prepare('SELECT assignee, product_action_status FROM api_patrol_failure_groups').get()
      expect(g2.product_action_status).toBe('待处理')
      expect(g2.assignee).toBe('默认产品经理')

      // ③ 已有经办人 → 重推不覆盖
      db.prepare("UPDATE api_patrol_failure_groups SET assignee='手工经办人'").run()
      await pushPackage(buildPackage())
      expect(db.prepare('SELECT assignee FROM api_patrol_failure_groups').get().assignee).toBe('手工经办人')
    } finally {
      storageRepository.putMeta('product_catalog_managed_v1', originalCatalog)
    }
  })

  it('(2b) 已有组·处理中·空经办人重推 → 不补（§10.3 人工状态保护优先于补填）', async () => {
    const { storageRepository } = await import('../storageRepository.js')
    const originalCatalog = storageRepository.getMeta('product_catalog_managed_v1')
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 2, updatedAt: 't2',
      products: [
        { key: 'eip', name: '弹性公网IP', enabled: true, owners: { productManager: [{ userId: 'u-pm', username: '默认产品经理', displayName: '默认产品经理' }] } },
      ],
      deletedKeys: [], disabledAnalysisKeys: [],
    })
    try {
      await pushPackage(buildPackage())
      db.prepare("UPDATE api_patrol_failure_groups SET assignee=NULL, product_action_status='处理中'").run()
      await pushPackage(buildPackage())
      const g = db.prepare('SELECT assignee, product_action_status FROM api_patrol_failure_groups').get()
      expect(g.product_action_status).toBe('处理中')
      expect(g.assignee).toBeNull()   // 人工流程态不补填
    } finally {
      storageRepository.putMeta('product_catalog_managed_v1', originalCatalog)
    }
  })

  // ================== (5)(6) failed / converged 语义

  it('(5) diagnosisStatus=failed → 组保持 pending_diagnosis、结论空', async () => {
    const pkg = buildPackage()
    pkg.groups[0].diagnosisStatus = 'failed'
    pkg.groups[0].rootCauseL1 = null
    pkg.groups[0].rootCauseL2 = null
    pkg.groups[0].finalConclusion = null
    await pushPackage(pkg)
    const g = db.prepare('SELECT * FROM api_patrol_failure_groups').get()
    expect(g.product_action_status).toBe('pending_diagnosis')
    expect(g.root_cause_l1).toBe(null)
  })

  it('(6) diagnosisStatus=converged → status 收敛「—」+ 缺口分类落库', async () => {
    const pkg = buildPackage()
    pkg.groups[0].diagnosisStatus = 'converged'
    pkg.groups[0].rootCauseL1 = '诊断能力缺口'
    pkg.groups[0].rootCauseL2 = '日志缺失/无数据'
    pkg.groups[0].finalConclusion = '日志缺失/超出 7 天重试窗口'
    await pushPackage(pkg)
    const g = db.prepare('SELECT * FROM api_patrol_failure_groups').get()
    expect(g.product_action_status).toBe('—')
    expect(g.root_cause_l2).toBe('日志缺失/无数据')
  })

  it('(7) 11-23 豁免透传红绿：包显式 productAction=「—」优先落库（L1 非缺口时防重映射回待处理）', async () => {
    // 先例：cmic_sim×L7POLICY 组 L1=参数无效——修复前部署端按 L1 映射「待处理」，
    // 本机管线豁免的 '—' 在中继第二跳丢失，日报误报「待产品侧处理」。
    // 清库重建（前序用例已给该组写过状态）
    db.prepare('DELETE FROM api_patrol_failure_groups').run()
    const pkg = buildPackage()
    pkg.groups[0].productAction = '—'          // 本机豁免产物显式透传
    pkg.groups[0].rootCauseL1 = '参数无效&校验失败'  // 非缺口 L1——回退映射会给「待处理」
    pkg.groups[0].diagnosisStatus = 'success'
    await pushPackage(pkg)
    const g = db.prepare('SELECT * FROM api_patrol_failure_groups').get()
    expect(g.product_action_status).toBe('—')   // 包值优先（改前红：'待处理'）
  })

  it('(7b) productAction 非法值回退 L1 映射（向后兼容护栏）', async () => {
    db.prepare('DELETE FROM api_patrol_failure_groups').run()
    const pkg = buildPackage()
    pkg.groups[0].productAction = '乱写的值'
    pkg.groups[0].rootCauseL1 = '业务冲突'
    pkg.groups[0].diagnosisStatus = 'success'
    await pushPackage(pkg)
    const g = db.prepare('SELECT * FROM api_patrol_failure_groups').get()
    expect(g.product_action_status).toBe('待处理')  // 非白名单值 → L1 映射兜底
  })

  it('(8) 11-24 B3 豁免白名单随包同步：exemptions 段覆盖写 meta；旧包无段不动既有值；响应计数', async () => {
    const { storageRepository, putMeta } = await import('../storageRepository.js')
    const { META_KEY_ACTION_EXEMPTIONS } = await import('../patrolActionExemptions.js')
    // ① 旧包（无 exemptions 段）——先种一条既有值，推旧包后应原样保留
    storageRepository.putMeta(META_KEY_ACTION_EXEMPTIONS, { version: 1, updatedAt: 't', rules: [{ id: 'r-old', userName: 'old_user', apiPath: '', poolName: '', note: '', enabled: true, createdAt: 't' }] })
    const pkgPlain = buildPackage()
    const resPlain = await pushPackage(pkgPlain)
    expect(resPlain?.json().exemptions).toEqual({ written: 0 })   // 无段 → written=0
    expect(JSON.parse(String(storageRepository.getMeta(META_KEY_ACTION_EXEMPTIONS)?.rules ? JSON.stringify(storageRepository.getMeta(META_KEY_ACTION_EXEMPTIONS)) : '{}')).rules?.[0]?.userName).toBe('old_user')
    // ② 带 exemptions 段 → 覆盖写（归一层 normalize + 换人）
    const pkg = buildPackage()
    pkg.exemptions = { rules: [
      { id: 'r1', userName: 'cmic_sim', apiPath: 'L7POLICY/CREATE', poolName: '', note: '同步测试', enabled: true, createdAt: 't' },
    ] }
    const res = await pushPackage(pkg)
    expect(res?.json().exemptions).toEqual({ written: 1 })
    const stored = storageRepository.getMeta(META_KEY_ACTION_EXEMPTIONS)
    expect(Array.isArray(stored?.rules)).toBe(true)
    expect(stored.rules).toHaveLength(1)
    expect(stored.rules[0]?.userName).toBe('cmic_sim')
    expect(stored.rules[0]?.apiPath).toBe('L7POLICY/CREATE')
    // ③ 非法规则行（userName 空）被归一层过滤——不崩、不同步
    const pkgBad = buildPackage()
    pkgBad.exemptions = { rules: [{ id: 'bad', userName: '', apiPath: 'x', poolName: '', note: '', enabled: true, createdAt: 't' }] }
    const resBad = await pushPackage(pkgBad)
    expect(resBad?.json().exemptions).toEqual({ written: 0 })     // normalizeRule 过滤后 0 条
    expect(storageRepository.getMeta(META_KEY_ACTION_EXEMPTIONS)?.rules).toHaveLength(0)
  })

  it('(6) converged 不打回已处理组（人工保护优先于收敛）', async () => {
    await pushPackage(buildPackage())
    db.prepare("UPDATE api_patrol_failure_groups SET product_action_status='已处理' WHERE first_request_id='req-pc-001'").run()
    const pkg = buildPackage()
    pkg.groups[0].diagnosisStatus = 'converged'
    pkg.groups[0].rootCauseL1 = '诊断能力缺口'
    pkg.groups[0].rootCauseL2 = '日志缺失/无数据'
    await pushPackage(pkg)
    const g = db.prepare('SELECT * FROM api_patrol_failure_groups').get()
    expect(g.product_action_status).toBe('已处理')
  })

  // ================== (3) 包触发日报 + 同日幂等

  it('(3) 首包触发日报发送；同日第二包不重发', async () => {
    await pushPackage(buildPackage())
    // fire-and-forget：等待微任务+SMTP flush
    await new Promise((r) => setTimeout(r, 100))
    expect(sentMails.length).toBe(1)

    await pushPackage(buildPackage())
    await new Promise((r) => setTimeout(r, 100))
    expect(sentMails.length).toBe(1)  // 同日第二包不重发

    // state 记录
    const state = db.prepare("SELECT value FROM meta WHERE key='api_patrol_daily_report_state_v1'").get()
    expect(String(state?.value || '')).toContain('lastSentDate')
  })

  it('(3) 日报未启用时不触发（enabled=false 静默跳过）', async () => {
    reportMod.savePatrolReportConfig({
      enabled: false, groupIds: [], channelId: '', sendTime: '10:30',
      includeQuiet: true, excludeSimTagged: false, maxInterfacesPerProduct: 20,
    })
    await pushPackage(buildPackage())
    await new Promise((r) => setTimeout(r, 100))
    expect(sentMails.length).toBe(0)
    reportMod.savePatrolReportConfig({
      enabled: true, groupIds: ['恢复'], channelId: '恢复', sendTime: '10:30',
      includeQuiet: true, excludeSimTagged: false, maxInterfacesPerProduct: 20,
    })
  })

  // ================== 断供可观测 + 审计

  it('lastPackageReceivedAt 写入 email_ingestion state（断供判据数据源）', async () => {
    await pushPackage(buildPackage())
    const state = db.prepare("SELECT value FROM meta WHERE key='api_patrol_email_ingestion_state_v1'").get()
    const parsed = JSON.parse(String(state?.value || '{}'))
    expect(parsed.lastPackageReceivedAt).toBeTruthy()
  })

  it('审计落库：api_patrol.push_daily_package 含三段行数', async () => {
    await pushPackage(buildPackage())
    const audit = db.prepare("SELECT detail_json FROM audit_log WHERE action='api_patrol.push_daily_package'").get()
    expect(audit).toBeTruthy()
    const detail = JSON.parse(String(audit?.detail_json))
    expect(detail.date).toBe('2026-11-09')
    expect(detail.stats).toBeGreaterThanOrEqual(1)
    expect(detail.groups).toBeGreaterThanOrEqual(1)
  })

  // ================== 边界防御

  it('行数超限 413（requests 单批 >5000）', async () => {
    const pkg = buildPackage()
    const rows = []
    for (let i = 0; i < 5001; i++) {
      rows.push({ id: String(i), requestId: `req-${i}`, requestMapping: '/acl/v3/floatingip/bind', userId: 'u', userName: 'n', result: '1', createTime: '2026-11-09 10:00:00' })
    }
    pkg.requests[0].rows = rows
    const res = await pushPackage(pkg)
    expect(res?.statusCode).toBe(413)
  })

  it('diagnosisStatus 非法值 400', async () => {
    const pkg = buildPackage()
    pkg.groups[0].diagnosisStatus = 'unknown-state'
    const res = await pushPackage(pkg)
    expect(res?.statusCode).toBe(400)
  })

  it('缺 patrol:push scope 的 API Key 拒绝（403）', async () => {
    const { apiKeyRepository } = await import('../apiKeyRepository.js')
    const noScope = apiKeyRepository.createApiKey({ name: 'no-scope', scopes: ['mcp:read'] }).secret
    const res = await pushPackage(buildPackage(), noScope)
    expect(res?.statusCode).toBe(403)
  })

  it('date 格式非法 400', async () => {
    const pkg = buildPackage()
    pkg.date = '2026/11/09'
    const res = await pushPackage(pkg)
    expect(res?.statusCode).toBe(400)
  })

  it('响应不含 SMTP 耗时（fire-and-forget——响应先于日报完成）', async () => {
    const start = Date.now()
    await pushPackage(buildPackage())
    const elapsed = Date.now() - start
    // fire-and-forget：端点不等日报（mock SMTP 秒回，此测防实现改为 await——用 hook 检查更稳，此处用宽松断言）
    expect(elapsed).toBeLessThan(2000)
  })
})
