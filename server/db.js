import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initBusinessSchema } from './businessDb.js'

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

  migrateUserRoleConstraint(database)
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
