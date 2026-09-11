/**
 * 全量重新打标脚本：NAT网关、融合VPN、云组网、云监控
 *
 * 流程：
 *   1. 读取 .env 环境变量（JWT_SECRET 等）
 *   2. 从 auth.db 读取 LLM 配置（库 > 环境变量）
 *   3. Patch fetch → 拦截 /api/llm/chat 请求，直接代理到 LLM 后端（无需启动 API 服务）
 *   4. 从 auth.db 读取目标产品 records（NAT网关/融合VPN/IPSec VPN/SSL VPN/云组网/云监控）
 *   5. 逐条 reprocessFeedbackRecord（规则打标 + 闸门重试闭环 R1/R2/R3）
 *   6. 批量 enrichTicketRecordsForImport（LLM 增强 + M5/M6 复验）
 *   7. 写回 auth.db records 表
 *
 * 用法：
 *   node scripts/retag-nat-vpn-cc-monitor.mjs [--dry-run]
 *
 * 注意：如果 .env 中配置了 LLM_API_KEY，或 DB 的 llm_config_v1 中有配置，
 * 则 R3 LLM 介入和批量 LLM 增强会生效；否则只做规则打标。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const DB_PATH = path.resolve(PROJECT_ROOT, 'server', 'data', 'auth.db')
const ENV_PATH = path.resolve(PROJECT_ROOT, '.env')
const DRY_RUN = process.argv.includes('--dry-run')

// === 1. 加载 .env ===
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return
  const text = fs.readFileSync(envPath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
loadEnvFile(ENV_PATH)
console.log('[env] .env loaded')

// === DB helpers use Python sqlite3 (avoid better-sqlite3 N-API issues) ===

console.log('='.repeat(60))
console.log('  全量重新打标：NAT网关 / 融合VPN / 云组网 / 云监控')
console.log('  模式: ' + (DRY_RUN ? 'DRY RUN (不写回)' : 'WRITE (写回 DB)'))
console.log('  步骤: 规则打标+闸门 → LLM增强+M5/M6 → M7异主体闸门 → 写回DB')
console.log('='.repeat(60))

// Main execution
async function main() {
  // Step 1: Read LLM config from DB
  console.log('\n[1/5] 读取 LLM 配置...')
  const llmConfig = readLlmConfigViaPython(DB_PATH)
  if (llmConfig) {
    console.log(`  LLM 配置来源: DB (llm_config_v1)`)
    console.log(`  baseUrl: ${llmConfig.baseUrl || '(default)'}`)
    console.log(`  model: ${llmConfig.model || '(default)'}`)
    console.log(`  apiKey: ${llmConfig.apiKey ? llmConfig.apiKey.slice(0, 8) + '...' : '(empty)'}`)
  } else {
    const envKey = process.env.LLM_API_KEY?.trim()
    if (envKey) {
      console.log(`  LLM 配置来源: .env (LLM_API_KEY)`)
      console.log(`  baseUrl: ${process.env.LLM_BASE_URL || '(default)'}`)
      console.log(`  model: ${process.env.LLM_MODEL || '(default)'}`)
      console.log(`  apiKey: ${envKey.slice(0, 8)}...`)
    } else {
      console.log('  LLM 未配置：只做规则打标，R3 LLM 介入和批量 LLM 增强将跳过')
    }
  }

  // Step 2: Read records from DB
  console.log('\n[2/5] 读取目标产品 records...')
  const records = readRecordsViaPython(DB_PATH)
  console.log(`  读取 ${records.length} 条记录`)
  const byProduct = {}
  for (const r of records) {
    const p = r.product || '(unknown)'
    byProduct[p] = (byProduct[p] || 0) + 1
  }
  for (const [k, v] of Object.entries(byProduct)) {
    console.log(`    ${k}: ${v} 条`)
  }

  if (!records.length) {
    console.log('  无记录，退出')
    return
  }

  // Step 3: Initialize taxonomy & product catalog
  console.log('\n[3/5] 初始化分类法与产品目录...')
  const { initTaxonomyCacheFromBuiltin } = await import('../src/lib/taxonomyLoader.js')
  const { applyCatalogProducts } = await import('../src/lib/productCatalogLoader.js')
  initTaxonomyCacheFromBuiltin()

  // Enable all target products
  const allProducts = [
    { key: 'nat', name: 'NAT网关', enabled: true, taxonomyKey: 'nat', acceptParentName: true, specs: [] },
    { key: 'vpn', name: '融合VPN', enabled: true, taxonomyKey: 'vpn', acceptParentName: true, specs: [] },
    { key: 'cc', name: '云组网', enabled: true, taxonomyKey: 'cc', acceptParentName: true, specs: [] },
    { key: 'monitor', name: '云监控', enabled: true, taxonomyKey: 'monitor', acceptParentName: true, specs: [] },
    { key: 'ipsec_vpn', name: 'IPSec VPN', enabled: true, taxonomyKey: 'vpn', acceptParentName: true, specs: [] },
    { key: 'ssl_vpn', name: 'SSL VPN', enabled: true, taxonomyKey: 'vpn', acceptParentName: true, specs: [] },
    // Keep the original 4 enabled too
    { key: 'eip', name: '弹性公网IP', enabled: true, taxonomyKey: 'eip', acceptParentName: true, specs: [] },
    { key: 'dc', name: '云专线', enabled: true, taxonomyKey: 'dc', acceptParentName: true, specs: [] },
    { key: 'slb', name: '弹性负载均衡', enabled: true, taxonomyKey: 'slb', acceptParentName: true, specs: [] },
    { key: 'vpc', name: '虚拟私有云', enabled: true, taxonomyKey: 'vpc', acceptParentName: true, specs: [] },
  ]
  applyCatalogProducts(allProducts, { source: 'builtin' })
  console.log('  分类法与产品目录已初始化')

  // Step 4: Patch fetch for LLM proxy (if LLM configured)
  const llmAvailable = !!(llmConfig?.apiKey || process.env.LLM_API_KEY?.trim())
  if (llmAvailable) {
    console.log('\n  [patch] 拦截 /api/llm/chat 请求 → 直接代理到 LLM 后端')
    patchFetchForLlm(llmConfig)
  }

  // Step 5: Reprocess each record
  console.log('\n[4/5] 逐条重新打标（规则打标 + 闸门重试闭环）...')
  const { reprocessFeedbackRecord } = await import('../src/lib/pipeline.js')

  /** @type {any[]} */
  const reprocessed = []
  let okCount = 0
  let reviewCount = 0

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const label = `${rec.product || '?'} #${rec.ticketId || rec.id?.slice(0, 12) || i}`
    process.stdout.write(`  [${i + 1}/${records.length}] ${label}... `)

    try {
      const settings = { useRegex: true, llmServerConfigured: llmAvailable }
      const result = await reprocessFeedbackRecord(rec, settings, { forceOverrideManualTags: true })
      reprocessed.push(result)
      if (result.tagStatus === 'ok') {
        okCount++
        console.log(`OK (${result.requestScene} / ${result.problemType} / ${result.journeyL1})`)
      } else {
        reviewCount++
        console.log(`MANUAL_REVIEW (${(result.tagIssues || []).join('; ')})`)
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      // Keep original record on error
      reprocessed.push(rec)
    }
  }

  console.log('  规则打标完成: ' + okCount + ' OK, ' + reviewCount + ' manual_review')

  // Step 6: LLM enrichment (if available and there are enrichable records)
  let finalRecords = reprocessed
  const enrichableCount = reprocessed.filter(r => r.tagStatus !== 'manual_review').length
  if (llmAvailable && enrichableCount > 0) {
    console.log('\n[5/5] LLM 批量增强 + M5/M6 复验 (' + enrichableCount + ' 条可增强, ' + (reprocessed.length - enrichableCount) + ' 条 manual_review 跳过)...')
    const { enrichTicketRecordsForImport } = await import('../src/lib/importEnrichment.js')
    const settings = { useRegex: true, llmServerConfigured: true }

    try {
      const result = await enrichTicketRecordsForImport(reprocessed, settings, (label, done, total) => {
        if (done % 4 === 0 || done === total) {
          process.stdout.write('\r  ' + label + ': ' + done + '/' + total)
        }
      })
      finalRecords = result.records
      console.log('\n  LLM 增强完成')
      if (result.warnings.length) {
        console.log('  警告:')
        for (const w of result.warnings) {
          console.log('    - ' + w)
        }
      }
    } catch (e) {
      console.log('\n  LLM 增强失败: ' + e.message)
      console.log('  回退到规则打标结果')
      finalRecords = reprocessed
    }
  } else if (llmAvailable && enrichableCount === 0) {
    console.log('\n[5/5] 所有记录均为 manual_review，跳过 LLM 增强')
  } else {
    console.log('\n[5/5] LLM 未配置，跳过 LLM 增强')
  }

  // Step 7: M7 异主体闸门（与导入流程 pre-disk-gate 一致）
  // 在 LLM 增强之后、写回 DB 之前，跑 ticket-gate-loop.cjs 验证异主体一致性
  // 底层逻辑与 server/routes/storage.js 的 pre-disk-gate 端点完全相同：
  //   1) 写 records 到临时 JSON 文件
  //   2) execFileSync 跑 ticket-gate-loop.cjs --input <文件>
  //   3) 读回 dist/ticket-records-gated.json（Fixer 修正后的 records）
  //   4) 读回 dist/ticket-gate-report.json（闸门报告）
  console.log('\n[6/6] M7 异主体闸门验证...')
  try {
    const gateResult = runPreDiskGate(finalRecords)
    if (gateResult.records) {
      finalRecords = gateResult.records
      for (const w of gateResult.warnings) {
        console.log('  ' + w)
      }
    }
  } catch (e) {
    console.log('  M7 闸门执行失败: ' + e.message + '，使用增强后结果继续')
  }

  // Summary: before vs after
  console.log('\n' + '='.repeat(60))
  console.log('  打标结果摘要')
  console.log('='.repeat(60))
  for (let i = 0; i < records.length; i++) {
    const before = records[i]
    const after = finalRecords[i]
    const changes = []
    if (before.requestScene !== after.requestScene) changes.push(`scene: ${before.requestScene || '?'} → ${after.requestScene || '?'}`)
    if (before.problemType !== after.problemType) changes.push(`type: ${before.problemType || '?'} → ${after.problemType || '?'}`)
    if (before.journeyL1 !== after.journeyL1) changes.push(`j1: ${before.journeyL1 || '?'} → ${after.journeyL1 || '?'}`)
    if (before.journeyL2 !== after.journeyL2) changes.push(`j2: ${before.journeyL2 || '?'} → ${after.journeyL2 || '?'}`)
    if (before.customerRequest !== after.customerRequest) changes.push('CR 变更')
    if (before.painPoint !== after.painPoint) changes.push('痛点 变更')

    const status = after.tagStatus || 'ok'
    const changeStr = changes.length ? changes.join(', ') : '(无变化)'
    console.log(`  ${before.product} #${before.ticketId || before.id?.slice(0, 8)} [${status}] ${changeStr}`)
  }

  // Write back to DB
  if (DRY_RUN) {
    console.log('\n[DRY RUN] 不写回 DB')
  } else {
    console.log('\n[写回] 更新 auth.db records 表...')
    writeRecordsViaPython(DB_PATH, finalRecords)
    console.log(`  ${finalRecords.length} 条记录已写回`)
  }

  console.log('\n完成。')
}

// === Helper: Read LLM config from DB via Python ===
function readLlmConfigViaPython(dbPath) {
  const { execSync } = require('child_process')
  const pyScript = `
import sqlite3, json, sys
conn = sqlite3.connect('${dbPath.replace(/'/g, "\\'")}')
cur = conn.cursor()
cur.execute("SELECT value FROM meta WHERE key = 'llm_config_v1'")
row = cur.fetchone()
if row:
    cfg = json.loads(row[0])
    print(json.dumps({
        'apiKey': cfg.get('apiKey', '').strip(),
        'baseUrl': cfg.get('baseUrl', '').strip(),
        'model': cfg.get('model', '').strip(),
    }, ensure_ascii=False))
else:
    print('null')
conn.close()
`
  try {
    const out = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    const parsed = JSON.parse(out.trim())
    return parsed && parsed.apiKey ? parsed : null
  } catch {
    return null
  }
}

// === Helper: Read records from DB via Python ===
function readRecordsViaPython(dbPath) {
  const { execSync } = require('child_process')
  const products = ['NAT网关', '融合VPN', 'IPSec VPN', 'SSL VPN', '云组网', '云监控']
  const productsJson = JSON.stringify(products)
  const pyScript = `
import sqlite3, json, sys
products = json.loads('${productsJson.replace(/'/g, "\\'")}')
conn = sqlite3.connect('${dbPath.replace(/'/g, "\\'")}')
conn.row_factory = sqlite3.Row
cur = conn.cursor()
placeholders = ','.join('?' * len(products))
cur.execute(f"SELECT id, ticket_id, payload FROM records WHERE json_extract(payload, '$.product') IN ({placeholders}) AND payload IS NOT NULL ORDER BY json_extract(payload, '$.product')", products)
rows = cur.fetchall()
for r in rows:
    p = json.loads(r['payload'])
    # Ensure id and ticketId are set
    if 'id' not in p:
        p['id'] = r['id']
    if 'ticketId' not in p and r['ticket_id']:
        p['ticketId'] = r['ticket_id']
    print(json.dumps(p, ensure_ascii=False))
conn.close()
`
  try {
    const out = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
    return out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  } catch (e) {
    console.error('  读取 DB 失败:', e.message)
    return []
  }
}

// === Helper: Write records back to DB via Python ===
function writeRecordsViaPython(dbPath, records) {
  const { execSync } = require('child_process')

  // Write records to temp JSON file
  const tmpFile = path.resolve(__dirname, '..', 'dist', 'retag-output.json')
  const tmpDir = path.dirname(tmpFile)
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
  fs.writeFileSync(tmpFile, JSON.stringify(records), 'utf8')

  const pyScript = `
import sqlite3, json, sys
db_path = '${dbPath.replace(/'/g, "\\'")}'
tmp_file = '${tmpFile.replace(/'/g, "\\'")}'

with open(tmp_file, 'r') as f:
    records = [json.loads(line) for line in f if line.strip()] if not f.read(1) else []
# Actually read as single JSON array
with open(tmp_file, 'r') as f:
    records = json.load(f)

conn = sqlite3.connect(db_path)
cur = conn.cursor()
written = 0
for rec in records:
    rec_id = rec.get('id')
    if not rec_id:
        continue
    payload = json.dumps(rec, ensure_ascii=False)
    import_month = rec.get('importMonth', '')
    data_source_type = rec.get('dataSourceType', 'complaint_ticket')
    tenant_id = rec.get('tenantId', 'default')
    import_batch_id = rec.get('importBatchId', '')
    ticket_id = rec.get('ticketId', '')
    # Get existing ticket_id column
    cur.execute("SELECT ticket_id FROM records WHERE id = ?", (rec_id,))
    row = cur.fetchone()
    existing_ticket_id = row[0] if row else None

    # If ticketId hasn't changed, keep existing column value
    if rec.get('ticketId', '').strip() == (ticket_id or ''):
        ticket_id_col = existing_ticket_id
    else:
        ticket_id_col = ticket_id or None

    cur.execute("""
        INSERT INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id, ticket_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            payload = excluded.payload,
            import_month = excluded.import_month,
            data_source_type = excluded.data_source_type,
            tenant_id = excluded.tenant_id,
            import_batch_id = excluded.import_batch_id,
            ticket_id = excluded.ticket_id
    """, (rec_id, payload, import_month, data_source_type, tenant_id, import_batch_id, ticket_id_col))
    written += 1

conn.commit()
conn.close()
print(f'{written} records written')
`
  try {
    const out = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
    console.log('  ' + out.trim())
  } catch (e) {
    console.error('  写回 DB 失败:', e.message)
    if (e.stderr) console.error(e.stderr)
  }
}

// === Helper: Patch fetch to intercept /api/llm/chat ===
function patchFetchForLlm(llmConfig) {
  const apiKey = llmConfig?.apiKey || process.env.LLM_API_KEY?.trim()
  const baseUrl = (llmConfig?.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
  const model = llmConfig?.model || process.env.LLM_MODEL || 'gpt-4o-mini'

  const originalFetch = globalThis.fetch
  globalThis.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || ''

    // Intercept /api/llm/chat
    if (url.includes('/api/llm/chat') && init?.method?.toUpperCase() === 'POST') {
      const body = JSON.parse(init.body)
      const { baseUrl: _b, model: _m, apiKey: _k, ...chatBody } = body
      const chatModel = (typeof chatBody.model === 'string' && chatBody.model.trim()) || model
      const payload = { max_tokens: 2048, ...chatBody, model: chatModel }
      const targetUrl = `${baseUrl}/chat/completions`

      try {
        const res = await originalFetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        })

        const text = await res.text()
        if (!res.ok) {
          throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
        }

        // Return a Response-like object
        return {
          ok: true,
          status: 200,
          text: async () => text,
          json: async () => JSON.parse(text),
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`LLM 代理失败: ${msg}`)
      }
    }

    // Intercept /api/llm/status
    if (url.includes('/api/llm/status')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ configured: true, source: 'db', defaultBaseUrl: baseUrl, defaultModel: model }),
        json: async () => ({ configured: true, source: 'db', defaultBaseUrl: baseUrl, defaultModel: model }),
      }
    }

    // Pass through all other requests
    return originalFetch(input, init)
  }
}

// === Need to handle require() in ESM ===
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// === Helper: M7 异主体闸门（复刻 pre-disk-gate 端点逻辑） ===
function runPreDiskGate(records) {
  const os = require('os')
  const tmpDir = os.tmpdir()
  const inputFile = path.join(tmpDir, `ticket-gate-input-${Date.now()}.json`)
  const distDir = path.resolve(PROJECT_ROOT, 'dist')
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true })

  // 1. 写临时 JSON
  fs.writeFileSync(inputFile, JSON.stringify(records))

  // 2. 跑 ticket-gate-loop.cjs --input
  const NODE = process.env.NODE_BIN || process.execPath
  const loopScript = path.join(PROJECT_ROOT, 'scripts', 'ticket-gate-loop.cjs')
  let gateExitCode = 0
  let gateOutput = ''

  try {
    gateOutput = require('child_process').execFileSync(NODE, [loopScript, '--input', inputFile], {
      encoding: 'utf8',
      env: { ...process.env, GATE_MAX_ATTEMPTS: '3' },
      timeout: 300000,
      maxBuffer: 200 * 1024 * 1024,
    })
    gateExitCode = 0
  } catch (err) {
    gateExitCode = err.status ?? 1
    gateOutput = (err.stdout || '') + (err.stderr || '')
  }

  // 3. 读回 gated records
  const gatedPath = path.join(distDir, 'ticket-records-gated.json')
  let gatedRecords = records
  if (fs.existsSync(gatedPath)) {
    gatedRecords = JSON.parse(fs.readFileSync(gatedPath, 'utf8'))
  }

  // 4. 读回 gate report
  const reportPath = path.join(distDir, 'ticket-gate-report.json')
  let gateReport = null
  if (fs.existsSync(reportPath)) {
    gateReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  }

  // 5. 清理临时文件
  try { fs.unlinkSync(inputFile) } catch {}

  // 6. 构建 warnings
  const warnings = []
  if (gateReport) {
    const s = gateReport.summary
    warnings.push(`异主体闸门: OK=${s.ok} WARN=${s.warn} FAIL=${s.fail} (${s.failRate})`)
    if (gateExitCode !== 0) {
      warnings.push(`${gateReport.failures?.length || 0} 条工单标签验证未通过，已标 manual_review`)
    }
  }

  if (gateOutput) {
    console.log('  ' + gateOutput.trim().split('\n').join('\n  '))
  }

  return { records: gatedRecords, warnings, gateReport }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
