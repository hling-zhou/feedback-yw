/**
 * Plan B 邮件拉取导入测试用例（docs/DESIGN-API巡检.md §9，实现前先红）。
 *
 * 覆盖矩阵：
 * - §9.3 流程六段每一段（IMAP 搜索/白名单/MIME 解析/交叉校验/直调写入/状态更新）
 * - §9.4 八项缺陷修正（P0-1~P0-4、P1-5a/5b、P1-6、P2-8）
 * - §11 Plan B 额外验证纪律五项
 * - TDD 红绿证明：本文件在实现前先写，运行应全红（模块不存在）；
 *   实现后逐条变绿。测试资产防作弊：断言不对齐实现让步。
 *
 * 真实链路原则：
 * - SQLite 真库（临时库 initBusinessSchema，同 patrolE2E 惯例）
 * - 邮件 = 真实 MIME 源码字符串（multipart/mixed + HTML 正文 + base64 ZIP 附件），
 *   走真实 mailparser 解析链——不用 mock 解析器
 * - ZIP = jszip 真实构造（内容 CSV 真实样例列形态）
 * - IMAP 传输层 mock（注入点：setImapClientFactory，同 setMailTransportFactory 先例）
 *
 * 运行：npx vitest run server/patrolEmailIngestion.test.js --config vitest.tmp.config.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-email-'))
process.env.AUTH_DATABASE_PATH = path.join(TMP_DIR, 't.db')
process.env.SERVER_DATA_DIR = TMP_DIR
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-email'
process.env.PATROL_EMAIL_AUTH_CODE = 'test-auth-code-123'

const sqliteMod = await import('./db.js').catch(() => null)
const sqliteAvailable = Boolean(sqliteMod?.getDb)
const { getDb, closeDb } = sqliteAvailable
  ? /** @type {typeof import('./db.js')} */ (sqliteMod)
  : /** @type {any} */ ({})

// ---------------------------------------------------------------- helpers

/** 构造一封完整巡检邮件的 MIME 源码（真实形态对拍 §9.2 契约）。 */
async function buildPatrolEmailMime({
  from = 'service@cmecloud.cn',
  to = 'zhouhuiling@cmss.chinamobile.com',
  subject = '【API巡检报告】【11月8日】发现 3 款产品，共 5 条接口异常记录',
  dataDate = '2026-11-07',
  html,
  zips = [],
}) {
  const boundary = '----patrol-test-boundary'
  const parts = []
  parts.push(`From: ${from}`)
  parts.push(`To: ${to}`)
  parts.push(`Subject: ${subject}`)
  parts.push('MIME-Version: 1.0')
  parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
  parts.push('')
  parts.push('--' + boundary)
  parts.push('Content-Type: text/html; charset=utf-8')
  parts.push('Content-Transfer-Encoding: base64')
  parts.push('')
  parts.push(Buffer.from(html, 'utf-8').toString('base64'))
  for (const z of zips) {
    parts.push('--' + boundary)
    parts.push(`Content-Type: application/zip; name="${z.filename}"`)
    parts.push(`Content-Disposition: attachment; filename="${z.filename}"`)
    parts.push('Content-Transfer-Encoding: base64')
    parts.push('')
    parts.push(z.base64)
  }
  parts.push('--' + boundary + '--')
  return parts.join('\r\n')
}

/** 真实 HTML 正文（📦 产品：分块 + 7 列统计表——样例列形态）。 */
function buildHtmlBody({ dataDate, products }) {
  const blocks = []
  if (dataDate) blocks.push(`<p>数据日期：${dataDate}</p>`)
  for (const p of products) {
    blocks.push(`<h3>📦 产品：${p.name}</h3>`)
    const rows = p.rows.map((r) => `<tr><td>${r['资源池']}</td><td>${r['指标名称']}</td><td>${r['接口名称']}</td><td>${r['业务类型']}</td><td>${r['成功率']}</td><td>${r['正常比例']}</td><td>${r['时长均值']}</td></tr>`).join('')
    blocks.push(`<table><tr><th>资源池</th><th>指标名称</th><th>接口名称</th><th>业务类型</th><th>成功率</th><th>正常比例</th><th>时长均值</th></tr>${rows}</table>`)
  }
  return `<html><body>${blocks.join('\n')}</body></html>`
}

/** 构造真实 ZIP（内含 CSV，列形态对拍样例明细）。 */
async function buildZip({ csvs }) {
  const zip = new JSZip()
  for (const c of csvs) zip.file(c.filename, c.content)
  const buf = await zip.generateAsync({ type: 'base64' })
  return buf
}

/** EIP/VPC 明细 CSV（13 列，样例列头）。 */
const EIP_CSV_HEADER = 'id,appId,requestId,requestMapping,userId,userName,bizCategory,bizTarget,bizNo,result,executionTimeMillis,createTime,diagnoseResult'
/** ELB 明细 CSV（14 列，样例列头）。 */
const ELB_CSV_HEADER = 'id,requestId,userId,resourceType,resourceOperation,startTime,endTime,resultStatus,errorMessage,dailyReport,realtimeReport,userName,executionTimeMillis,diagnoseResult'

function eipCsvRows(rows) {
  return [EIP_CSV_HEADER, ...rows].join('\n')
}
function elbCsvRows(rows) {
  return [ELB_CSV_HEADER, ...rows].join('\n')
}

/** mock IMAP 客户端工厂注入（setImapClientFactory 先例对齐 setMailTransportFactory）。 */
function makeImapClientFactory(messages) {
  return () => ({
    connect: async () => {},
    disconnect: async () => {},
    /** search 返回原始邮件源码数组（imapflow search uid → fetch source 双步合一简化）。 */
    searchAndFetch: async () => messages.map((m) => ({ raw: m, receivedAt: new Date() })),
  })
}

// ---------------------------------------------------------------- tests

describe.skipIf(!sqliteAvailable)('Plan B 邮件拉取导入（§9 全链路守卫）', () => {
  /** @type {any} */ let db = null
  /** @type {any} */ let mod = null
  /** @type {any} */ let restoreImap = null

  beforeAll(async () => {
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
    db = getDb()
    mod = await import('./patrolEmailIngestion.js')
    // 产品目录（stats 产品名映射）
    const { storageRepository } = await import('./storageRepository.js')
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 1, updatedAt: 't', products: [
        { key: 'eip', name: '弹性公网IP', enabled: true },
        { key: 'vpc', name: '虚拟私有云', enabled: true },
        { key: 'slb', name: '弹性负载均衡', enabled: true },
      ], deletedKeys: [], disabledAnalysisKeys: [],
    })
  })

  afterAll(() => {
    restoreImap?.()
    closeDb()
  })

  beforeEach(() => {
    db.prepare('DELETE FROM api_patrol_stats').run()
    db.prepare('DELETE FROM api_patrol_requests').run()
    db.prepare('DELETE FROM api_patrol_failure_groups').run()
    db.prepare('DELETE FROM audit_log').run()
    db.prepare("DELETE FROM meta WHERE key LIKE 'api_patrol_email%'").run()
  })

  // =============================================== P0-1 发件人白名单

  describe('P0-1 发件人白名单', () => {
    it('白名单外发件人 → 丢弃 + 审计告警 sender_rejected + 不写库', async () => {
      const mime = await buildPatrolEmailMime({
        from: 'attacker@evil.com',
        html: buildHtmlBody({ products: [{ name: '弹性公网IP', rows: [{ 资源池: '华南-广州3', 指标名称: '订购', 接口名称: '/customer/v3/order/create/floatingip', 业务类型: '订购', 成功率: '88.89%', 正常比例: '-', 时长均值: '-' }] }] }),
        zips: [],
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })

      expect(result.lastResult).toBe('sender_rejected')
      const stats = db.prepare('SELECT COUNT(*) c FROM api_patrol_stats').get()
      expect(stats.c).toBe(0)
      const rejected = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='api_patrol.email_ingestion_sender_rejected'").get()
      expect(rejected.c).toBe(1)
    })

    it('显示名伪装（friendly name 白名单地址 + 恶意 envelope from）→ 拒绝', async () => {
      const mime = await buildPatrolEmailMime({
        from: '"API巡检" <attacker@evil.com>',
        html: buildHtmlBody({ products: [] }),
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(result.lastResult).toBe('sender_rejected')
    })
  })

  // =============================================== P0-3 同日多封/无邮件

  describe('P0-3 同日多封与无邮件', () => {
    it('同日两封 → 取 Received 最新一封', async () => {
      const oldMime = await buildPatrolEmailMime({
        subject: '【API巡检报告】【11月8日】发现 1 款产品，共 1 条接口异常记录',
        html: buildHtmlBody({ products: [{ name: '弹性公网IP', rows: [{ 资源池: '华南-广州3', 指标名称: '订购', 接口名称: '/customer/v3/order/create/floatingip', 业务类型: '订购', 成功率: '88.89%', 正常比例: '-', 时长均值: '-' }] }] }),
      })
      const newMime = await buildPatrolEmailMime({
        subject: '【API巡检报告】【11月8日】发现 2 款产品，共 2 条接口异常记录',
        html: buildHtmlBody({ products: [
          { name: '弹性公网IP', rows: [{ 资源池: '华南-广州3', 指标名称: '订购', 接口名称: '/customer/v3/order/create/floatingip', 业务类型: '订购', 成功率: '88.89%', 正常比例: '-', 时长均值: '-' }] },
          { name: '虚拟私有云', rows: [{ 资源池: '华北-北京3', 指标名称: '创建子网', 接口名称: '/customer/v3/network', 业务类型: '新增', 成功率: '96.72%', 正常比例: '-', 时长均值: '-' }] },
        ] }),
        zips: [],
      })
      // receivedAt 顺序模拟：数组顺序=时间升序，新邮件在后
      const factory = () => ({
        connect: async () => {},
        searchAndFetch: async () => [
          { raw: oldMime, receivedAt: new Date('2026-11-08T08:00:00') },
          { raw: newMime, receivedAt: new Date('2026-11-08T09:00:00') },
        ],
      })
      mod.setImapClientFactory(factory)
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })

      expect(result.lastResult).toBe('success')
      // 入库以最新邮件为准：2 产品 2 行
      const stats = db.prepare('SELECT COUNT(*) c FROM api_patrol_stats').get()
      expect(stats.c).toBe(2)
    })

    it('当日无邮件 → no_email（非 error）+ info 级审计', async () => {
      mod.setImapClientFactory(makeImapClientFactory([]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(result.lastResult).toBe('no_email')
      const noEmail = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='api_patrol.email_ingestion_no_email'").get()
      expect(noEmail.c).toBe(1)
    })
  })

  // =============================================== 正常全链路 + P0-4 直调写入

  describe('正常全链路（stats + requests 直调写入）', () => {
    it('完整邮件 → stats 2 行 + requests 入库 + 唯一键 upsert 幂等', async () => {
      const eipCsv = eipCsvRows([
        '1,,req-001,/acl/v3/floatingip/bind,u1,cmic_sim,绑定,IP,b1,0,100,2026-11-07 10:00:00,',
        '2,,req-002,/customer/v3/order/create/floatingip,u2,real_user,订购,IP,b2,0,200,2026-11-07 11:00:00,',
        '3,,req-003,/customer/v3/order/create/floatingip,u2,real_user,订购,IP,b3,1,300,2026-11-07 12:00:00,',
      ])
      const zipBase64 = await buildZip({ csvs: [{ filename: '弹性公网IP_虚拟私有云/华南-广州3_2026-11-07.csv', content: eipCsv }] })
      const mime = await buildPatrolEmailMime({
        html: buildHtmlBody({ dataDate: '2026-11-07', products: [
          { name: '弹性公网IP', rows: [
            { 资源池: '华南-广州3', 指标名称: '绑定', 接口名称: '/acl/v3/floatingip/bind', 业务类型: '绑定', 成功率: '96.72%', 正常比例: '-', 时长均值: '-' },
            { 资源池: '华南-广州3', 指标名称: '订购', 接口名称: '/customer/v3/order/create/floatingip', 业务类型: '订购', 成功率: '66.67%', 正常比例: '-', 时长均值: '-' },
          ] },
        ] }),
        zips: [{ filename: 'EIP_VPC_2026-11-07.zip', base64: zipBase64 }],
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })

      expect(result.lastResult).toBe('success')
      const stats = db.prepare('SELECT COUNT(*) c FROM api_patrol_stats').get()
      expect(stats.c).toBe(2)
      const requests = db.prepare('SELECT COUNT(*) c FROM api_patrol_requests').get()
      expect(requests.c).toBe(3)
      const eip1 = db.prepare("SELECT * FROM api_patrol_requests WHERE request_id='req-001'").get()
      expect(eip1.is_success).toBe(0)
      expect(eip1.pool_name).toBe('华南-广州3')
      expect(eip1.product_key).toBe('eip')

      // 幂等：同邮件再拉一次，行数不变
      const result2 = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(result2.lastResult).toBe('success')
      const requests2 = db.prepare('SELECT COUNT(*) c FROM api_patrol_requests').get()
      expect(requests2.c).toBe(3)
    })

    it('P0-4：拉取路径不经过 HTTP 层（无 API Key 签发/传递）', async () => {
      const mime = await buildPatrolEmailMime({
        html: buildHtmlBody({ products: [] }),
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      // 模块内不得引用 apiKeyRepository（静态断言——进程内直调，非 HTTP 回路）
      const src = fs.readFileSync(path.join(process.cwd(), 'server', 'patrolEmailIngestion.js'), 'utf-8')
      expect(src).not.toMatch(/apiKeyRepository|patrol:push|fetch\(|http\.request/)
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(result.lastResult).toBe('success')
    })
  })

  // =============================================== P0-2 交叉校验

  describe('P0-2 HTML-vs-CSV 交叉校验', () => {
    it('成功率偏差 >0.05pp → 审计告警 + 不阻断写入（以 CSV 为准）', async () => {
      const eipCsv = eipCsvRows([
        '1,,req-001,/customer/v3/order/create/floatingip,u2,real_user,订购,IP,b1,0,100,2026-11-07 10:00:00,',
        '2,,req-002,/customer/v3/order/create/floatingip,u2,real_user,订购,IP,b2,0,200,2026-11-07 11:00:00,',
        '3,,req-003,/customer/v3/order/create/floatingip,u2,real_user,订购,IP,b3,1,300,2026-11-07 12:00:00,',
      ])
      // CSV 真值：1/3 成功 = 33.33%；HTML 谎报 88.89% → 偏差 55.56pp > 0.05pp
      const zipBase64 = await buildZip({ csvs: [{ filename: '华南-广州3_2026-11-07.csv', content: eipCsv }] })
      const mime = await buildPatrolEmailMime({
        html: buildHtmlBody({ dataDate: '2026-11-07', products: [
          { name: '弹性公网IP', rows: [
            { 资源池: '华南-广州3', 指标名称: '订购', 接口名称: '/customer/v3/order/create/floatingip', 业务类型: '订购', 成功率: '88.89%', 正常比例: '-', 时长均值: '-' },
          ] },
        ] }),
        zips: [{ filename: 'EIP_VPC_2026-11-07.zip', base64: zipBase64 }],
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })

      // 不阻断：仍成功入库
      expect(result.lastResult).toBe('success')
      // 告警落审计
      const warned = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='api_patrol.email_ingestion_cross_validation_mismatch'").get()
      expect(warned.c).toBe(1)
    })

    it('偏差 ≤0.05pp → 无告警', async () => {
      const eipCsv = eipCsvRows([
        '1,,req-001,/customer/v3/order/create/floatingip,u2,real_user,订购,IP,b1,0,100,2026-11-07 10:00:00,',
        '2,,req-002,/customer/v3/order/create/floatingip,u2,real_user,订购,IP,b2,0,200,2026-11-07 11:00:00,',
        '3,,req-003,/customer/v3/order/create/floatingip,u2,real_user,订购,IP,b3,1,300,2026-11-07 12:00:00,',
      ])
      // CSV 真值 33.33%，HTML 报 33.30% → 差 0.03pp ≤ 0.05pp → 不告警
      const zipBase64 = await buildZip({ csvs: [{ filename: '华南-广州3_2026-11-07.csv', content: eipCsv }] })
      const mime = await buildPatrolEmailMime({
        html: buildHtmlBody({ dataDate: '2026-11-07', products: [
          { name: '弹性公网IP', rows: [
            { 资源池: '华南-广州3', 指标名称: '订购', 接口名称: '/customer/v3/order/create/floatingip', 业务类型: '订购', 成功率: '33.30%', 正常比例: '-', 时长均值: '-' },
          ] },
        ] }),
        zips: [{ filename: 'EIP_VPC_2026-11-07.zip', base64: zipBase64 }],
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      const warned = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='api_patrol.email_ingestion_cross_validation_mismatch'").get()
      expect(warned.c).toBe(0)
    })
  })

  // =============================================== P1-5a HTML 解析兜底

  describe('P1-5a HTML 产品分块解析', () => {
    it('主力路径：📦 emoji 标记切分多产品段', async () => {
      const html = buildHtmlBody({ dataDate: '2026-11-07', products: [
        { name: '弹性公网IP', rows: [{ 资源池: '华南-广州3', 指标名称: '订购', 接口名称: '/customer/v3/order/create/floatingip', 业务类型: '订购', 成功率: '88.89%', 正常比例: '-', 时长均值: '-' }] },
        { name: '虚拟私有云', rows: [{ 资源池: '华北-北京3', 指标名称: '创建子网', 接口名称: '/customer/v3/network', 业务类型: '新增', 成功率: '96.72%', 正常比例: '-', 时长均值: '-' }] },
      ] })
      const mime = await buildPatrolEmailMime({ html, zips: [] })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(result.lastResult).toBe('success')
      const stats = db.prepare('SELECT COUNT(*) c FROM api_patrol_stats').get()
      expect(stats.c).toBe(2)
      const vpc = db.prepare("SELECT * FROM api_patrol_stats WHERE product_key='vpc'").get()
      expect(vpc.metric_name).toBe('创建子网')
    })

    it('兜底路径：emoji 标记缺失 → 表头正则定位 + 产品名回溯', async () => {
      const html = `<html><body><p>数据日期：2026-11-07</p>
        <h3>弹性公网IP</h3>
        <table><tr><th>资源池</th><th>指标名称</th><th>接口名称</th><th>业务类型</th><th>成功率</th><th>正常比例</th><th>时长均值</th></tr>
        <tr><td>华南-广州3</td><td>订购</td><td>/customer/v3/order/create/floatingip</td><td>订购</td><td>88.89%</td><td>-</td><td>-</td></tr></table>
        <h3>虚拟私有云</h3>
        <table><tr><th>资源池</th><th>指标名称</th><th>接口名称</th><th>业务类型</th><th>成功率</th><th>正常比例</th><th>时长均值</th></tr>
        <tr><td>华北-北京3</td><td>创建子网</td><td>/customer/v3/network</td><td>新增</td><td>96.72%</td><td>-</td><td>-</td></tr></table>
        </body></html>`
      const mime = await buildPatrolEmailMime({ html, zips: [] })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(result.lastResult).toBe('success')
      const stats = db.prepare('SELECT COUNT(*) c FROM api_patrol_stats').get()
      expect(stats.c).toBe(2)
    })

    it('双路失败段跳过不阻断（单产品段解析失败不影响其他产品）', async () => {
      const html = `<html><body><p>数据日期：2026-11-07</p>
        <h3>📦 产品：弹性公网IP</h3>
        <table><tr><th>资源池</th>...坏表格无行...</table>
        <h3>📦 产品：虚拟私有云</h3>
        <table><tr><th>资源池</th><th>指标名称</th><th>接口名称</th><th>业务类型</th><th>成功率</th><th>正常比例</th><th>时长均值</th></tr>
        <tr><td>华北-北京3</td><td>创建子网</td><td>/customer/v3/network</td><td>新增</td><td>96.72%</td><td>-</td><td>-</td></tr></table>
        </body></html>`
      const mime = await buildPatrolEmailMime({ html, zips: [] })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      // 坏段跳过，好段照入
      const stats = db.prepare('SELECT COUNT(*) c FROM api_patrol_stats').get()
      expect(stats.c).toBe(1)
      const auditWarn = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'api_patrol.email_ingestion%' AND action != 'api_patrol.email_ingestion_fetch'").get()
      expect(auditWarn.c).toBeGreaterThanOrEqual(1)
    })
  })

  // =============================================== P1-6 ZIP 包类型与池名兜底

  describe('P1-6 ZIP 包类型与池名提取', () => {
    it('文件名含 eip/vpc/elb 判包类型；池名从文件名日期前部分截取', async () => {
      const eipCsv = eipCsvRows([
        '1,,req-001,/acl/v3/floatingip/bind,u1,cmic_sim,绑定,IP,b1,0,100,2026-11-07 10:00:00,',
      ])
      const elbCsv = elbCsvRows([
        '1,req-elb-1,u1,L7POLICY,CREATE,2026-11-07 10:00:00,2026-11-07 10:00:01,FAILED,错误,,cmic_sim,1000,',
      ])
      const zip1 = await buildZip({ csvs: [{ filename: '华南-广州3_2026-11-07.csv', content: eipCsv }] })
      const zip2 = await buildZip({ csvs: [{ filename: '华北-北京3_2026-11-07.csv', content: elbCsv }] })
      const mime = await buildPatrolEmailMime({
        html: buildHtmlBody({ dataDate: '2026-11-07', products: [
          { name: '弹性公网IP', rows: [{ 资源池: '华南-广州3', 指标名称: '绑定', 接口名称: '/acl/v3/floatingip/bind', 业务类型: '绑定', 成功率: '0%', 正常比例: '-', 时长均值: '-' }] },
        ] }),
        zips: [
          { filename: 'EIP_VPC_2026-11-07.zip', base64: zip1 },
          { filename: 'ELB_2026-11-07.zip', base64: zip2 },
        ],
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(result.lastResult).toBe('success')
      const eipRow = db.prepare("SELECT * FROM api_patrol_requests WHERE request_id='req-001'").get()
      expect(eipRow.pool_name).toBe('华南-广州3')
      const elbRow = db.prepare("SELECT * FROM api_patrol_requests WHERE request_id='req-elb-1'").get()
      expect(elbRow.pool_name).toBe('华北-北京3')
      expect(elbRow.product_key).toBe('slb')
    })

    it('文件名无日期格式 → 池名兜底：eip_vpc 取 CSV 内资源池列/ELB 取文件名大写英文段', async () => {
      // eip_vpc CSV 无资源池列（明细列头无该列），ELB 文件名池段兜底
      const eipCsv = eipCsvRows([
        '1,,req-001,/acl/v3/floatingip/bind,u1,cmic_sim,绑定,IP,b1,0,100,2026-11-07 10:00:00,',
      ])
      const elbCsv = elbCsvRows([
        '1,req-elb-1,u1,L7POLICY,CREATE,2026-11-07 10:00:00,2026-11-07 10:00:01,FAILED,错误,,cmic_sim,1000,',
      ])
      // 文件名无日期：EIP 文件名含"华南-广州3"段（池名兜底来源）；ELB 文件名含大写英文段
      const zip1 = await buildZip({ csvs: [{ filename: '华南-广州3.csv', content: eipCsv }] })
      const zip2 = await buildZip({ csvs: [{ filename: 'ELB_华北-北京3.csv', content: elbCsv }] })
      const mime = await buildPatrolEmailMime({
        html: buildHtmlBody({ products: [] }),
        zips: [
          { filename: 'EIP_VPC_no_date.zip', base64: zip1 },
          { filename: 'ELB_no_date.zip', base64: zip2 },
        ],
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      // 兜底路径：池名来自文件名
      const eipRow = db.prepare("SELECT * FROM api_patrol_requests WHERE request_id='req-001'").get()
      expect(eipRow.pool_name).toBe('华南-广州3')
      const elbRow = db.prepare("SELECT * FROM api_patrol_requests WHERE request_id='req-elb-1'").get()
      expect(elbRow.pool_name).toBe('华北-北京3')
    })

    it('包类型文件名全不匹配 → CSV 列头兜底：requestMapping→eip_vpc / resourceType→elb', async () => {
      const eipCsv = eipCsvRows([
        '1,,req-001,/acl/v3/floatingip/bind,u1,cmic_sim,绑定,IP,b1,0,100,2026-11-07 10:00:00,',
      ])
      // ZIP 文件名与 CSV 文件名均无 eip/vpc/elb/slb 关键词 → 列头兜底
      const zip1 = await buildZip({ csvs: [{ filename: '明细数据.csv', content: eipCsv }] })
      const mime = await buildPatrolEmailMime({
        html: buildHtmlBody({ products: [] }),
        zips: [{ filename: '附件1.zip', base64: zip1 }],
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      const eipRow = db.prepare("SELECT * FROM api_patrol_requests WHERE request_id='req-001'").get()
      expect(eipRow).toBeTruthy()
      expect(eipRow.product_key).toBe('eip')
    })
  })

  // =============================================== P1-5b 附件×正文产品交叉验证

  describe('P1-5b 附件与正文产品交叉验证', () => {
    it('正文有产品但附件缺对应 ZIP → 审计告警（静默漏数据可观测）', async () => {
      const mime = await buildPatrolEmailMime({
        html: buildHtmlBody({ dataDate: '2026-11-07', products: [
          { name: '弹性公网IP', rows: [{ 资源池: '华南-广州3', 指标名称: '订购', 接口名称: '/customer/v3/order/create/floatingip', 业务类型: '订购', 成功率: '88.89%', 正常比例: '-', 时长均值: '-' }] },
          { name: '虚拟私有云', rows: [{ 资源池: '华北-北京3', 指标名称: '创建子网', 接口名称: '/customer/v3/network', 业务类型: '新增', 成功率: '96.72%', 正常比例: '-', 时长均值: '-' }] },
        ] }),
        // 只给 EIP/VPC ZIP，缺 ELB——但正文有 slb 产品吗？没有。改：正文有 eip+vpc，附件只有 vpc 的
        zips: [],
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      // 正文有 2 产品（eip+vpc）无附件——各缺对应 ZIP，交叉验证告警 2 条
      expect(result.lastResult).toBe('success')
      const crossWarn = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='api_patrol.email_ingestion_attachment_product_mismatch'").get()
      expect(crossWarn.c).toBe(2)
    })
  })

  // =============================================== P0-2 补充：数据日期

  describe('数据日期提取', () => {
    it('正文"数据日期"优先；无标注按发送日期 T-1', async () => {
      const mime = await buildPatrolEmailMime({
        html: `<html><body><p>数据日期：2026-11-07</p></body></html>`,
        zips: [],
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      // 空正文无 stats 表——但数据日期提取应得 2026-11-07
      expect(result.lastStats?.dataDate).toBe('2026-11-07')
    })
  })

  // =============================================== P2-8 可观测性

  describe('P2-8 拉取失败可观测', () => {
    it('IMAP 连接失败 → fetch_error 状态 + 审计记录', async () => {
      mod.setImapClientFactory(() => ({
        connect: async () => { throw new Error('IMAP connect failed') },
        searchAndFetch: async () => [],
      }))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(result.lastResult).toBe('fetch_error')
      expect(result.lastError).toContain('IMAP')
      const fetchErr = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='api_patrol.email_ingestion_fetch_error'").get()
      expect(fetchErr.c).toBe(1)
    })

    it('解析失败 → parse_error 状态 + 审计记录', async () => {
      // 合法 MIME + 白名单发件人 + 空 HTML（非字符串 body 结构破坏 → html 提取失败路径）
      const badMime = [
        'From: service@cmecloud.cn',
        'To: zhouhuiling@cmss.chinamobile.com',
        'Subject: test',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'NOT HTML BODY',
      ].join('\r\n')
      mod.setImapClientFactory(makeImapClientFactory([badMime]))
      const result = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(result.lastResult).toBe('parse_error')
      const parseErr = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='api_patrol.email_ingestion_parse_error'").get()
      expect(parseErr.c).toBe(1)
    })
  })

  // =============================================== 幂等同日

  describe('同日幂等', () => {
    it('当日已成功拉取 → 再触发 skip（force=false）', async () => {
      const mime = await buildPatrolEmailMime({
        html: buildHtmlBody({ products: [] }),
      })
      mod.setImapClientFactory(makeImapClientFactory([mime]))
      const r1 = await mod.runPatrolEmailIngestion({ trigger: 'manual', force: true })
      expect(r1.lastResult).toBe('success')
      const r2 = await mod.runPatrolEmailIngestion({ trigger: 'schedule', force: false })
      expect(r2.lastResult).toBe('skipped')  // lastFetchDate=今日 → skip
    })
  })
})
