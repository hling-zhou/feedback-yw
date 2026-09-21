import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.SERVER_DATA_DIR || path.join(__dirname, 'data')
const USAGE_DB_PATH = process.env.USAGE_DATABASE_PATH || path.join(DATA_DIR, 'usage.db')

/** @type {import('better-sqlite3').Database | null} */
let usageDb = null

export function getUsageDb() {
  if (usageDb) return usageDb
  fs.mkdirSync(DATA_DIR, { recursive: true })
  usageDb = new Database(USAGE_DB_PATH)
  usageDb.pragma('journal_mode = WAL')
  usageDb.pragma('synchronous = NORMAL')
  usageDb.exec(`
    -- 原始记录表（仅保留当月明细，历史月份按月归档到 usage_monthly）
    CREATE TABLE IF NOT EXISTS usage_stats (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT NOT NULL,
      team TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      module TEXT NOT NULL,
      page TEXT NOT NULL DEFAULT '',
      params_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_stats_created_module ON usage_stats(created_at, module);
    CREATE INDEX IF NOT EXISTS idx_usage_stats_user ON usage_stats(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_stats_team ON usage_stats(team, created_at);

    -- 按月聚合归档表
    CREATE TABLE IF NOT EXISTS usage_monthly (
      month TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      team TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      module TEXT NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (month, user_id, module)
    );
    CREATE INDEX IF NOT EXISTS idx_usage_monthly_month ON usage_monthly(month);
    CREATE INDEX IF NOT EXISTS idx_usage_monthly_team ON usage_monthly(team, month);
    CREATE INDEX IF NOT EXISTS idx_usage_monthly_module ON usage_monthly(module, month);
  `)
  return usageDb
}

/**
 * 把上月（及更早）的原始记录聚合到 usage_monthly，然后删除原始记录。
 * 在服务器启动时调用。
 */
export function archiveUsageStats() {
  const db = getUsageDb()
  const now = new Date()
  // 当月 = YYYY-MM
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // 查出所有非当月的记录
  const staleRows = db
    .prepare(
      `SELECT user_id, username, team, role, module, substr(created_at, 1, 7) AS month, COUNT(*) AS visit_count
       FROM usage_stats
       WHERE substr(created_at, 1, 7) < ?
       GROUP BY user_id, username, team, role, module, month`,
    )
    .all(currentMonth)

  if (staleRows.length === 0) return { archived: 0, months: [] }

  const months = [...new Set(staleRows.map((r) => r.month))]

  const upsert = db.prepare(`
    INSERT INTO usage_monthly (month, user_id, username, team, role, module, visit_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(month, user_id, module) DO UPDATE SET
      visit_count = usage_monthly.visit_count + excluded.visit_count
  `)

  const deleteStmt = db.prepare(
    `DELETE FROM usage_stats WHERE substr(created_at, 1, 7) < ?`,
  )

  const tx = db.transaction(() => {
    for (const row of staleRows) {
      upsert.run(row.month, row.user_id, row.username, row.team, row.role, row.module, row.visit_count)
    }
    deleteStmt.run(currentMonth)
  })
  tx()

  console.info(`[usage] archived ${staleRows.length} groups from months: ${months.join(', ')}`)
  return { archived: staleRows.length, months }
}

/** @param {string} [month] YYYY-MM，默认当月 */
export function getUsageStatsByMonth(month) {
  const db = getUsageDb()
  const targetMonth = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  // 当月从 usage_stats 查
  const fromRaw = db
    .prepare(
      `SELECT module, user_id, username, team, role, COUNT(*) AS visit_count
       FROM usage_stats
       WHERE substr(created_at, 1, 7) = ?
       GROUP BY module, user_id, username, team, role`,
    )
    .all(targetMonth)

  // 历史月从 usage_monthly 查
  const fromArchive = db
    .prepare(
      `SELECT module, user_id, username, team, role, visit_count
       FROM usage_monthly
       WHERE month = ?`,
    )
    .all(targetMonth)

  return [...fromArchive, ...fromRaw]
}

/** 查询所有可用月份 */
export function getUsageMonths() {
  const db = getUsageDb()
  const archiveMonths = db
    .prepare('SELECT DISTINCT month FROM usage_monthly ORDER BY month DESC')
    .all()
  const rawMonths = db
    .prepare('SELECT DISTINCT substr(created_at, 1, 7) AS month FROM usage_stats ORDER BY month DESC')
    .all()
  const months = [...new Set([...archiveMonths.map((r) => r.month), ...rawMonths.map((r) => r.month)])]
  return months.sort().reverse()
}
