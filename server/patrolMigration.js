/**
 * API 巡检种子 migration（docs/DESIGN-API巡检.md §2.5）。
 * 惯例对齐 migrate_builtin_journeys_v2：启动检查标记 → 无则灌入 → 打标记；幂等。
 * 由 businessDb.initBusinessSchema 末尾调用（本地/部署环境自动生效）。
 */
import { API_PATROL_API_REGISTRY_SEED, API_PATROL_ROOT_CAUSE_RULES_SEED } from './patrolSeeds.js'

const MIGRATION_KEY = 'migrate_api_patrol_seeds_v1'
const MIGRATION_KEY_V2 = 'migrate_api_patrol_seeds_v2'
const REGISTRY_META_KEY = 'api_patrol_api_registry_v1'
const RULES_META_KEY = 'api_patrol_root_cause_rules_v1'
const UNREGISTERED_META_KEY = 'api_patrol_unregistered_apis_v1'

/**
 * v2 升级（11-18）：存量库规则表追加新种子规则（按 order 判重）。
 * 背景：#288 真实链路实证 RAM 鉴权拒绝组被接口名规则误归「业务冲突」——
 * 新增类目「权限/授权不足」+ order 23 规则须进存量库（v1 标记已打、旧 migration 不再触发）。
 * 只追加缺失 order 的种子行，运营已改/已删的同 order 行不动（尊重运营编辑）。
 * @param {import('better-sqlite3').Database} db
 */
function upgradeRulesToV2(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(MIGRATION_KEY_V2)
  if (done) return
  const raw = db.prepare('SELECT value FROM meta WHERE key = ?').get(RULES_META_KEY)
  let items = []
  try { items = raw ? (JSON.parse(String(raw.value)).items || []) : [] } catch { items = [] }
  const existingOrders = new Set(items.map((r) => Number(r?.order)))
  const appended = []
  for (const seed of API_PATROL_ROOT_CAUSE_RULES_SEED) {
    if (!existingOrders.has(Number(seed.order))) {
      items.push({ ...seed })
      appended.push(Number(seed.order))
    }
  }
  // 兜底规则恒置末位（order 排序消费方依赖——分类器先非兜底后兜底）
  items.sort((a, b) => Number(a.order) - Number(b.order))
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    RULES_META_KEY,
    JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), items }),
  )
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    MIGRATION_KEY_V2,
    JSON.stringify({ migratedAt: new Date().toISOString(), appendedOrders: appended }),
  )
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function migrateApiPatrolSeeds(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(MIGRATION_KEY)
  if (!done) {
    const upsertMeta = db.prepare(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    )
    const now = new Date().toISOString()

    upsertMeta.run(
      REGISTRY_META_KEY,
      JSON.stringify({ version: 1, updatedAt: now, items: API_PATROL_API_REGISTRY_SEED }),
    )
    upsertMeta.run(
      RULES_META_KEY,
      JSON.stringify({ version: 1, updatedAt: now, items: API_PATROL_ROOT_CAUSE_RULES_SEED }),
    )
    upsertMeta.run(UNREGISTERED_META_KEY, JSON.stringify({ version: 1, updatedAt: now, items: [] }))

    upsertMeta.run(
      MIGRATION_KEY,
      JSON.stringify({ migratedAt: now, registryCount: API_PATROL_API_REGISTRY_SEED.length, rulesCount: API_PATROL_ROOT_CAUSE_RULES_SEED.length }),
    )
  }
  // v2：存量库规则表升级（新库 v1 已含新种子时 v2 幂等跳过——按 order 判重）
  upgradeRulesToV2(db)
}
