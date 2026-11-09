import { getDb } from './db.js'
import { randomId } from '../src/lib/randomId.js'
import {
  defaultMailTemplate,
  isMailDataSourceType,
  isValidEmail,
  MAIL_PRESET_CALLBACK_VISIT,
  MAIL_PRESET_IDS,
  MAIL_PRESET_REPORT,
  MAIL_PRESET_REMINDER,
  parseEmailList,
  uniqueEmails,
} from '../src/domain/mail.js'

const PUBLIC_APP_URL_KEY = 'mail_public_app_url'

function nowIso() {
  return new Date().toISOString()
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'))
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '')) : []
  } catch {
    return []
  }
}

function channelFromRow(row, { includePassword = false } = {}) {
  const password = String(row.password || '')
  return {
    id: String(row.id),
    name: String(row.name || ''),
    dataSourceType: String(row.data_source_type || ''),
    host: String(row.host || ''),
    port: Number(row.port) || 465,
    secure: Boolean(row.secure),
    username: String(row.username || ''),
    fromAddress: String(row.from_address || ''),
    hasPassword: Boolean(password),
    ...(includePassword ? { password } : {}),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

function groupFromRow(row) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    emails: uniqueEmails(parseJsonArray(row.emails_json)),
    cc: uniqueEmails(parseJsonArray(row.cc_emails_json)),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

function templateFromRow(row) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    subject: String(row.subject || ''),
    body: String(row.body || ''),
    preset: Boolean(row.preset),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export function getPublicAppUrl() {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(PUBLIC_APP_URL_KEY)
  return String(row?.value || '').trim().replace(/\/+$/, '')
}

export function setPublicAppUrl(url) {
  const value = String(url || '').trim().replace(/\/+$/, '')
  if (value && !/^https?:\/\//i.test(value)) {
    throw new Error('平台访问地址须以 http:// 或 https:// 开头')
  }
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(PUBLIC_APP_URL_KEY, value)
  return value
}

export function ensureMailDefaults() {
  const db = getDb()
  const now = nowIso()
  for (const key of MAIL_PRESET_IDS) {
    const preset = defaultMailTemplate(key)
    const existing = db.prepare('SELECT id FROM mail_templates WHERE id = ?').get(preset.id)
    if (existing) continue
    db.prepare(
      `INSERT INTO mail_templates (id, name, subject, body, preset, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).run(preset.id, preset.name, preset.subject, preset.body, now, now)
  }
}

export function listMailChannels() {
  ensureMailDefaults()
  return getDb()
    .prepare('SELECT * FROM mail_channels ORDER BY data_source_type ASC')
    .all()
    .map((row) => channelFromRow(row))
}

export function getMailChannelByDataSource(dataSourceType) {
  const row = getDb()
    .prepare('SELECT * FROM mail_channels WHERE data_source_type = ?')
    .get(dataSourceType)
  return row ? channelFromRow(row, { includePassword: true }) : null
}

/**
 * 按 id 取发信通道（含密码，发送用）——API 巡检日报配置按 channelId 选通道（2026-11-07）。
 * @param {string} id
 */
export function getMailChannelById(id) {
  const row = getDb()
    .prepare('SELECT * FROM mail_channels WHERE id = ?')
    .get(String(id || ''))
  return row ? channelFromRow(row, { includePassword: true }) : null
}

/**
 * @param {{
 *   name: string
 *   dataSourceType: string
 *   host: string
 *   port?: number
 *   secure?: boolean
 *   username?: string
 *   password?: string
 *   fromAddress: string
 * }} input
 */
export function createMailChannel(input) {
  const dataSourceType = String(input.dataSourceType || '').trim()
  if (!isMailDataSourceType(dataSourceType)) throw new Error('请选择数据来源')
  const name = String(input.name || '').trim()
  const host = String(input.host || '').trim()
  const fromAddress = String(input.fromAddress || '').trim()
  if (!name) throw new Error('请填写通道名称')
  if (!host) throw new Error('请填写 SMTP 主机')
  if (!isValidEmail(fromAddress)) throw new Error('发件人不是有效邮箱')
  const existing = getDb()
    .prepare('SELECT id FROM mail_channels WHERE data_source_type = ?')
    .get(dataSourceType)
  if (existing) throw new Error('该数据来源已有发信通道')
  // 2026-11-09 拍板：新建时授权码必填（编辑留空则保持原授权码——updateMailChannel 既有语义）。
  // 放在唯一性检查之后：同数据来源重复的场景优先报「已有发信通道」
  if (!String(input.password || '').trim()) throw new Error('请填写授权码')
  const now = nowIso()
  const id = randomId()
  const port = Number(input.port) > 0 ? Math.floor(Number(input.port)) : 465
  const secure = input.secure !== false ? 1 : 0
  getDb()
    .prepare(
      `INSERT INTO mail_channels (
        id, name, data_source_type, host, port, secure, username, password, from_address, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      dataSourceType,
      host,
      port,
      secure,
      String(input.username || '').trim(),
      String(input.password || ''),
      fromAddress,
      now,
      now,
    )
  return listMailChannels().find((item) => item.id === id)
}

/**
 * @param {string} id
 * @param {Partial<Parameters<typeof createMailChannel>[0]>} patch
 */
export function updateMailChannel(id, patch) {
  const row = getDb().prepare('SELECT * FROM mail_channels WHERE id = ?').get(id)
  if (!row) throw new Error('发信通道不存在')
  const current = channelFromRow(row, { includePassword: true })
  const dataSourceType = String(patch.dataSourceType || current.dataSourceType).trim()
  if (!isMailDataSourceType(dataSourceType)) throw new Error('请选择数据来源')
  if (dataSourceType !== current.dataSourceType) {
    const clash = getDb()
      .prepare('SELECT id FROM mail_channels WHERE data_source_type = ? AND id != ?')
      .get(dataSourceType, id)
    if (clash) throw new Error('该数据来源已有发信通道')
  }
  const name = String(patch.name ?? current.name).trim()
  const host = String(patch.host ?? current.host).trim()
  const fromAddress = String(patch.fromAddress ?? current.fromAddress).trim()
  if (!name) throw new Error('请填写通道名称')
  if (!host) throw new Error('请填写 SMTP 主机')
  if (!isValidEmail(fromAddress)) throw new Error('发件人不是有效邮箱')
  const password =
    patch.password == null || patch.password === '' ? current.password : String(patch.password)
  const port = Number(patch.port ?? current.port) > 0 ? Math.floor(Number(patch.port ?? current.port)) : 465
  const secure = patch.secure == null ? (current.secure ? 1 : 0) : patch.secure ? 1 : 0
  getDb()
    .prepare(
      `UPDATE mail_channels SET
        name = ?, data_source_type = ?, host = ?, port = ?, secure = ?, username = ?,
        password = ?, from_address = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      name,
      dataSourceType,
      host,
      port,
      secure,
      String(patch.username ?? current.username).trim(),
      password,
      fromAddress,
      nowIso(),
      id,
    )
  return listMailChannels().find((item) => item.id === id)
}

export function deleteMailChannel(id) {
  const info = getDb().prepare('DELETE FROM mail_channels WHERE id = ?').run(id)
  if (!info.changes) throw new Error('发信通道不存在')
}

export function listMailGroups() {
  ensureMailDefaults()
  return getDb()
    .prepare('SELECT * FROM mail_recipient_groups ORDER BY name ASC')
    .all()
    .map((row) => groupFromRow(row))
}

/**
 * 解析并校验群组邮箱字段（收件人/抄送人共用口径）。
 * @param {unknown} raw 请求传入的邮箱列表
 * @returns {string[]} 去重后的邮箱数组
 */
function normalizeGroupEmails(raw) {
  return uniqueEmails(parseEmailList(raw))
}

/** 逐邮箱合法性校验，返回第一个非法邮箱（无则 null） */
function findInvalidEmail(emails) {
  return emails.find((email) => !isValidEmail(email)) || null
}

export function createMailGroup(input) {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('请填写群组名称')
  const emails = normalizeGroupEmails(input.emails)
  // 2026-11-09 拍板：收件人必填非空（防建出全空群组），抄送人允许为空
  if (!emails.length) throw new Error('请至少填写一个收件人邮箱')
  const invalidTo = findInvalidEmail(emails)
  if (invalidTo) throw new Error(`「${invalidTo}」不是有效邮箱`)
  const cc = normalizeGroupEmails(input.cc)
  const invalidCc = findInvalidEmail(cc)
  if (invalidCc) throw new Error(`抄送人「${invalidCc}」不是有效邮箱`)
  const now = nowIso()
  const id = randomId()
  getDb()
    .prepare(
      `INSERT INTO mail_recipient_groups (id, name, emails_json, cc_emails_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, JSON.stringify(emails), JSON.stringify(cc), now, now)
  return listMailGroups().find((item) => item.id === id)
}

export function updateMailGroup(id, patch) {
  const row = getDb().prepare('SELECT * FROM mail_recipient_groups WHERE id = ?').get(id)
  if (!row) throw new Error('收件人群组不存在')
  const current = groupFromRow(row)
  const name = String(patch.name ?? current.name).trim()
  if (!name) throw new Error('请填写群组名称')
  // 收件人必填非空（与 createMailGroup 同口径）；cc 未传时沿用现值
  const emails = normalizeGroupEmails(patch.emails ?? current.emails)
  if (!emails.length) throw new Error('请至少填写一个收件人邮箱')
  const invalidTo = findInvalidEmail(emails)
  if (invalidTo) throw new Error(`「${invalidTo}」不是有效邮箱`)
  const cc = normalizeGroupEmails(patch.cc ?? current.cc)
  const invalidCc = findInvalidEmail(cc)
  if (invalidCc) throw new Error(`抄送人「${invalidCc}」不是有效邮箱`)
  getDb()
    .prepare(
      `UPDATE mail_recipient_groups SET name = ?, emails_json = ?, cc_emails_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(name, JSON.stringify(emails), JSON.stringify(cc), nowIso(), id)
  return listMailGroups().find((item) => item.id === id)
}

export function deleteMailGroup(id) {
  const info = getDb().prepare('DELETE FROM mail_recipient_groups WHERE id = ?').run(id)
  if (!info.changes) throw new Error('收件人群组不存在')
}

export function listMailTemplates() {
  ensureMailDefaults()
  return getDb()
    .prepare('SELECT * FROM mail_templates ORDER BY preset DESC, name ASC')
    .all()
    .map((row) => templateFromRow(row))
}

export function getMailTemplate(id) {
  ensureMailDefaults()
  const row = getDb().prepare('SELECT * FROM mail_templates WHERE id = ?').get(id)
  return row ? templateFromRow(row) : null
}

export function createMailTemplate(input) {
  const name = String(input.name || '').trim()
  const subject = String(input.subject || '').trim()
  const body = String(input.body || '').trim()
  if (!name) throw new Error('请填写模板名称')
  if (!subject) throw new Error('请填写邮件主题')
  if (!body) throw new Error('请填写邮件正文')
  const now = nowIso()
  const id = randomId()
  getDb()
    .prepare(
      `INSERT INTO mail_templates (id, name, subject, body, preset, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, name, subject, body, now, now)
  return getMailTemplate(id)
}

export function updateMailTemplate(id, patch) {
  const current = getMailTemplate(id)
  if (!current) throw new Error('邮件模板不存在')
  const name = String(patch.name ?? current.name).trim()
  const subject = String(patch.subject ?? current.subject).trim()
  const body = String(patch.body ?? current.body).trim()
  if (!name) throw new Error('请填写模板名称')
  if (!subject) throw new Error('请填写邮件主题')
  if (!body) throw new Error('请填写邮件正文')
  getDb()
    .prepare(
      `UPDATE mail_templates SET name = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?`,
    )
    .run(name, subject, body, nowIso(), id)
  return getMailTemplate(id)
}

export function deleteMailTemplate(id) {
  if (id === MAIL_PRESET_REPORT || id === MAIL_PRESET_CALLBACK_VISIT || id === MAIL_PRESET_REMINDER) {
    throw new Error('预置模板不能删除')
  }
  const info = getDb().prepare('DELETE FROM mail_templates WHERE id = ?').run(id)
  if (!info.changes) throw new Error('邮件模板不存在')
}
