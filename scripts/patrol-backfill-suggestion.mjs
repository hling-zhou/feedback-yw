/**
 * 存量诊断建议补跑脚本（11-17 一次性）：给 suggestion IS NULL 的诊断行生成 LLM 处理建议。
 * 不动分类/状态——只补第五段。幂等（有建议的跳过）。
 * 用法：node scripts/patrol-backfill-suggestion.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

function loadEnvFile() {
  const envPath = process.env.PLAN_C_ENV_FILE || path.join(REPO_ROOT, '.env-plan-c')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnvFile()

const LOCAL_DB = process.env.PLAN_C_LOCAL_DB || path.join(REPO_ROOT, 'server', 'data', 'plan-c-local.db')
const DRY_RUN = process.argv.includes('--dry-run')
process.env.AUTH_DATABASE_PATH = LOCAL_DB
process.env.SERVER_DATA_DIR = path.dirname(LOCAL_DB)

const { getDb, closeDb } = await import('../server/db.js')
getDb()
const db = getDb()
const { extractDiagnosticText } = await import('../server/patrolRootCauseClassifier.js')
const { generateDiagnosisSuggestion } = await import('../server/patrolDiagnosisSuggestion.js')

// 目标：诊断成功但无建议的行（final_conclusion 或日志文本任一有内容才有生成意义）
const rows = db.prepare(`
  SELECT d.id AS diag_id, d.failure_group_id, d.mcp_raw_response, d.final_conclusion,
         g.root_cause_l1, g.api_path
  FROM api_patrol_diagnoses d
  JOIN api_patrol_failure_groups g ON g.id = d.failure_group_id
  WHERE d.suggestion IS NULL AND d.status = 'success'
  ORDER BY d.id
`).all()
console.log(`[backfill-suggestion] 目标 ${rows.length} 行${DRY_RUN ? '（dry-run）' : ''}`)

let done = 0
let skipped = 0
const samples = []
for (const r of rows) {
  const isElb = !String(r.api_path || '').startsWith('/')
  const text = extractDiagnosticText(String(r.mcp_raw_response || ''), '', isElb)
  const suggestion = await generateDiagnosisSuggestion(text || r.final_conclusion, text, r.root_cause_l1)
  if (!suggestion) { skipped += 1; continue }
  done += 1
  if (samples.length < 3) samples.push({ id: r.diag_id, l1: r.root_cause_l1, suggestion })
  if (!DRY_RUN) {
    db.prepare('UPDATE api_patrol_diagnoses SET suggestion=? WHERE id=?').run(suggestion, r.diag_id)
  }
}
console.log(`[backfill-suggestion] 生成 ${done} 条，跳过 ${skipped} 条（无内容可生成）`)
for (const s of samples) {
  console.log('   样例 #' + s.id, '[' + s.l1 + ']:', s.suggestion.slice(0, 90))
}
if (!DRY_RUN && done > 0) console.log('[backfill-suggestion] 重推部署端：逐日 --package-only')
closeDb()
