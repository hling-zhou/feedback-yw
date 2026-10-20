import { isKeyCustomerName } from '../../lib/postUseRating/callbackRecommendations.js'

/**
 * 重点客户星标：命中 settings.postUseKeyCustomers 名单时渲染金色★。
 * hover 显示 "重点关注客户"。
 *
 * @param {{
 *   customerName?: string
 *   keyCustomers?: string[]
 *   isKeyCustomer?: boolean
 * }} props
 */
export default function KeyCustomerStar({ customerName, keyCustomers, isKeyCustomer }) {
  const matched = isKeyCustomer != null
    ? Boolean(isKeyCustomer)
    : isKeyCustomerName(customerName || '', keyCustomers || [])

  if (!matched) return null

  return (
    <span
      className="key-customer-star"
      title="重点关注客户"
      style={{ color: '#F59E0B', fontSize: '12px', marginLeft: '4px', fontWeight: 600 }}
    >
      ★
    </span>
  )
}
