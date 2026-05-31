/** @typedef {typeof CUSTOMER_TIERS[number]} CustomerTier */

/** 规范客户等级（§8 高价值客户影响展示） */
export const CUSTOMER_TIERS = /** @type {const} */ (['金牌', '银牌', '铜牌', '普通'])

/** 移动云工单导入表头列名 */
export const CUSTOMER_TIER_SOURCE_COLUMN = '移动云客户服务等级'

/** @type {Record<CustomerTier, string>} */
export const CUSTOMER_TIER_LABELS = {
  金牌: '金牌',
  银牌: '银牌',
  铜牌: '铜牌',
  普通: '普通',
}

/**
 * 将导入列值规范为金牌/银牌/铜牌/普通；无法识别或空值返回 undefined
 * @param {string | undefined | null} raw
 * @returns {CustomerTier | undefined}
 */
export function normalizeCustomerTier(raw) {
  const s = (raw ?? '').trim()
  if (!s) return undefined
  if (CUSTOMER_TIERS.includes(/** @type {CustomerTier} */ (s))) return s

  if (/金牌|^金$|gold|vip/i.test(s)) return '金牌'
  if (/银牌|^银$|silver/i.test(s)) return '银牌'
  if (/铜牌|^铜$|bronze/i.test(s)) return '铜牌'
  if (/普通|一般|标准|standard|normal/i.test(s)) return '普通'

  return undefined
}

/**
 * @param {string} value
 * @returns {value is CustomerTier}
 */
export function isCustomerTier(value) {
  return CUSTOMER_TIERS.includes(/** @type {CustomerTier} */ (value))
}

/**
 * 统计群组内各客户等级工单数（§8 高价值客户影响）
 * @param {import('../lib/types.js').FeedbackRecord[]} records
 * @returns {Record<CustomerTier, number>}
 */
export function countCustomerTiers(records) {
  /** @type {Record<CustomerTier, number>} */
  const counts = { 金牌: 0, 银牌: 0, 铜牌: 0, 普通: 0 }
  for (const r of records) {
    const tier = normalizeCustomerTier(r.customerTier)
    if (tier) counts[tier] += 1
  }
  return counts
}
