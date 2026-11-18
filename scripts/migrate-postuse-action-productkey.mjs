/**
 * 一次性迁移脚本：post_use 举措 product_key 中文名 → 目录 key（11-18 拍板 A+B+C 之 C）
 *
 * 背景：历史写入口（postUseActionService 新建 / postUseJiraRepository 导入）把溯源/
 * 回访记录的中文名直接塞进 action_items.product_key（如「云专线」而非 dc），与举措库
 * 按目录 key 匹配的查询口径（/api/actions?productKey=）错位。写入口已修正（11-18），
 * 本脚本把存量中文 product_key 归位为目录 key。
 *
 * 迁移规则：
 *   action_items 中 source='post_use' 且 product_key 命中目录（名称/规格/别名）的行：
 *   product_key 改为目录 key；payload.productKey 同步（payload 是真源，列是查询投影）。
 *   未命中目录的行不动（保留旧形态兜底，不猜测映射）。其他 source 不动。
 *
 * 幂等：已是目录 key 的行自动跳过；重复执行终态输出「拟变更 0 条」= 迁移完成。
 *
 * 用法：
 *   node scripts/migrate-postuse-action-productkey.mjs [--dry-run]
 *   FEEDBACK_DB=/path/to/auth.db node scripts/migrate-postuse-action-productkey.mjs
 *
 * 目录来源 = meta.product_catalog_managed_v1（产品目录真源）；正式执行只在存在
 * 实际变更时备份 DB，且不覆盖已有备份；变更在单事务内执行，任一失败整体回滚。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync } from 'node:fs'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.FEEDBACK_DB || path.resolve(__dirname, '../server/data/auth.db')

const dryRun = process.argv.includes('--dry-run')

/** 目录 key 全集（小写比较——目录 key 形态如 vpc / shared_bw / CloudDNS 混有大小写） */
function loadCatalogKeySet(db) {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'product_catalog_managed_v1'`).get()
  if (!row?.value) throw new Error('meta.product_catalog_managed_v1 不存在——先在设置页初始化产品目录')
  /** @type {{ products?: Array<{ key?: string, name?: string, specs?: Array<{ name?: string, match?: string[] }> }> }} */
  let snap
  try {
    snap = JSON.parse(row.value)
  } catch {
    throw new Error('meta.product_catalog_managed_v1 不是合法 JSON')
  }
  /** @type {Map<string, string>} 归一化标识(key/name/spec/match) → 目录 key */
  const map = new Map()
  const put = (label, key) => {
    const norm = String(label || '').trim().toLowerCase()
    if (norm && key && !map.has(norm)) map.set(norm, String(key).trim())
  }
  for (const product of snap.products || []) {
    put(product.key, product.key)
    put(product.name, product.key)
    for (const spec of product.specs || []) {
      put(spec.name, product.key)
      for (const alias of spec.match || []) put(alias, product.key)
    }
  }
  return map
}

function main() {
  const db = new Database(DB_PATH)
  try {
    console.log(`数据库: ${DB_PATH}`)
    if (dryRun) console.log('[DRY RUN] 只扫描不写入\n')

    const catalog = loadCatalogKeySet(db)
    const rows = db
      .prepare(`SELECT id, product_key FROM action_items WHERE source = 'post_use'`)
      .all()

    /** @type {Array<{ id: string, oldKey: string, newKey: string }>} */
    const planned = []
    /** @type {Array<{ id: string, key: string, reason: string }>} */
    const skipped = []
    for (const row of rows) {
      const oldKey = String(row.product_key || '').trim()
      const norm = oldKey.toLowerCase()
      if (!oldKey) {
        skipped.push({ id: row.id, key: oldKey, reason: 'product_key 为空' })
        continue
      }
      if (!catalog.has(norm)) {
        skipped.push({ id: row.id, key: oldKey, reason: '未命中目录（保留旧形态兜底）' })
        continue
      }
      const newKey = catalog.get(norm)
      if (newKey === oldKey) continue // 已是目录 key，幂等跳过
      planned.push({ id: row.id, oldKey, newKey })
    }

    console.log(`post_use 举措共 ${rows.length} 行`)
    console.log(`拟变更 ${planned.length} 条`)
    for (const p of planned) console.log(`  ${p.id}: ${p.oldKey} → ${p.newKey}`)
    if (skipped.length) {
      console.log(`\n不动 ${skipped.length} 条:`)
      for (const s of skipped) console.log(`  ${s.id}: ${s.key}（${s.reason}）`)
    }

    if (dryRun) {
      console.log('\n[DRY RUN] 以上为将要执行的变更，未写入。确认无误后去掉 --dry-run 执行。')
      return
    }
    if (!planned.length) {
      console.log('\n无可变更条目（已迁移完成或全部属兜底保留），数据库未改动。')
      return
    }

    // ---- 备份（存在实际变更才备份；不覆盖已有备份，保留最早迁移前状态供回滚）----
    const backupPath = `${DB_PATH}.pre-postuse-actionkey-migration.bak`
    if (existsSync(backupPath)) {
      console.log(`\n备份已存在、不覆盖: ${backupPath}`)
    } else {
      copyFileSync(DB_PATH, backupPath)
      console.log(`\n已备份: ${backupPath}`)
    }

    // ---- 执行（单事务；payload.productKey 真源 + product_key 列双写，任一失败整体回滚）----
    const readStmt = db.prepare(`SELECT payload FROM action_items WHERE id = ?`)
    const writeStmt = db.prepare(
      `UPDATE action_items SET product_key = ?, payload = ? WHERE id = ?`,
    )
    const tx = db.transaction(() => {
      for (const p of planned) {
        const row = readStmt.get(p.id)
        if (!row) throw new Error(`行不存在: ${p.id}`)
        /** @type {Record<string, unknown>} */
        const payload = JSON.parse(row.payload)
        const next = { ...payload, productKey: p.newKey }
        const result = writeStmt.run(p.newKey, JSON.stringify(next), p.id)
        if (!result.changes) throw new Error(`更新失败（changes=0）: ${p.id}`)
      }
    })
    tx()

    console.log(`\n迁移完成：${planned.length} 条 product_key 已归位目录 key；${skipped.length} 条保留（兜底）。`)
  } finally {
    db.close()
  }
}

main()
