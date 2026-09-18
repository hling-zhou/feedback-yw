import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initBusinessSchema } from './businessDb.js'
import { TEAM_MIGRATION_MAP } from '../src/domain/userProfile.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.SERVER_DATA_DIR || path.join(__dirname, 'data')
const DB_PATH = process.env.AUTH_DATABASE_PATH || path.join(DATA_DIR, 'auth.db')

/** @type {import('better-sqlite3').Database | null} */
let db = null

export function getDb() {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      team TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'viewer')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `)
  initBusinessSchema()
  migrateUsersSchema(db)
  return db
}

/** @param {import('better-sqlite3').Database} database */
function migrateUsersSchema(database) {
  const cols = database.prepare('PRAGMA table_info(users)').all()
  const colNames = new Set(cols.map((c) => c.name))

  if (!colNames.has('password_changed_at')) {
    database.exec(`ALTER TABLE users ADD COLUMN password_changed_at TEXT`)
    database
      .prepare(`UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL`)
      .run()
  }

  if (!colNames.has('session_version')) {
    database.exec(`ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`)
  }

  // 顺序要紧：migrateUserRoleConstraint 会以硬编码列清单重建 users 表，
  // 在它之前新增的列会被重建过程丢弃，故加列必须排在其后。
  migrateUserRoleConstraint(database)
  migrateMustChangePassword(database)
  migratePositionAndTeamEnum(database)
  migrateDefaultPasswordFlag(database)
}

/**
 * 标记「该账号当前使用的仍是系统统一初始密码」。
 * bcrypt 无法反比明文，只能靠这一列判断，用于首次登录改密页回显默认密码明文。
 * 存量账号一律视为非默认密码（0），仅新建/重置时由应用逻辑写入。
 *
 * @param {import('better-sqlite3').Database} database
 */
function migrateDefaultPasswordFlag(database) {
  const colNames = new Set(
    database.prepare('PRAGMA table_info(users)').all().map((c) => c.name),
  )
  if (colNames.has('password_is_default')) return
  database.exec(`ALTER TABLE users ADD COLUMN password_is_default INTEGER NOT NULL DEFAULT 0`)
}

/**
 * 新增岗位字段，并把存量班组值迁到新枚举。
 *
 * 顺序要紧：migrateUserRoleConstraint 会以硬编码列清单重建 users 表，
 * 在它之前新增的列会被重建过程丢弃，故本次加列必须排在其后。
 *
 * 幂等性：加列靠 PRAGMA 判断；班组改写靠「旧值 → 新值」定向 UPDATE，
 * 改写后旧值不再存在，重复执行自然无操作，无需额外标记表。
 *
 * @param {import('better-sqlite3').Database} database
 */
function migratePositionAndTeamEnum(database) {
  const colNames = new Set(
    database.prepare('PRAGMA table_info(users)').all().map((c) => c.name),
  )
  if (!colNames.has('position')) {
    database.exec(`ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT ''`)
  }

  const update = database.prepare(`UPDATE users SET team = ? WHERE team = ?`)
  for (const [legacy, mapped] of Object.entries(TEAM_MIGRATION_MAP)) {
    if (legacy === mapped) continue
    update.run(mapped, legacy)
  }
}

/**
 * 首次登录强制改密。仅在列首次建立时回填一次存量账号：
 * 把「审计日志中查不到 auth.login 记录」的账号标记为须改密，即创建后从未成功登录过的账号。
 * 回填只跑一次，避免改密后尚未重新登录的账号在下次启动时被重新标记。
 *
 * @param {import('better-sqlite3').Database} database
 */
function migrateMustChangePassword(database) {
  const colNames = new Set(
    database.prepare('PRAGMA table_info(users)').all().map((c) => c.name),
  )
  if (colNames.has('must_change_password')) return

  database.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`)

  const auditTable = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'")
    .get()
  if (!auditTable) return

  database
    .prepare(
      `UPDATE users SET must_change_password = 1
       WHERE NOT EXISTS (
         SELECT 1 FROM audit_log
         WHERE audit_log.action = 'auth.login'
           AND (audit_log.user_id = users.id OR audit_log.username = users.username)
       )`,
    )
    .run()
}

/** @param {import('better-sqlite3').Database} database */
function migrateUserRoleConstraint(database) {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get()
  if (!row?.sql || String(row.sql).includes('partial_editor')) return

  database.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      team TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'partial_editor', 'viewer')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      password_changed_at TEXT,
      session_version INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO users_new (
      id, username, password_hash, team, role, status,
      created_at, updated_at, password_changed_at, session_version
    )
    SELECT
      id, username, password_hash, team, role, status,
      created_at, updated_at, password_changed_at, COALESCE(session_version, 0)
    FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    COMMIT;
  `)
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}
