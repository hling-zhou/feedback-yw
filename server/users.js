import { randomId } from '../src/lib/randomId.js'
import bcrypt from 'bcryptjs'
import { validatePasswordPolicy } from '../src/domain/passwordPolicy.js'
import { resolveAdminInitialPassword } from './config.js'
import { getDb } from './db.js'
import { isPasswordExpired } from '../src/domain/passwordExpiry.js'

const BCRYPT_ROUNDS = 12

/**
 * @param {string} password
 */
function assertPasswordPolicy(password) {
  const result = validatePasswordPolicy(password)
  if (!result.ok) throw new Error(result.message)
}

/**
 * @typedef {Object} UserRow
 * @property {string} id
 * @property {string} username
 * @property {string} password_hash
 * @property {string} team
 * @property {'admin' | 'editor' | 'partial_editor' | 'viewer'} role
 * @property {'active' | 'disabled'} status
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} [password_changed_at]
 * @property {number} [session_version]
 */

/**
 * @param {UserRow} row
 * @param {Date} [now]
 */
export function toPublicUser(row, now = new Date()) {
  const passwordChangedAt = row.password_changed_at || row.created_at || ''
  return {
    id: row.id,
    username: row.username,
    team: row.team,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passwordChangedAt,
    passwordExpired: isPasswordExpired(passwordChangedAt, now),
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

/**
 * 递增 session_version，使已签发的 JWT 全部失效。
 *
 * @param {string} userId
 * @returns {number} 新的 session_version
 */
export function invalidateUserSessions(userId) {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE users SET session_version = COALESCE(session_version, 0) + 1, updated_at = ? WHERE id = ?`,
    )
    .run(now, userId)
  const row = findUserById(userId)
  return row?.session_version ?? 0
}

/**
 * @param {UserRow} row
 * @returns {number}
 */
export function resolveSessionVersion(row) {
  const n = Number(row.session_version)
  return Number.isFinite(n) && n >= 0 ? n : 0
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
 * 测试 / 运维：直接调整密码变更时间以验证定期策略。
 *
 * @param {string} id
 * @param {string} passwordChangedAt - ISO 8601
 */
export function setPasswordChangedAt(id, passwordChangedAt) {
  const row = findUserById(id)
  if (!row) throw new Error('用户不存在')
  const now = new Date().toISOString()
  getDb()
    .prepare(`UPDATE users SET password_changed_at = ?, updated_at = ? WHERE id = ?`)
    .run(passwordChangedAt, now, id)
}

/**
 * @param {Object} input
 * @param {string} input.username
 * @param {string} input.password
 * @param {string} input.team
 * @param {'admin' | 'editor' | 'partial_editor' | 'viewer'} input.role
 */
export async function createUser(input) {
  const username = input.username.trim()
  if (!username) throw new Error('用户名不能为空')
  if (findUserByUsername(username)) throw new Error('用户名已存在')
  assertPasswordPolicy(input.password)

  const now = new Date().toISOString()
  const id = randomId()
  const password_hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
  const db = getDb()
  db.prepare(
    `INSERT INTO users
      (id, username, password_hash, team, role, status, created_at, updated_at, password_changed_at, session_version)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 0)`,
  ).run(id, username, password_hash, input.team.trim(), input.role, now, now, now)
  const row = findUserById(id)
  if (!row) throw new Error('创建用户失败')
  return toPublicUser(row)
}

/**
 * @param {string} id
 * @param {Object} patch
 * @param {string} [patch.team]
 * @param {'admin' | 'editor' | 'partial_editor' | 'viewer'} [patch.role]
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
  let password_changed_at = row.password_changed_at || row.created_at
  const now = new Date().toISOString()
  let sessionBump = false

  if (patch.password) {
    assertPasswordPolicy(patch.password)
    password_hash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS)
    password_changed_at = now
    sessionBump = true
  }
  if (patch.status === 'disabled' && row.status !== 'disabled') {
    sessionBump = true
  }
  if (patch.role && patch.role !== row.role) {
    sessionBump = true
  }

  getDb()
    .prepare(
      `UPDATE users SET team = ?, role = ?, status = ?, password_hash = ?,
        updated_at = ?, password_changed_at = ?,
        session_version = COALESCE(session_version, 0) + ? WHERE id = ?`,
    )
    .run(team, role, status, password_hash, now, password_changed_at, sessionBump ? 1 : 0, id)

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
 * @returns {Promise<{ user: ReturnType<typeof toPublicUser>; row: UserRow } | null>}
 */
export async function verifyPasswordCredentials(username, password) {
  const row = findUserByUsername(username)
  if (!row || row.status !== 'active') return null
  const ok = await bcrypt.compare(password, row.password_hash)
  if (!ok) return null
  return { user: toPublicUser(row), row, sessionVersion: resolveSessionVersion(row) }
}

/**
 * @param {string} username
 * @param {string} password
 */
export async function verifyPassword(username, password) {
  const result = await verifyPasswordCredentials(username, password)
  return result?.user ?? null
}

/**
 * 凭当前密码修改为新密码（无需登录态；过期与主动修改均走此接口）。
 *
 * @param {Object} input
 * @param {string} input.username
 * @param {string} input.currentPassword
 * @param {string} input.newPassword
 * @returns {Promise<{ user: ReturnType<typeof toPublicUser>; wasExpired: boolean }>}
 */
export async function changePasswordWithVerification(input) {
  const username = input.username?.trim()
  const currentPassword = input.currentPassword ?? ''
  const newPassword = input.newPassword ?? ''
  if (!username || !currentPassword || !newPassword) {
    throw new Error('请填写用户名、当前密码和新密码')
  }
  if (currentPassword === newPassword) {
    throw new Error('新密码不能与当前密码相同')
  }
  assertPasswordPolicy(newPassword)

  const verified = await verifyPasswordCredentials(username, currentPassword)
  if (!verified) throw new Error('用户名或当前密码错误')

  const passwordChangedAt = verified.row.password_changed_at || verified.row.created_at
  const wasExpired = isPasswordExpired(passwordChangedAt)

  const now = new Date().toISOString()
  const password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  getDb()
    .prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?,
        session_version = COALESCE(session_version, 0) + 1 WHERE id = ?`,
    )
    .run(password_hash, now, now, verified.row.id)

  const updated = findUserById(verified.row.id)
  if (!updated) throw new Error('更新失败')
  return { user: toPublicUser(updated), wasExpired }
}

/** @deprecated 使用 changePasswordWithVerification */
export async function changeExpiredPassword(input) {
  const { user } = await changePasswordWithVerification(input)
  return user
}

/**
 * @param {Object[]} items
 * @param {string} items[].username
 * @param {string} items[].password
 * @param {string} items[].team
 * @param {'admin' | 'editor' | 'partial_editor' | 'viewer'} items[].role
 */
export async function batchCreateUsers(items) {
  /** @type {ReturnType<typeof toPublicUser>[]} */
  const created = []
  /** @type {{ row: number; username: string; message: string }[]} */
  const errors = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    try {
      const user = await createUser({
        username: item.username,
        password: item.password,
        team: item.team,
        role: item.role,
      })
      created.push(user)
    } catch (err) {
      errors.push({
        row: i + 1,
        username: String(item.username ?? '').trim(),
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { created, errors }
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
