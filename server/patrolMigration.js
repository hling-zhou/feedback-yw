/**
 * API 巡检种子 migration（docs/DESIGN-API巡检.md §2.5）。
 * 惯例对齐 migrate_builtin_journeys_v2：启动检查标记 → 无则灌入 → 打标记；幂等。
 * 由 businessDb.initBusinessSchema 末尾调用（本地/部署环境自动生效）。
 */
import { API_PATROL_API_REGISTRY_SEED, API_PATROL_ROOT_CAUSE_RULES_SEED } from './patrolSeeds.js'

const MIGRATION_KEY = 'migrate_api_patrol_seeds_v1'
const REGISTRY_META_KEY = 'api_patrol_api_registry_v1'
const RULES_META_KEY = 'api_patrol_root_cause_rules_v1'
const UNREGISTERED_META_KEY = 'api_patrol_unregistered_apis_v1'

/**
 * @param {import('better-sqlite3').Database} db
 */
export function migrateApiPatrolSeeds(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(MIGRATION_KEY)
  if (done) return

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
