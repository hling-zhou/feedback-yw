import { randomId } from '../src/lib/randomId.js'
import bcrypt from 'bcryptjs'
import { validatePasswordPolicy } from '../src/domain/passwordPolicy.js'
import { resolveAdminInitialPassword, resolveUserInitialPassword } from './config.js'
import { getDb } from './db.js'
import { isPasswordExpired } from '../src/domain/passwordExpiry.js'
import { isKnownTeam, TEAMS } from '../src/domain/userProfile.js'

const BCRYPT_ROUNDS = 12

/**
 * @param {string} password
 */
function assertPasswordPolicy(password) {
  const result = validatePasswordPolicy(password)
  if (!result.ok) throw new Error(result.message)
}

/**
 * 班组已改为枚举，非法值直接拒绝并回传可选清单。
 *
 * @param {string} team
 */
function assertTeam(team) {
  if (!isKnownTeam(team)) {
    throw new Error(`所属班组「${team}」不在可选范围内，可填：${TEAMS.join('、')}`)
  }
}

/**
 * @typedef {Object} UserRow
 * @property {string} id
 * @property {string} username
 * @property {string} password_hash
 * @property {string} team
 * @property {string} [position]  // 已废弃，保留列但不使用
 * @property {'admin' | 'editor' | 'partial_editor' | 'viewer'} role
 * @property {'active' | 'disabled'} status
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} [password_changed_at]
 * @property {number} [session_version]
 * @property {number} [must_change_password]
 * @property {number} [password_is_default]
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
    mustChangePassword: Number(row.must_change_password) === 1,
    usesDefaultPassword: Number(row.password_is_default) === 1,
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
 * 密码留空 → 使用系统统一初始密码，并把账号标记为「仍在使用默认密码」，
 * 这样首次登录的改密页可以直接告诉用户该改的是哪一个密码。
 *
 * @param {string | undefined | null} password
 * @returns {{ password: string; isDefault: boolean }}
 */
function resolvePasswordForCreation(password) {
  const value = String(password ?? '').trim()
  if (!value) return { password: resolveUserInitialPassword(), isDefault: true }
  assertPasswordPolicy(value)
  return { password: value, isDefault: false }
}

/**
 * 判断一个密码是否就是系统统一初始密码——管理员把账号重置成默认密码时，
 * 该账号应重新带上「仍在使用默认密码」标记。
 *
 * @param {string} password
 */
function isDefaultPassword(password) {
  return password === resolveUserInitialPassword()
}

/**
 * @param {Object} input
 * @param {string} input.username
 * @param {string} [input.password] - 留空则使用系统统一初始密码
 * @param {string} input.team
 * @param {'admin' | 'editor' | 'partial_editor' | 'viewer'} input.role
 */
export async function createUser(input) {
  const username = input.username.trim()
  if (!username) throw new Error('用户名不能为空')
  if (findUserByUsername(username)) throw new Error('用户名已存在')
  const { password, isDefault } = resolvePasswordForCreation(input.password)
  assertTeam(input.team)

  const now = new Date().toISOString()
  const id = randomId()
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  const db = getDb()
  db.prepare(
    `INSERT INTO users
      (id, username, password_hash, team, role, status, created_at, updated_at,
       password_changed_at, session_version, must_change_password, password_is_default)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, 1, ?)`,
  ).run(
    id,
    username,
    password_hash,
    input.team.trim(),
    input.role,
    now,
    now,
    now,
    isDefault ? 1 : 0,
  )
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
  // 存量账号的班组可能是迁移未覆盖的历史值，仅在管理员显式改动时才校验，
  // 避免因历史脏数据导致「只改角色也保存不了」。
  if (patch.team !== undefined) assertTeam(patch.team)
  const role = patch.role ?? row.role
  const status = patch.status ?? row.status
  let password_hash = row.password_hash
  let password_changed_at = row.password_changed_at || row.created_at
  // 须改密标记不在此处改写：它只跟「是否首次登录」有关，与本次是否代设密码无关
  const mustChange = Number(row.must_change_password) === 1
  const now = new Date().toISOString()
  let sessionBump = false

  let isDefaultPasswordFlag = Number(row.password_is_default) === 1

  if (patch.password) {
    assertPasswordPolicy(patch.password)
    password_hash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS)
    password_changed_at = now
    // 是否须改密只取决于「该账号是否首次登录」，与管理员是否代设过密码无关，
    // 故此处保留原值：从未登录过的账号仍须改密，登录过的账号不受影响。
    isDefaultPasswordFlag = isDefaultPassword(patch.password)
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
        updated_at = ?, password_changed_at = ?, must_change_password = ?, password_is_default = ?,
        session_version = COALESCE(session_version, 0) + ? WHERE id = ?`,
    )
    .run(
      team,
      role,
      status,
      password_hash,
      now,
      password_changed_at,
      mustChange ? 1 : 0,
      isDefaultPasswordFlag ? 1 : 0,
      sessionBump ? 1 : 0,
      id,
    )

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
  // 改成自己的密码后，默认密码标记随之清除
  getDb()
    .prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?,
        must_change_password = 0, password_is_default = 0,
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
 * 导入时对同名用户做 upsert：已存在则只更新 team/role（不改密码、状态、改密标记、会话版本），
 * 不存在则新建。admin 保护逻辑仍生效（不能把库里唯一活跃 admin 改成非 admin）。
 *
 * @param {Object[]} items
 * @param {string} items[].username
 * @param {string} items[].password
 * @param {string} items[].team
 * @param {'admin' | 'editor' | 'partial_editor' | 'viewer'} items[].role
 */
export async function batchCreateUsers(items) {
  /** @type {ReturnType<typeof toPublicUser>[]} */
  const created = []
  /** @type {ReturnType<typeof toPublicUser>[]} */
  const updated = []
  /** @type {{ row: number; username: string; message: string }[]} */
  const errors = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    try {
      const existing = findUserByUsername(item.username)
      if (existing) {
        // 同名用户：只改 team/role，不动密码与状态
        if (item.role && item.role !== 'admin' && existing.role === 'admin') {
          const admins = countAdmins()
          if (admins <= 1) throw new Error('至少保留一名活跃管理员')
        }
        assertTeam(item.team)
        const now = new Date().toISOString()
        // 角色变化时才 bump session_version，与 updateUser 保持一致
        const roleChanged = item.role && item.role !== existing.role
        getDb()
          .prepare(
            `UPDATE users SET team = ?, role = ?, updated_at = ?,
              session_version = COALESCE(session_version, 0) + ? WHERE id = ?`,
          )
          .run(item.team.trim(), item.role, now, roleChanged ? 1 : 0, existing.id)
        const refreshed = findUserById(existing.id)
        if (!refreshed) throw new Error('更新失败')
        updated.push(toPublicUser(refreshed))
      } else {
        const user = await createUser({
          username: item.username,
          password: item.password,
          team: item.team,
          role: item.role,
        })
        created.push(user)
      }
    } catch (err) {
      errors.push({
        row: i + 1,
        username: String(item.username ?? '').trim(),
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { created, updated, errors }
}

/**
 * 批量把账号密码重置为同一个临时密码，并让这些账号的已登录会话失效。
 *
 * 注意：重置密码**不会**置 must_change_password（须改密标记）。
 * 是否须改密只由「该账号创建后是否从未成功登录过」决定：
 * 登录过的账号被重置密码后仍用新密码直接登录不再被拦；
 * 从未登录过的账号本来就带着标记，重置也不改变这一点。
 *
 * @param {string[]} ids
 * @param {string} newPassword
 */
export async function resetPasswords(ids, newPassword) {
  assertPasswordPolicy(newPassword)
  const password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  const isDefault = isDefaultPassword(newPassword)
  const now = new Date().toISOString()
  /** @type {{ id: string; username: string; mustChangePassword: boolean; usesDefaultPassword: boolean }[]} */
  const reset = []
  /** @type {{ id: string; username: string; message: string }[]} */
  const errors = []

  for (const id of ids) {
    const row = findUserById(id)
    if (!row) {
      errors.push({ id, username: '', message: '用户不存在' })
      continue
    }
    getDb()
      .prepare(
        `UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?,
          password_is_default = ?,
          session_version = COALESCE(session_version, 0) + 1 WHERE id = ?`,
      )
      .run(password_hash, now, now, isDefault ? 1 : 0, id)
    reset.push({
      id,
      username: row.username,
      mustChangePassword: Number(row.must_change_password) === 1,
      usesDefaultPassword: isDefault,
    })
  }

  return { reset, errors }
}

/** 空库时创建首个管理员；须已通过 resolveAdminInitialPassword 校验 */
export async function seedAdminUser() {
  const existing = listUsers()
  if (existing.length > 0) return null
  const password = resolveAdminInitialPassword()
  const user = await createUser({
    username: process.env.ADMIN_INITIAL_USERNAME?.trim() || 'admin',
    password,
    team: process.env.ADMIN_INITIAL_TEAM || '综合管理组',
    role: 'admin',
  })
  console.info(`[auth] 已创建初始管理员：${user.username}`)
  return user
}
