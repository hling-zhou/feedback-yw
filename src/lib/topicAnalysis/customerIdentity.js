import { getSourceColumnValue } from '../sourceColumns.js'

/**
 * @param {string} value
 */
export function normalizeIdentityText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[（）()【】\[\]·•]/g, '')
    .toLowerCase()
}

/**
 * @param {object} record
 */
export function extractCustomerIdentity(record) {
  const customerCode = String(
    record?.customerCode
    || getSourceColumnValue(record, '集团客户编码')
    || '',
  ).trim()
  const customerName = String(
    record?.customerName
    || getSourceColumnValue(record, '集团名称')
    || '',
  ).trim()
  const customerTier = String(
    record?.customerTier
    || getSourceColumnValue(record, '移动云客户服务等级')
    || '',
  ).trim()
  return { customerCode, customerName, customerTier }
}

/**
 * @param {{ customerCode?: string, customerName?: string }} identity
 */
export function customerIdentityKey(identity) {
  const code = normalizeIdentityText(identity?.customerCode)
  if (code) return `code:${code}`
  const name = normalizeIdentityText(identity?.customerName)
  if (name) return `name:${name}`
  return ''
}

/**
 * @param {{ customerCode?: string, customerName?: string }} a
 * @param {{ customerCode?: string, customerName?: string }} b
 * @returns {'code' | 'name_approx' | null}
 */
export function matchCustomerIdentity(a, b) {
  const codeA = normalizeIdentityText(a?.customerCode)
  const codeB = normalizeIdentityText(b?.customerCode)
  if (codeA && codeB) return codeA === codeB ? 'code' : null

  const nameA = normalizeIdentityText(a?.customerName)
  const nameB = normalizeIdentityText(b?.customerName)
  if (!nameA || !nameB) return null
  if (nameA === nameB) return 'name_approx'
  if (nameA.includes(nameB) || nameB.includes(nameA)) return 'name_approx'
  return null
}

/**
 * @param {object} record
 * @param {{ customerCode?: string, customerName?: string, query?: string }} topic
 */
export function recordMatchesCustomerTopic(record, topic) {
  const identity = extractCustomerIdentity(record)
  if (matchCustomerIdentity(identity, topic)) return true
  const query = normalizeIdentityText(topic?.query)
  if (!query) return false
  return (
    normalizeIdentityText(identity.customerCode).includes(query)
    || normalizeIdentityText(identity.customerName).includes(query)
  )
}

/**
 * @param {'code' | 'name_approx' | string} [mode]
 */
export function customerMatchNote(mode) {
  if (mode === 'code') return '已按集团客户编码精确匹配'
  return '按名称/编码近似匹配（当前数据可能已脱敏，无法保证同一客户）'
}
