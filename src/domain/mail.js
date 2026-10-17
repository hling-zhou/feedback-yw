import { DATA_SOURCE_TYPES } from './enums.js'

export const MAIL_PRESET_REPORT = 'post_use_report'
export const MAIL_PRESET_CALLBACK_VISIT = 'callback_visit_list'

export const MAIL_PRESET_IDS = /** @type {const} */ ([MAIL_PRESET_REPORT, MAIL_PRESET_CALLBACK_VISIT])

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const MAIL_MAX_RECIPIENTS = 30
export const MAIL_MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

export const DEFAULT_REPORT_SUBJECT = '用后即评{月报|季报}（{周期键}）'
export const DEFAULT_REPORT_BODY = `{周期标签}的用后即评{月报|季报}
详见附件，可用浏览器直接打开
原始数据及报告见用户反馈分析平台 {绝对链接}`

export const DEFAULT_CALLBACK_SUBJECT = '待客服部回访清单（{周期标签}）'
export const DEFAULT_CALLBACK_BODY = `{周期标签}的待客服部回访清单
详见附件，可用 Excel 打开
原始数据及报告见用户反馈分析平台 {绝对链接}`

/**
 * @param {string} presetKey
 */
export function defaultMailTemplate(presetKey) {
  if (presetKey === MAIL_PRESET_CALLBACK_VISIT) {
    return {
      id: MAIL_PRESET_CALLBACK_VISIT,
      name: '待客服部回访清单',
      subject: DEFAULT_CALLBACK_SUBJECT,
      body: DEFAULT_CALLBACK_BODY,
      preset: true,
    }
  }
  return {
    id: MAIL_PRESET_REPORT,
    name: '用后即评报告',
    subject: DEFAULT_REPORT_SUBJECT,
    body: DEFAULT_REPORT_BODY,
    preset: true,
  }
}

/**
 * @param {unknown} value
 */
export function isValidEmail(value) {
  const email = String(value || '').trim()
  return EMAIL_RE.test(email)
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseEmailList(raw) {
  if (Array.isArray(raw)) {
    return uniqueEmails(raw.map((item) => String(item || '').trim()).filter(Boolean))
  }
  const text = String(raw || '')
  return uniqueEmails(
    text
      .split(/[,;，；\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

/**
 * @param {string[]} emails
 */
export function uniqueEmails(emails) {
  const seen = new Set()
  const out = []
  for (const email of emails || []) {
    const normalized = String(email || '').trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

/**
 * @param {string[]} emails
 * @param {string} [label]
 */
export function assertEmailList(emails, label = '收件人') {
  const list = uniqueEmails(emails)
  if (!list.length) throw new Error(`请填写${label}`)
  if (list.length > MAIL_MAX_RECIPIENTS) {
    throw new Error(`${label}不能超过 ${MAIL_MAX_RECIPIENTS} 个`)
  }
  const invalid = list.find((email) => !isValidEmail(email))
  if (invalid) throw new Error(`${label}「${invalid}」不是有效邮箱`)
  return list
}

/**
 * @param {string | null | undefined} dataSourceType
 */
export function isMailDataSourceType(dataSourceType) {
  return DATA_SOURCE_TYPES.includes(/** @type {any} */ (dataSourceType))
}

/**
 * @param {string} text
 * @param {{
 *   periodLabel?: string
 *   reportKey?: string
 *   reportKind?: 'month' | 'quarter' | string
 *   absoluteUrl?: string
 * }} vars
 */
export function applyMailPlaceholders(text, vars = {}) {
  const kindLabel = vars.reportKind === 'quarter' ? '季报' : '月报'
  return String(text || '')
    .replaceAll('{周期标签}', vars.periodLabel || '')
    .replaceAll('{周期键}', vars.reportKey || '')
    .replaceAll('{月报|季报}', kindLabel)
    .replaceAll('{绝对链接}', vars.absoluteUrl || '')
}

/**
 * @param {string} publicAppUrl
 * @param {string} path
 */
export function joinPublicAppUrl(publicAppUrl, path) {
  const root = String(publicAppUrl || '').trim().replace(/\/+$/, '')
  const suffix = String(path || '').startsWith('/') ? path : `/${path}`
  if (!root) return suffix
  return `${root}${suffix}`
}

/**
 * @param {string} templateId
 * @param {'month' | 'quarter' | string} reportKind
 * @param {string} reportKey
 */
export function resolveMailContentUrl(templateId, reportKind, reportKey, publicAppUrl) {
  if (templateId === MAIL_PRESET_CALLBACK_VISIT) {
    return joinPublicAppUrl(publicAppUrl, '/workbench?tab=post_use_rating')
  }
  if (reportKind === 'quarter' && reportKey) {
    return joinPublicAppUrl(publicAppUrl, `/workbench/post-use-report/${reportKey}`)
  }
  if (reportKey) {
    return joinPublicAppUrl(publicAppUrl, `/workbench/post-use-report/${reportKey}`)
  }
  return joinPublicAppUrl(publicAppUrl, '/workbench?tab=post_use_rating')
}
