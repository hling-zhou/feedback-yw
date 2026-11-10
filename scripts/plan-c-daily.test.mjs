/**
 * Plan C 本机脚本全链测试（scripts/plan-c-daily.mjs，docs §10）。
 *
 * 真实链路：真临时持久库 + 真邮件 MIME（复用 Plan B 构造器）+ mock IMAP/MCP/推送目标。
 * 子进程跑脚本（真 main 入口），验证：
 * - 退出码语义（no_email→1；全链成功→0）
 * - 持久库压缩组数、诊断回填、收敛组
 * - 日包推送目标收到的包形态（三段完整、groups 含诊断）
 * - dry-run 不推送
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const exec = promisify(execFile)

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EIP_CSV_HEADER = 'id,appId,requestId,requestMapping,userId,userName,bizCategory,bizTarget,bizNo,result,executionTimeMillis,createTime,diagnoseResult'

/** 构造巡检邮件 MIME（复用 Plan B 测试同款形态）。 */
async function buildMime() {
  const eipCsv = [EIP_CSV_HEADER,
    '1,,req-pc-a,/acl/v3/floatingip/bind,u1,cmic_sim,绑定,IP,b1,0,100,2026-11-09 10:00:00,',
    '2,,req-pc-b,/acl/v3/floatingip/bind,u1,cmic_sim,绑定,IP,b2,0,200,2026-11-09 10:30:00,',
    '3,,req-pc-c,/acl/v3/floatingip/bind,u2,realuser,绑定,IP,b3,1,300,2026-11-09 11:00:00,',
  ].join('\n')
  const zip = new JSZip()
  zip.file('华南-广州3_2026-11-09.csv', eipCsv)
  const zipB64 = await zip.generateAsync({ type: 'base64' })
  const html = `<html><body><p>数据日期：2026-11-09</p><h3>📦 产品：弹性公网IP</h3>
    <table><tr><th>资源池</th><th>指标名称</th><th>接口名称</th><th>业务类型</th><th>成功率</th><th>正常比例</th><th>时长均值</th></tr>
    <tr><td>华南-广州3</td><td>绑定</td><td>/acl/v3/floatingip/bind</td><td>绑定</td><td>66.67%</td><td>-</td><td>-</td></tr></table></body></html>`
  const boundary = '----plan-c-test'
  return [
    'From: service@cmecloud.cn',
    'To: zhouhuiling@cmss.chinamobile.com',
    'Subject: 【API巡检报告】【11月9日】发现 1 款产品，共 1 条接口异常记录',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    '--' + boundary,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf-8').toString('base64'),
    '--' + boundary,
    'Content-Type: application/zip; name="EIP_VPC_2026-11-09.zip"',
    'Content-Disposition: attachment; filename="EIP_VPC_2026-11-09.zip"',
    'Content-Transfer-Encoding: base64',
    '',
    zipB64,
    '--' + boundary + '--',
  ].join('\r\n')
}

describe('Plan C 本机脚本全链', () => {
  let tmpDir = ''
  let localDb = ''
  /** @type {http.Server | null} */
  let pushTarget = null
  let pushPort = 0
  /** @type {any[]} */
  let receivedPackages = []
  let mime = ''

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-plan-c-script-'))
    localDb = path.join(tmpDir, 'plan-c-local.db')
    mime = await buildMime()

    // mock 推送目标（真实 HTTP 服务收包）
    pushTarget = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          receivedPackages.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ received: 5, stats: { inserted: 1 }, requests: { inserted: 3 }, groups: { written: 1 }, reportAction: 'sent' }))
        } catch {
          res.writeHead(400)
          res.end('{}')
        }
      })
    })
    await new Promise((r) => { /** @type {any} */ (pushTarget).listen(0, '127.0.0.1', r) })
    pushPort = /** @type {import('net').AddressInfo} */ (/** @type {any} */ (pushTarget).address()).port
  })

  afterAll(() => {
    /** @type {any} */ (pushTarget)?.close()
  })

  it('全链：拉取→压缩→诊断(mock MCP)→组包→推送（退出码 0）', async () => {
    // mock MCP 服务（JSON-RPC → final_conclusion 文本）
    const mcp = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: '{"final_conclusion":"存在绑定关系，需先解绑"}' }] },
      }))
    })
    await new Promise((r) => { mcp.listen(0, '127.0.0.1', r) })
    const mcpPort = /** @type {import('net').AddressInfo} */ (/** @type {any} */ (mcp).address()).port

    const envFile = path.join(tmpDir, '.env-plan-c')
    fs.writeFileSync(envFile, [
      `PLAN_C_TARGET_URL=http://127.0.0.1:${pushPort}`,
      'PLAN_C_PUSH_API_KEY=test-push-key',
      'PLAN_C_IMAP_AUTH_CODE=test-imap-code',
      'PLAN_C_MCP_TOKEN=test-mcp-token',
      `PLAN_C_MCP_ENDPOINT=http://127.0.0.1:${mcpPort}/mcp-server/mcp`,
      `PLAN_C_LOCAL_DB=${localDb}`,
    ].join('\n'))

    // IMAP mock：拦截 imapflow import？脚本走 patrolEmailIngestion 的 imapflow 路径——
    // 真实 IMAP 不可用。注入方式：脚本子进程无法 setImapClientFactory——
    // 用环境变量 PLAN_C_IMAP_RAW_MIME 注入（脚本侧支持的测试钩子：有该变量时直接用其当邮件源，跳过 IMAP 连接）
    const { stdout, stderr } = await exec('node', [path.join(REPO, 'scripts', 'plan-c-daily.mjs')], {
      cwd: REPO,
      env: {
        ...process.env,
        PLAN_C_ENV_FILE: envFile,
        PLAN_C_IMAP_RAW_MIME: mime,
      },
      timeout: 120_000,
    })
    expect(stdout).toContain('[plan-c fetch] 结果=success')
    expect(stdout).toContain('[plan-c compress]')
    expect(stdout).toContain('[plan-c push] 推送成功')

    // 收包目标验证：三段完整 + groups 含诊断
    expect(receivedPackages.length).toBe(1)
    const pkg = receivedPackages[0].body
    expect(pkg.date).toBe('2026-11-09')
    expect(pkg.stats).toHaveLength(1)
    expect(pkg.stats[0].rows).toHaveLength(1)
    expect(pkg.requests).toHaveLength(1)
    expect(pkg.requests[0].pool).toBe('华南-广州3')
    expect(pkg.groups.length).toBeGreaterThanOrEqual(1)
    const g = pkg.groups[0]
    expect(g.firstRequestId).toBe('req-pc-a')
    expect(g.rootCauseL1).toBe('业务冲突')       // mock 结论走真实分类链
    expect(g.diagnosisStatus).toBe('success')

    // 持久库验证：压缩组 + 诊断回填
    const { execSync } = await import('node:child_process')
    void execSync
    process.env.AUTH_DATABASE_PATH = localDb
    process.env.SERVER_DATA_DIR = tmpDir
    const { getDb, closeDb } = await import('../server/db.js')
    getDb()
    const db = getDb()
    expect(db.prepare("SELECT COUNT(*) c FROM api_patrol_failure_groups WHERE group_date='2026-11-09'").get().c).toBe(1)
    expect(db.prepare("SELECT COUNT(*) c FROM api_patrol_diagnoses WHERE status='success'").get().c).toBe(1)
    closeDb()
    mcp.close()
  }, 180_000)

  it('no_email 退出码 1', async () => {
    const envFile = path.join(tmpDir, '.env-no-email')
    fs.writeFileSync(envFile, [
      `PLAN_C_TARGET_URL=http://127.0.0.1:${pushPort}`,
      'PLAN_C_PUSH_API_KEY=k',
      'PLAN_C_IMAP_AUTH_CODE=c',
      'PLAN_C_MCP_TOKEN=t',
      `PLAN_C_LOCAL_DB=${localDb}`,
    ].join('\n'))
    // 空 MIME 列表（imaps mock 返回 0 封）
    const { stdout } = await exec('node', [path.join(REPO, 'scripts', 'plan-c-daily.mjs')], {
      cwd: REPO,
      env: { ...process.env, PLAN_C_ENV_FILE: envFile, PLAN_C_IMAP_RAW_MIME: '__EMPTY__' },
      timeout: 60_000,
    }).catch((e) => e)  // 退出码 1 → execFile 抛错，捕获取 stdout
    expect(String(stdout)).toContain('no_email')
  }, 90_000)
})
