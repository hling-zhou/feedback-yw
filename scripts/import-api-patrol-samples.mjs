#!/usr/bin/env node
/**
 * API 巡检样例数据导入脚本（M8 运维工具 · docs/DESIGN-API巡检.md §10）。
 * 走真实推送链路（对运行中的 API 发 HTTP，与外部系统行为一致）：
 *   1. 读样例 CSV（data/API 巡检/原始数据样例）
 *   2. POST /api/patrol/push/stats + push/requests（5000 行分批）
 *   3. 可选：POST /api/patrol/admin/process 触发压缩+诊断（需 admin token + MCP 端点）
 * 用法：
 *   node scripts/import-api-patrol-samples.mjs --api http://127.0.0.1:3001 --key <patrol:push API Key>
 *   [--admin-token <JWT>] [--mcp http://...:31788/mcp --mcp-token <token>] [--dir <样例目录>]
 */
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'

const args = parseArgs(process.argv.slice(2))
const API = args.api || 'http://127.0.0.1:3001'
const KEY = args.key
const ADMIN_TOKEN = args['admin-token']
const MCP = args.mcp
const MCP_TOKEN = args['mcp-token']
const SAMPLE_DIR = args.dir || path.join(process.cwd(), 'data', 'API 巡检', '原始数据样例')
const FROM = args.from || ''   // e.g. 2026-08-06（含）；空=不过滤
const TO = args.to || ''      // e.g. 2026-08-12（含）

if (!KEY) {
  console.error('用法: node scripts/import-api-patrol-samples.mjs --api http://127.0.0.1:3001 --key <patrol:push API Key>')
  process.exit(1)
}

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = String(argv[i]).replace(/^--/, '')
    out[k] = argv[i + 1]
  }
  return out
}

function cnDateToIso(cn) {
  const m = /^(\d+)月(\d+)日$/.exec(cn)
  if (!m) return ''
  return `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

async function post(pathname, payload, authHeader) {
  const res = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

const keyHeader = { authorization: `Bearer ${KEY}` }
/** @type {Array<Record<string, number>>} */
const summary = []

// ── ① 统计表 ──
for (const productName of fs.readdirSync(path.join(SAMPLE_DIR, '异常接口统计'))) {
  const productDir = path.join(SAMPLE_DIR, '异常接口统计', productName)
  for (const file of fs.readdirSync(productDir)) {
    const date = cnDateToIso(file.replace(/\.csv$/, ''))
    if (!date) continue
    if (FROM && date < FROM) continue
    if (TO && date > TO) continue
    const rows = Papa.parse(fs.readFileSync(path.join(productDir, file), 'utf8'), { header: true, skipEmptyLines: true }).data
    const r = await post('/api/patrol/push/stats', { product: productName, date, rows }, keyHeader)
    summary.push({ kind: 'stats', product: productName, date, ...r })
  }
}

// ── ② 明细 ──
for (const [packageId, dirName] of [['eip_vpc', '弹性公网IP_虚拟私有云'], ['elb', '弹性负载均衡']]) {
  const dir = path.join(SAMPLE_DIR, '明细', dirName)
  for (const file of fs.readdirSync(dir)) {
    const m = /^(\d+月\d+日)_(.+)\.csv$/.exec(file)
    if (!m) continue
    const date = cnDateToIso(m[1])
    const pool = m[2]
    if (FROM && date < FROM) continue
    if (TO && date > TO) continue
    const rows = Papa.parse(fs.readFileSync(path.join(dir, file), 'utf8'), { header: true, skipEmptyLines: true }).data
    for (let i = 0; i < rows.length; i += 5000) {
      const r = await post('/api/patrol/push/requests', {
        package: packageId, date, pool, rows: rows.slice(i, i + 5000),
      }, keyHeader)
      summary.push({ kind: 'requests', file, batch: i, ...r })
    }
  }
}

// ── 对拍单输出 ──
const totals = summary.reduce((a, s) => ({
  received: a.received + (s.received || 0),
  inserted: a.inserted + (s.inserted || 0),
  overwritten: a.overwritten + (s.overwritten || 0),
  ignored: a.ignored + (s.ignored || 0),
}), { received: 0, inserted: 0, overwritten: 0, ignored: 0 })
console.log('── 导入对拍单 ──')
console.log(`批次: ${summary.length}`)
console.log(`接收 ${totals.received} / 新增 ${totals.inserted} / 覆盖 ${totals.overwritten} / 忽略 ${totals.ignored}`)
if (totals.ignored > 0) {
  console.warn('⚠ 存在忽略行——检查坏行日志')
}

// ── ③ 可选：压缩+诊断 ──
if (ADMIN_TOKEN) {
  const dates = [...new Set(summary.filter((s) => s.kind === 'requests').map((s) => s.date))]
  const r = await post('/api/patrol/admin/process', {
    dates,
    ...(MCP ? { runDiagnose: true, mcpEndpoint: MCP, mcpToken: MCP_TOKEN || '' } : {}),
  }, { authorization: `Bearer ${ADMIN_TOKEN}` })
  const groups = r.compressed.reduce((a, c) => a + c.groups, 0)
  const compressedFrom = r.compressed.reduce((a, c) => a + c.compressedFrom, 0)
  console.log(`压缩: ${groups} 组（压缩前 ${compressedFrom} 次失败）`)
  if (r.diagnosed?.length) {
    const diag = r.diagnosed.reduce((a, c) => ({ diagnosed: a.diagnosed + c.diagnosed, succeeded: a.succeeded + c.succeeded, failed: a.failed + c.failed }), { diagnosed: 0, succeeded: 0, failed: 0 })
    console.log(`诊断: ${diag.diagnosed} 组（成功 ${diag.succeeded} / 失败 ${diag.failed}——失败组可重试）`)
  }
  console.log('完成：可在总览页（/api-patrol/overview）与溯源页（/api-patrol/failures）查看')
}
