import bcrypt from 'bcryptjs'
import { resolveAdminInitialPassword } from './config.js'
import { getDb } from './db.js'

const BCRYPT_ROUNDS = 12

/**
 * @typedef {Object} UserRow
 * @property {string} id
 * @property {string} username
 * @property {string} password_hash
 * @property {string} team
 * @property {'admin' | 'editor' | 'viewer'} role
 * @property {'active' | 'disabled'} status
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @param {UserRow} row
 */
export function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    team: row.team,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * @param {string} username
 */
export function findUserByUsername(username) {
  const db = getDb()
  return /** @type {UserRow | undefined} */ (
    db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1')
      .get(username.trim())
  )
}

/**
 * @param {string} id
 */
export function findUserById(id) {
  const db = getDb()
  return /** @type {UserRow | undefined} */ (
    db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(id)
  )
}

export function listUsers() {
  const db = getDb()
  return /** @type {UserRow[]} */ (
    db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE ASC').all()
  )
}

export function countAdmins() {
  const db = getDb()
  return /** @type {number} */ (
    db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'").get()
      .c
  )
}

/**
 * @param {Object} input
 * @param {string} input.username
 * @param {string} input.password
 * @param {string} input.team
 * @param {'admin' | 'editor' | 'viewer'} input.role
 */
export async function createUser(input) {
  const username = input.username.trim()
  if (!username) throw new Error('用户名不能为空')
  if (findUserByUsername(username)) throw new Error('用户名已存在')

  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const password_hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
  const db = getDb()
  db.prepare(
    `INSERT INTO users (id, username, password_hash, team, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, username, password_hash, input.team.trim(), input.role, now, now)
  const row = findUserById(id)
  if (!row) throw new Error('创建用户失败')
  return toPublicUser(row)
}

/**
 * @param {string} id
 * @param {Object} patch
 * @param {string} [patch.team]
 * @param {'admin' | 'editor' | 'viewer'} [patch.role]
 * @param {'active' | 'disabled'} [patch.status]
 * @param {string} [patch.password]
 * @param {string} [actorId]
 */
export async function updateUser(id, patch, actorId) {
  const row = findUserById(id)
  if (!row) throw new Error('用户不存在')

  if (patch.status === 'disabled' && actorId && actorId === id) {
    throw new Error('不能禁用自己的账号')
  }

  if (patch.role && patch.role !== 'admin' && row.role === 'admin') {
    const admins = countAdmins()
    if (admins <= 1) throw new Error('至少保留一名活跃管理员')
  }

  if (patch.status === 'disabled' && row.role === 'admin') {
    const admins = countAdmins()
    if (admins <= 1) throw new Error('不能禁用最后一名管理员')
  }

  const team = patch.team !== undefined ? patch.team.trim() : row.team
  const role = patch.role ?? row.role
  const status = patch.status ?? row.status
  let password_hash = row.password_hash
  if (patch.password) {
    password_hash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS)
  }

  const now = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE users SET team = ?, role = ?, status = ?, password_hash = ?, updated_at = ? WHERE id = ?`,
    )
    .run(team, role, status, password_hash, now, id)

  const updated = findUserById(id)
  if (!updated) throw new Error('更新失败')
  return toPublicUser(updated)
}

/**
 * @param {string} id
 * @param {string} [actorId]
 */
export function deleteUser(id, actorId) {
  if (actorId && actorId === id) throw new Error('不能删除当前登录用户')
  const row = findUserById(id)
  if (!row) throw new Error('用户不存在')
  if (row.role === 'admin' && countAdmins() <= 1) {
    throw new Error('至少保留一名管理员')
  }
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id)
}

/**
 * @param {string} username
 * @param {string} password
 */
export async function verifyPassword(username, password) {
  const row = findUserByUsername(username)
  if (!row || row.status !== 'active') return null
  const ok = await bcrypt.compare(password, row.password_hash)
  if (!ok) return null
  return toPublicUser(row)
}

/** 空库时创建首个管理员；须已通过 resolveAdminInitialPassword 校验 */
export async function seedAdminUser() {
  const existing = listUsers()
  if (existing.length > 0) return null
  const password = resolveAdminInitialPassword()
  const user = await createUser({
    username: process.env.ADMIN_INITIAL_USERNAME?.trim() || 'admin',
    password,
    team: process.env.ADMIN_INITIAL_TEAM || '系统管理',
    role: 'admin',
  })
  console.info(`[auth] 已创建初始管理员：${user.username}`)
  return user
}
