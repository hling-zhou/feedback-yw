/* 省代表回访"已纳入"幽灵标记诊断与修复
 *
 * 背景（2026-11-10）：旧逻辑下清单导出/发送只写 dispatch 标记、不写回访 tab——
 * 标记存在但回访记录缺失 = "已纳入但反馈库没有"的脏状态。新逻辑（3aeb27c）
 * 导出/发送成功即预导入写入，但存量幽灵标记仍在。
 *
 * 诊断逻辑：遍历 post_use_visit_dispatch 全部标记，按 payload 身份三元组
 * （月+产品+客户名）在 post_use_visit_records_v1 meta 里找同身份回访记录；
 * 找不到 = 幽灵标记（显示已纳入但回访 tab 无记录）。
 *
 * 修复（--fix）二选一：
 *   默认     → 删除幽灵标记（清单恢复勾选模式，可重新勾选导出——新逻辑会预导入）
 *   --backfill → 反向补建预导入记录（保守：标记对应的回访记录建出来，待评估态）
 *
 * 用法：
 *   node scripts/visit-dispatch-reconcile.mjs --db server/data/auth.db          # 诊断（只读，回访侧）
 *   node scripts/visit-dispatch-reconcile.mjs --db ... --trace                  # 诊断（+溯源侧月份口径比对）
 *   node scripts/visit-dispatch-reconcile.mjs --db ... --fix                    # 修复：清幽灵标记
 *   node scripts/visit-dispatch-reconcile.mjs --db ... --fix --backfill         # 修复：补建回访记录
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function arg(name, def) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const DB_PATH = path.resolve(arg('--db', path.resolve(__dirname, '..', 'server', 'data', 'auth.db')))
const FIX = process.argv.includes('--fix')
const BACKFILL = process.argv.includes('--backfill')
const MARK_IMPORTED = process.argv.includes('--mark-imported')

const Database = require(path.resolve(__dirname, '..', 'node_modules', 'better-sqlite3'))
// 连接模式：任一修复 flag 即可写；纯诊断（无 flag）只读
const WRITER = FIX || MARK_IMPORTED
const db = new Database(DB_PATH, WRITER ? {} : { readonly: true })

// ── 读 dispatch 标记 ──
const dispatches = db
  .prepare('SELECT item_key, source_type, dispatched_via, dispatched_at, payload FROM post_use_visit_dispatch')
  .all()
  .map((row) => {
    let payload = {}
    try {
      payload = JSON.parse(row.payload)
    } catch {
      payload = {}
    }
    return {
      itemKey: String(row.item_key || ''),
      sourceType: String(row.source_type || ''),
      dispatchedVia: String(row.dispatched_via || ''),
      dispatchedAt: String(row.dispatched_at || ''),
      customerName: String(payload.customerName || ''),
      productName: String(payload.productName || ''),
      importMonth: String(payload.importMonth || ''),
    }
  })

// ── 读回访记录 meta ──
const metaRow = db.prepare("SELECT value FROM meta WHERE key = 'post_use_visit_records_v1'").get()
const visitRecords = metaRow ? (JSON.parse(metaRow.value).records || []) : []
const visitKeys = new Set(
  visitRecords.map((r) =>
    [
      String(r.importMonth || r.visitMonth || ''),
      String(r.productName || ''),
      String(r.customerName || ''),
    ].join('\0'),
  ),
)

// ── 身份匹配（与 deleteByIdentity 同口径：payload 三元组 + itemKey 段双保险）──
function customerFromItemKey(itemKey) {
  // q:客户:产品:月份（或旧格式 q:客户:产品 无月份段）→ 第 2 段客户、第 3 段产品
  const m = String(itemKey || '').match(/^q:([^:]+):(.+?)(?::(?:\d{4}-\d{2})(?:\|\d{4}-\d{2})*)?$/)
  return m ? { customer: m[1], product: m[2] } : null
}

const ghosts = []
for (const d of dispatches) {
  const key = [d.importMonth, d.productName, d.customerName].join('\0')
  const keyAlt = customerFromItemKey(d.itemKey)
  // 匹配三路：①payload 三元组精确 ②itemKey 有月份段（客户+产品+月份）③itemKey 无月份段
  // （旧格式 q:客户:产品——只要该客户产品任一月有回访记录即视为非幽灵，弹窗 isDispatched
  // 对旧格式走周期包含匹配，语义=该客户该产品处理过即已纳入）
  const keyHasMonth = /:\d{4}-\d{2}/.test(d.itemKey || '')
  const altHit = keyAlt
    ? visitRecords.some(
        (r) =>
          String(r.productName || '') === keyAlt.product &&
          (String(r.customerCode || '') === keyAlt.customer ||
            String(r.customerName || '') === keyAlt.customer) &&
          (keyHasMonth
            ? String(r.importMonth || r.visitMonth || '') === d.importMonth
            : true),
      )
    : false
  if (!visitKeys.has(key) && !altHit) ghosts.push(d)
}

// ── 报告 ──
console.log(`dispatch 标记总数: ${dispatches.length}`)
console.log(`回访 tab 记录总数: ${visitRecords.length}`)
console.log(`幽灵标记（已纳入但无回访记录）: ${ghosts.length}`)
for (const g of ghosts) {
  console.log(`  - ${g.importMonth} | ${g.productName} | ${g.customerName} | via=${g.dispatchedVia} at=${g.dispatchedAt} | key=${g.itemKey}`)
}

// ── 溯源侧诊断（2026-11-10 部署环境 8/9 月不一致问题扩展）──
// 弹窗"已纳入溯源"判定 = jira_items 表 itemKey 集合 + 周期包含匹配（itemKeySubsetMatches）；
// 溯源 tab 列表 = 同表按 importMonth 过滤（、分隔，任一命中）。两者同源不同过滤口径。
// 不一致形态：①条目 itemKey 的月份段与 payload.importMonth 不一致（归档时月份写偏）
// ②tab 按月查不到（弹窗显示已纳入但该月列表无此条目）。诊断以反馈库列表口径为准。
const TRACE = process.argv.includes('--trace')
if (TRACE) {
  const jiraRows = db.prepare('SELECT item_key, payload FROM post_use_jira_items').all()
  console.log('\n── 溯源侧（post_use_jira_items）──')
  console.log(`归档条目总数: ${jiraRows.length}`)
  const monthMismatch = []
  for (const row of jiraRows) {
    let payload = {}
    try {
      payload = JSON.parse(row.payload)
    } catch {
      payload = {}
    }
    const keyMonths = String(row.item_key || '').match(/(\d{4}-\d{2})(\|\d{4}-\d{2})*$/)?.[0]?.split('|') || []
    const itemMonth = String(payload.importMonth || '').trim()
    if (!itemMonth) continue
    // 弹窗按 itemKey 月份段显示已纳入；tab 按条目 payload.importMonth 过滤——
    // 月份段与 importMonth 完全无交集 = 弹窗显示但 tab 该月查不到
    if (keyMonths.length && !keyMonths.includes(itemMonth) && !itemMonth.split('、').some((m) => keyMonths.includes(m))) {
      monthMismatch.push({ itemKey: row.item_key, importMonth: itemMonth, keyMonths })
    }
  }
  console.log(`月份口径不一致（弹窗已纳入但 tab 按月查不到）: ${monthMismatch.length}`)
  for (const m of monthMismatch) {
    console.log(`  - key月份=${m.keyMonths.join('|')} vs 条目月份=${m.importMonth} | ${m.itemKey}`)
  }
  if (monthMismatch.length) {
    console.log('  （修复方向：以条目 payload.importMonth 为准回写 itemKey 月份段，或按需清理——请确认后单独处理）')
  }
}

// 幽灵修复仅由 --fix 驱动；--mark-imported 只反向补标、不动幽灵
if (!FIX || !ghosts.length) {
  if (!TRACE) {
    console.log(ghosts.length ? '\n以上为诊断结果（只读）。修复执行：node ... --fix（清幽灵标记）或 --fix --backfill（补建回访记录）' : '\n无幽灵标记，无需修复。')
  }
  if (!MARK_IMPORTED) {
    db.close()
    process.exit(0)
  }
}

// ── 修复 ──
if (FIX) {if (BACKFILL) {
  // 反向补建：为每个幽灵标记建一条预导入态回访记录（身份键沿用 stableVisitRecordId 口径由
  // 运行时导入链处理，这里直接按 meta 现有形态补 id=哈希不可得 → 用 dispatch key 派生 id 保持唯一）
  const now = new Date().toISOString()
  const nextRecords = [...visitRecords]
  let created = 0
  for (const g of ghosts) {
    const id = 'visit-backfill-' + Buffer.from([g.importMonth, g.productName, g.customerName].join('\0')).toString('base64url').slice(0, 20)
    if (nextRecords.some((r) => r.id === id)) continue
    nextRecords.push({
      id,
      visitMonth: g.importMonth,
      importMonth: g.importMonth,
      productName: g.productName,
      customerName: g.customerName,
      customerCode: '',
      groupName: '',
      loginAccountName: '',
      originalTicketId: '',
      feedbackSummary: '',
      userFeedbackText: '',
      assigneeName: '',
      scoreSource: '',
      ratingText: '',
      userInfo: g.customerName,
      userInfoDetail: g.customerName,
      visitResult: '',
      visitFeedbackDetail: '',
      internalConclusion: '',
      internalEvaluationDetail: '',
      evaluationSubmitted: false,
      remark: '',
      jiraId: '',
      dispatchBackfillAt: now,
      updatedAt: now,
    })
    created += 1
  }
  if (created) {
    const result = db
      .prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('post_use_visit_records_v1', ?)",
      )
      .run(JSON.stringify({ version: 1, updatedAt: now, records: nextRecords }))
    if (!result.changes) {
      console.error('回写 meta 失败（changes=0）——中止，数据未落库。')
      db.close()
      process.exit(1)
    }
  }
  console.log(`\n已补建回访记录 ${created} 条（待评估态，回访结果等待导入补充）。`)
} else {
  const del = db.prepare('DELETE FROM post_use_visit_dispatch WHERE item_key = ?')
  let removed = 0
  const tx = db.transaction(() => {
    for (const g of ghosts) {
      if (del.run(g.itemKey).changes) removed += 1
    }
  })
  tx()
  console.log(`\n已删除幽灵标记 ${removed} 条（清单恢复勾选模式，可重新勾选导出——新逻辑会预导入写入）。`)
}
} // FIX 块结束

// ── --mark-imported：反向补标（2026-11-10 部署环境确认需求）──
// 场景：回访结果由整表导入（未走弹窗勾选导出）→ 库内有记录但弹窗不显示"已纳入"，
// 已回访客户在清单中仍可被勾选重复安排。反向补标：为库内已有回访记录的身份创建
// dispatch 标记（弹窗 isDispatched 读该表）→ 已回访行显示已纳入、不再进导出收集范围。
// 客户段优先用客户编码（与弹窗行 itemKey 构造同源——collectFollowupExportRows 用编码）。
if (MARK_IMPORTED) {
  const now = new Date().toISOString()
  const existingKeys = new Set(dispatches.map((d) => d.itemKey))
  const ins = db.prepare(
    'INSERT OR IGNORE INTO post_use_visit_dispatch (item_key, source_type, dispatched_via, dispatched_at, payload) VALUES (?,?,?,?,?)',
  )
  let marked = 0
  const skipped = []
  const tx = db.transaction(() => {
    for (const r of visitRecords) {
      const month = String(r.importMonth || r.visitMonth || '').trim()
      const productName = String(r.productName || '').trim()
      const customer = String(r.customerCode || r.customerName || '').trim()
      if (!month || !productName || !customer) continue
      const itemKey = `q:${customer}:${productName}:${month}`
      if (existingKeys.has(itemKey)) continue
      const result = ins.run(
        itemKey,
        String(r.sourceType || 'questionnaire'),
        'import_backfill',
        now,
        JSON.stringify({
          customerName: String(r.customerName || ''),
          productName,
          importMonth: month,
        }),
      )
      if (result.changes) {
        marked += 1
        existingKeys.add(itemKey)
      } else {
        skipped.push(itemKey)
      }
    }
  })
  tx()
  console.log(`\n反向补标：已为库内回访记录创建 dispatch 标记 ${marked} 条（弹窗将显示已纳入）。`)
  if (skipped.length) console.log(`已存在跳过 ${skipped.length} 条。`)
  console.log('注意：标记 via=import_backfill 可识别本批补标；若误标可按该来源清理。')
}

db.close()
