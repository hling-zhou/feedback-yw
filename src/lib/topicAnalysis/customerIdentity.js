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
 * @returns {'code' | 'name' | null}
 */
export function matchCustomerIdentity(a, b) {
  const codeA = normalizeIdentityText(a?.customerCode)
  const codeB = normalizeIdentityText(b?.customerCode)
  if (codeA && codeB) return codeA === codeB ? 'code' : null

  const nameA = normalizeIdentityText(a?.customerName)
  const nameB = normalizeIdentityText(b?.customerName)
  if (nameA && nameB && nameA === nameB) return 'name'
  return null
}

/**
 * @param {{ customerCode?: string, customerName?: string, query?: string, matchQuery?: string }} topic
 * @param {{ customerCode?: string, customerName?: string }} identity
 */
export function identityMatchesCustomerTopic(identity, topic) {
  if (matchCustomerIdentity(identity, topic)) return true
  const query = normalizeIdentityText(topic?.query || topic?.matchQuery)
  if (!query) return false
  return (
    normalizeIdentityText(identity.customerCode) === query
    || normalizeIdentityText(identity.customerName) === query
  )
}

/**
 * @param {object} record
 * @param {{ customerCode?: string, customerName?: string, query?: string, matchQuery?: string }} topic
 */
export function recordMatchesCustomerTopic(record, topic) {
  return identityMatchesCustomerTopic(extractCustomerIdentity(record), topic)
}

/**
 * @param {'code' | 'name' | string} [mode]
 */
export function customerMatchNote(mode) {
  if (mode === 'code') return '已按集团客户编码精确匹配'
  if (mode === 'name') return '已按客户名称精确匹配'
  return '按客户名称或集团客户编码精确匹配'
}
