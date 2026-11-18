/**
 * 存量「其他/未归类」失败组重分类脚本（11-17 一次性工具）。
 * 链路：读 mcp_raw_response → extractDiagnosticText（新提取层）→ 规则表（新 5 条）
 *      → 规则仍兜底且文本非空 → LLM 语义兜底 → 更新 groups/diagnoses。
 * 用法：
 *   node scripts/patrol-reclassify.mjs                 # 真跑（更新库）
 *   node scripts/patrol-reclassify.mjs --dry-run       # 只看终态分布不改库
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

// env 加载（.env-plan-c——LLM 配置可从部署端设置 DB 或 env 取；本机无 DB 配置时用 env）
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
const { extractDiagnosticText, classifyPatrolRootCause } = await import('../server/patrolRootCauseClassifier.js')
const { API_PATROL_ROOT_CAUSE_RULES_SEED } = await import('../server/patrolSeeds.js')
const { classifyRootCauseByLlm } = await import('../server/patrolRootCauseLlmClassifier.js')

const rows = db.prepare(`
  SELECT g.id, g.product_key, g.pool_name, g.api_path, g.product_action_status, d.mcp_raw_response
  FROM api_patrol_failure_groups g
  JOIN api_patrol_diagnoses d ON d.failure_group_id = g.id
  WHERE g.root_cause_l1 = '其他/未归类'
  ORDER BY g.id
`).all()
console.log(`[reclassify] 目标 ${rows.length} 组（当前 其他/未归类）${DRY_RUN ? '（dry-run）' : ''}`)

const counts = {}
const updates = []
for (const r of rows) {
  const isElb = !String(r.api_path || '').startsWith('/')
  const text = extractDiagnosticText(String(r.mcp_raw_response || ''), '', isElb)
  let classified = classifyPatrolRootCause(text, API_PATROL_ROOT_CAUSE_RULES_SEED)
  let byLlm = false
  if (classified.l1 === '其他/未归类' && text) {
    const llm = await classifyRootCauseByLlm(text)
    if (llm.byLlm) { classified = { l1: llm.l1, l2: '' }; byLlm = true } // 11-18 拍板：L2 场景置空待 LLM 主链补（此脚本只兜 L1）
  }
  const key = classified.l1 + '/' + classified.l2 + (byLlm ? ' (LLM)' : '')
  counts[key] = (counts[key] || 0) + 1
  if (classified.l1 !== '其他/未归类' || classified.l2 !== '兜底') {
    updates.push({ id: r.id, l1: classified.l1, l2: classified.l2, text: text.slice(0, 60) })
  }
}

console.log('[reclassify] 终态分布:')
for (const [k, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log('  ', c, '|', k)

if (!DRY_RUN) {
  const now = new Date().toISOString()
  const updGroups = db.prepare('UPDATE api_patrol_failure_groups SET root_cause_l1=?, root_cause_l2=?, updated_at=? WHERE id=?')
  const updDiag = db.prepare('UPDATE api_patrol_diagnoses SET root_cause_l1=?, root_cause_l2=? WHERE failure_group_id=?')
  const tx = db.transaction(() => {
    for (const u of updates) {
      updGroups.run(u.l1, u.l2, now, u.id)
      updDiag.run(u.l1, u.l2, u.id)
    }
  })
  tx()
  console.log(`[reclassify] 已更新 ${updates.length} 组（groups + diagnoses 同步）`)
  for (const u of updates) console.log('   #' + u.id, '→', u.l1 + '/' + u.l2, '|', u.text || '(空文本)')
  console.log('[reclassify] 重推部署端：node scripts/plan-c-daily.mjs --package-only <日期>（按组日期分别推）')
} else {
  console.log(`[reclassify] dry-run：将更新 ${updates.length} 组`)
}
closeDb()
