import * as XLSX from 'xlsx'
import { ROLE_LABELS, ROLES } from '../domain/auth/permissions.js'
import { validatePasswordPolicy } from '../domain/passwordPolicy.js'
import { USER_IMPORT_SHEET_NAME } from './userImportTemplate.js'

/** @typedef {import('../domain/auth/permissions.js').UserRole} UserRole */

/** @type {Record<string, UserRole>} */
const ROLE_BY_LABEL = Object.fromEntries(
  ROLES.flatMap((role) => [
    [ROLE_LABELS[role], role],
    [role, role],
  ]),
)

/**
 * @param {string} header
 */
export function normalizeUserImportHeader(header) {
  return String(header ?? '')
    .replace(/\*（必填）$/, '')
    .replace(/（必填）$/, '')
    .replace(/（可选）$/, '')
    .trim()
}

/**
 * @param {Record<string, unknown>} row
 */
export function normalizeUserImportRow(row) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, value] of Object.entries(row || {})) {
    out[normalizeUserImportHeader(key)] = value
  }
  return out
}

/**
 * @param {unknown} value
 */
function cellText(value) {
  if (value == null) return ''
  return String(value).trim()
}

/**
 * @param {Record<string, unknown>} row
 * @param {number} rowNumber
 */
function parseUserImportRow(row, rowNumber) {
  const username = cellText(row['用户名'])
  const password = cellText(row['密码'])
  const team = cellText(row['所属班组'])
  const roleRaw = cellText(row['角色'])

  if (!username && !password && !team && !roleRaw) {
    return { skip: true }
  }

  /** @type {string[]} */
  const issues = []
  if (!username) issues.push('用户名为空')
  if (!password) issues.push('密码为空')
  if (!team) issues.push('所属班组为空')
  if (!roleRaw) issues.push('角色为空')

  const role = ROLE_BY_LABEL[roleRaw]
  if (roleRaw && !role) {
    issues.push(`角色「${roleRaw}」无效，可填：${ROLES.map((r) => ROLE_LABELS[r]).join('、')}`)
  }

  if (password) {
    const policy = validatePasswordPolicy(password)
    if (!policy.ok) issues.push(policy.message)
  }

  if (issues.length) {
    return {
      error: {
        row: rowNumber,
        username: username || `第 ${rowNumber} 行`,
        message: issues.join('；'),
      },
    }
  }

  return {
    item: {
      username,
      password,
      team,
      role: /** @type {UserRole} */ (role),
    },
  }
}

/**
 * @param {ArrayBuffer} buffer
 */
export function parseUserImportFile(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames.includes(USER_IMPORT_SHEET_NAME)
    ? USER_IMPORT_SHEET_NAME
    : wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  if (!sheet) {
    return { rows: [], errors: [{ row: 0, username: '', message: '文件中没有可读取的工作表' }] }
  }

  const rawRows = /** @type {Record<string, unknown>[]} */ (
    XLSX.utils.sheet_to_json(sheet, { defval: '' })
  )

  /** @type {{ username: string; password: string; team: string; role: UserRole }[]} */
  const rows = []
  /** @type {{ row: number; username: string; message: string }[]} */
  const errors = []

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2
    const normalized = normalizeUserImportRow(raw)
    const parsed = parseUserImportRow(normalized, rowNumber)
    if (parsed.skip) return
    if (parsed.error) {
      errors.push(parsed.error)
      return
    }
    if (parsed.item) rows.push(parsed.item)
  })

  return { rows, errors }
}
