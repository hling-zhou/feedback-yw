/**
 * API 巡检种子 migration（docs/DESIGN-API巡检.md §2.5）。
 * 惯例对齐 migrate_builtin_journeys_v2：启动检查标记 → 无则灌入 → 打标记；幂等。
 * 由 businessDb.initBusinessSchema 末尾调用（本地/部署环境自动生效）。
 */
import { API_PATROL_API_REGISTRY_SEED, API_PATROL_ROOT_CAUSE_RULES_SEED } from './patrolSeeds.js'

const MIGRATION_KEY = 'migrate_api_patrol_seeds_v1'
const MIGRATION_KEY_V2 = 'migrate_api_patrol_seeds_v2'
const MIGRATION_KEY_V3 = 'migrate_api_patrol_seeds_v3_l1_ampersand'
const REGISTRY_META_KEY = 'api_patrol_api_registry_v1'
const RULES_META_KEY = 'api_patrol_root_cause_rules_v1'
const UNREGISTERED_META_KEY = 'api_patrol_unregistered_apis_v1'

/**
 * v4 升级（11-25 13:21 拍板）：规则表追加 order 1.5「网段与路由冲突」（#115 误命中修复）。
 * v2 标记模式放走后增 order——v4 按 order 判重裸跑（存量有 1.5 则零追加，幂等）。
 * @param {import('better-sqlite3').Database} db
 */
function appendSdnRouteRuleV4(db) {
  const seed = API_PATROL_ROOT_CAUSE_RULES_SEED.find((r) => Number(r.order) === 1.5)
  if (!seed) return
  const raw = db.prepare('SELECT value FROM meta WHERE key = ?').get(RULES_META_KEY)
  if (!raw) return
  try {
    const obj = JSON.parse(String(raw.value))
    const items = Array.isArray(obj.items) ? obj.items : []
    if (items.some((r) => Number(r?.order) === 1.5)) return
    items.push({ ...seed })
    items.sort((a, b) => Number(a?.order) - Number(b?.order))
    obj.updatedAt = new Date().toISOString()
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(RULES_META_KEY, JSON.stringify(obj))
  } catch { /* 规则表损坏不动（分类器有兜底） */ }
}

/**
 * v3 升级（11-25 11:28 拍板）：L1 值内部分隔符 / → &（与 L1/L2 层级分隔消歧义）。
 * 四值改名：参数无效/校验失败、权限/授权不足、资源锁定/并发冲突、其他/未归类。
 * 覆盖三处存量：groups.root_cause_l1、diagnoses.root_cause_l1、meta 规则表行 l1。
 * **无标记裸跑**（11-25 红绿教训）：值级替换 WHERE 旧值不匹配=0 变更，天然幂等；
 * 标记跳过模式反而有「标记先于旧值入库被打上→旧值永驻」时序风险（测试重放实证：
 * init#1 空库打标记计数 0，init#2 旧值灌入后被跳过）。每次启动跑一遍，成本三次 UPDATE。
 * @param {import('better-sqlite3').Database} db
 */
function upgradeL1AmpersandV3(db) {
  const renames = [
    ['参数无效/校验失败', '参数无效&校验失败'],
    ['权限/授权不足', '权限&授权不足'],
    ['资源锁定/并发冲突', '资源锁定&并发冲突'],
    ['其他/未归类', '其他&未归类'],
  ]
  const updGroups = db.prepare('UPDATE api_patrol_failure_groups SET root_cause_l1=? WHERE root_cause_l1=?')
  const updDiag = db.prepare('UPDATE api_patrol_diagnoses SET root_cause_l1=? WHERE root_cause_l1=?')
  let groups = 0, diagnoses = 0, rules = 0
  db.transaction(() => {
    for (const [from, to] of renames) {
      groups += updGroups.run(to, from).changes
      diagnoses += updDiag.run(to, from).changes
    }
    const raw = db.prepare('SELECT value FROM meta WHERE key = ?').get(RULES_META_KEY)
    if (raw) {
      try {
        const obj = JSON.parse(String(raw.value))
        for (const item of (obj.items || [])) {
          if (typeof item.l1 === 'string' && item.l1.includes('/')) {
            const fixed = renames.reduce((s, [from, to]) => s.replaceAll(from, to), item.l1)
            if (fixed !== item.l1) { item.l1 = fixed; rules += 1 }
          }
        }
        if (rules > 0) {
          db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(RULES_META_KEY, JSON.stringify(obj))
        }
      } catch { /* 规则表损坏不动（分类器有兜底） */ }
    }
  })()
  if (groups + diagnoses + rules > 0) {
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      MIGRATION_KEY_V3,
      JSON.stringify({ migratedAt: new Date().toISOString(), groups, diagnoses, rules }),
    )
  }
}

/**
 * v2 升级（11-18）：存量库规则表追加新种子规则（按 order 判重）。
 * 背景：#288 真实链路实证 RAM 鉴权拒绝组被接口名规则误归「业务冲突」——
 * 新增类目「权限&授权不足」+ order 23 规则须进存量库（v1 标记已打、旧 migration 不再触发）。
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
  // v3：L1 值 / → & 分隔符改名（组表/诊断表/规则表三处存量，幂等标记）
  upgradeL1AmpersandV3(db)
  // v4：规则表追加 order 1.5 网段与路由冲突（v2 标记模式放走后增 order 的补丁）
  appendSdnRouteRuleV4(db)
}
