/** @typedef {import('../productCatalogLoader.js').CatalogProduct} CatalogProduct */
/** @typedef {import('../productCatalogLoader.js').ProductSpecDef} ProductSpecDef */

import { normalizeCatalogMatchText } from './resolveCatalogProduct.js'

export const SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY = '共享带宽'

export const SHARED_BANDWIDTH_SPEC_NAME = '弹性公网IP-共享带宽'

/** @type {ProductSpecDef} */
export const SHARED_BANDWIDTH_SPEC = {
  name: SHARED_BANDWIDTH_SPEC_NAME,
  match: [
    '共享带宽',
    '弹性公网IP-共享带宽',
    '弹性公网 IP-共享带宽',
    '弹性公网ip-共享带宽',
    '弹性公网IP共享带宽',
  ],
}

/**
 * 「子产品 B 降为父产品 A 的规格」声明式规则表。
 *
 * 目录迁移（specMergeRules.applySpecMergeRules）与 DB 侧快照迁移（server/businessDb.js）
 * 消费同一份表，避免逐条复制合并逻辑。
 *
 * 字段：
 * - parentKey：父产品 key（必须已存在于目录中，否则整条规则跳过，不做半截删除）
 * - childKeys：按 key 精确匹配（归一化后）待并入/移除的子产品
 * - childNames：按产品名精确匹配（归一化后）待并入/移除的子产品；用于线上 key 与代码不一致时兜底
 * - specs：并入父产品的规格定义
 *
 * 注意：多规格父产品中，`specs` 是「从子产品继承来的规格」的显式声明，
 * 不在此处的规格（如 vpc 的自有规格「虚拟私有云」）由种子/线上配置各自维护，引擎只做并集不去重覆盖。
 * 规则是原子的：只要命中任一子产品，就把该规则声明的全部规格补齐，
 * 避免出现「父产品已建、规格只剩一半」的不一致状态。
 *
 * @type {Array<{
 *   id: string
 *   parentKey: string
 *   childKeys: string[]
 *   childNames: string[]
 *   specs: ProductSpecDef[]
 *   note: string
 * }>}
 */
export const SPEC_MERGE_RULES = [
  {
    id: 'shared_bw_to_eip',
    parentKey: 'eip',
    // 只按 key 匹配：线上「共享带宽」用 key shared_bw 保留为独立用后即评产品（双入口），
    // 若按产品名匹配会把用户保留的那条删掉。
    childKeys: [SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY],
    childNames: [],
    specs: [SHARED_BANDWIDTH_SPEC],
    note: '共享带宽 → 弹性公网IP-共享带宽（历史遗留，保留 shared_bw 独立条目）',
  },
  {
    id: 'vpn_children',
    parentKey: 'vpn',
    childKeys: ['ssl_vpn', 'ipsec_vpn'],
    childNames: ['SSL VPN', 'IPSec VPN'],
    specs: [
      { name: 'SSL VPN', match: ['SSL VPN', 'SSLVPN', 'ssl vpn'] },
      { name: 'IPSec VPN', match: ['IPSec VPN', 'IPSEC VPN', 'IPsec VPN'] },
    ],
    note: 'SSL VPN / IPSec VPN → 融合VPN',
  },
  {
    id: 'cc_children',
    parentKey: 'cc',
    childKeys: ['cloud_interconnect'],
    childNames: ['云互联'],
    specs: [{ name: '云互联', match: ['云互联'] }],
    note: '云互联 → 云组网',
  },
  {
    id: 'vpc_children',
    parentKey: 'vpc',
    childKeys: ['peering', 'security_group'],
    childNames: ['对等连接', '安全组'],
    specs: [
      { name: '对等连接', match: ['对等连接', 'VPC对等连接', 'VPC 对等连接'] },
      { name: '安全组', match: ['安全组'] },
    ],
    note: '对等连接 / 安全组 → 虚拟私有云',
  },
]

/**
 * @param {CatalogProduct} product
 * @param {typeof SPEC_MERGE_RULES[number]} rule
 */
function matchesRuleChild(product, rule) {
  const key = normalizeCatalogMatchText(product.key)
  const name = normalizeCatalogMatchText(product.name)
  if (!key && !name) return false
  return (
    (rule.childKeys || []).some((k) => key && normalizeCatalogMatchText(k) === key) ||
    (rule.childNames || []).some((n) => name && normalizeCatalogMatchText(n) === name)
  )
}

/**
 * @param {CatalogProduct[]} list
 * @param {string} parentKey
 */
function findParent(list, parentKey) {
  const target = normalizeCatalogMatchText(parentKey)
  return list.find((p) => p?.key && normalizeCatalogMatchText(p.key) === target) || null
}

/**
 * 应用规则表：把子产品的规格并入父产品，并从目录中移除子产品条目。
 * 纯函数，不修改入参；父产品不存在时该条规则整体跳过（宁可留残留，也不做无处归属的删除）。
 *
 * @param {CatalogProduct[]} products
 * @param {typeof SPEC_MERGE_RULES} [rules]
 * @returns {{ products: CatalogProduct[]; changed: boolean }}
 */
export function applySpecMergeRules(products, rules = SPEC_MERGE_RULES) {
  if (!Array.isArray(products)) return { products, changed: false }
  const list = structuredClone(products.filter(Boolean))
  let changed = false
  /** @type {Set<string>} */
  const childKeysToRemove = new Set()

  for (const rule of rules) {
    const parent = findParent(list, rule.parentKey)
    const children = list.filter((p) => p?.key && matchesRuleChild(p, rule))
    if (!children.length) continue
    if (!parent) continue

    const specByName = new Map((parent.specs || []).map((s) => [s.name, { ...s }]))
    for (const spec of rule.specs || []) {
      const existing = specByName.get(spec.name)
      if (!existing) {
        specByName.set(spec.name, { ...spec })
        changed = true
        continue
      }
      const mergedMatch = new Set([...(existing.match || []), ...(spec.match || [])])
      if (mergedMatch.size !== (existing.match || []).length) {
        existing.match = [...mergedMatch]
        changed = true
      }
    }
    parent.specs = [...specByName.values()]

    for (const child of children) {
      if (child === parent) continue
      childKeysToRemove.add(child.key)
      changed = true
    }
  }

  if (!changed) return { products: list, changed: false }
  return { products: list.filter((p) => !(p.key && childKeysToRemove.has(p.key))), changed: true }
}
