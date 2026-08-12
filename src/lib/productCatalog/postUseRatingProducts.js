/** @typedef {import('../productCatalogLoader.js').CatalogProduct} CatalogProduct */

/**
 * PRD 云网 16 款产品（用后即评分析范围）。
 * 共享带宽使用 key `shared_bw`（避免被 mergeSharedBandwidthIntoEip 按 legacy key「共享带宽」删掉）。
 * 默认：已在工单目录中的产品保持 enabled；其余 enabled=false，仅开 analysisPostUseRating。
 *
 * @type {CatalogProduct[]}
 */
export const POST_USE_RATING_CATALOG_SEED_PRODUCTS = [
  {
    key: 'domain_reg',
    name: '域名注册',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'domain_reg',
    acceptParentName: true,
    specs: [{ name: '域名注册', match: ['域名注册'] }],
  },
  {
    key: 'shared_bw',
    name: '共享带宽',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: true,
    taxonomyKey: 'eip',
    acceptParentName: true,
    specs: [{ name: '共享带宽', match: ['共享带宽', '弹性公网IP-共享带宽'] }],
  },
  {
    key: 'cloud_port',
    name: '云端口',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'cloud_port',
    acceptParentName: true,
    specs: [{ name: '云端口', match: ['云端口'] }],
  },
  {
    key: 'eip',
    name: '弹性公网IP',
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: true,
    taxonomyKey: 'eip',
    acceptParentName: true,
    specs: [],
  },
  {
    key: 'ssl_vpn',
    name: 'SSL VPN',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'vpn',
    acceptParentName: true,
    specs: [{ name: 'SSL VPN', match: ['SSL VPN', 'SSLVPN', 'ssl vpn'] }],
  },
  {
    key: 'vpc_endpoint',
    name: 'VPC终端节点',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'vpc',
    acceptParentName: true,
    specs: [{ name: 'VPC终端节点', match: ['VPC终端节点', 'VPC 终端节点', '终端节点'] }],
  },
  {
    key: 'slb',
    name: '弹性负载均衡',
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: true,
    taxonomyKey: 'slb',
    acceptParentName: true,
    specs: [],
  },
  {
    key: 'ipsec_vpn',
    name: 'IPSec VPN',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'vpn',
    acceptParentName: true,
    specs: [{ name: 'IPSec VPN', match: ['IPSec VPN', 'IPSEC VPN', 'IPsec VPN'] }],
  },
  {
    key: 'security_group',
    name: '安全组',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'vpc',
    acceptParentName: true,
    specs: [{ name: '安全组', match: ['安全组'] }],
  },
  {
    key: 'vpc',
    name: '虚拟私有云',
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: true,
    taxonomyKey: 'vpc',
    acceptParentName: true,
    specs: [],
  },
  {
    key: 'peering',
    name: '对等连接',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'vpc',
    acceptParentName: true,
    specs: [{ name: '对等连接', match: ['对等连接'] }],
  },
  {
    key: 'cloud_interconnect',
    name: '云互联',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'cloud_interconnect',
    acceptParentName: true,
    specs: [{ name: '云互联', match: ['云互联'] }],
  },
  {
    key: 'cc',
    name: '云组网',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'cc',
    acceptParentName: true,
    specs: [{ name: '云组网', match: ['云组网'] }],
  },
  {
    key: 'dc',
    name: '云专线',
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: true,
    taxonomyKey: 'dc',
    acceptParentName: true,
    specs: [],
  },
  {
    key: 'monitor',
    name: '云监控',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'monitor',
    acceptParentName: true,
    specs: [{ name: '云监控', match: ['云监控'] }],
  },
  {
    key: 'nat',
    name: 'NAT网关',
    enabled: false,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: 'nat',
    acceptParentName: true,
    specs: [{ name: 'NAT网关', match: ['NAT网关', 'NAT 网关', 'nat网关'] }],
  },
]

/** @type {readonly string[]} */
export const POST_USE_RATING_PRODUCT_NAMES = POST_USE_RATING_CATALOG_SEED_PRODUCTS.map((p) => p.name)

/** @type {readonly string[]} */
export const POST_USE_FOCUS_TRACKED_NAMES = POST_USE_RATING_CATALOG_SEED_PRODUCTS.filter(
  (p) => p.focusTracked,
).map((p) => p.name)

/**
 * @param {CatalogProduct[] | null | undefined} products
 * @returns {string[]}
 */
export function getPostUseRatingProductNames(products) {
  if (!Array.isArray(products) || !products.length) {
    return [...POST_USE_RATING_PRODUCT_NAMES]
  }
  const names = products
    .filter((p) => p?.analysisPostUseRating && p?.name)
    .map((p) => String(p.name).trim())
    .filter(Boolean)
  return names.length ? names : [...POST_USE_RATING_PRODUCT_NAMES]
}

/**
 * @param {CatalogProduct[] | null | undefined} products
 * @returns {string[]}
 */
export function getPostUseFocusTrackedNames(products) {
  if (!Array.isArray(products) || !products.length) {
    return [...POST_USE_FOCUS_TRACKED_NAMES]
  }
  const names = products
    .filter((p) => p?.analysisPostUseRating && p?.focusTracked && p?.name)
    .map((p) => String(p.name).trim())
    .filter(Boolean)
  return names.length ? names : [...POST_USE_FOCUS_TRACKED_NAMES]
}
