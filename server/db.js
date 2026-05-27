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
  return db
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}
