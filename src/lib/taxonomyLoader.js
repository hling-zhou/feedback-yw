/**
 * 从 public/config/taxonomy 加载用户旅程与通用问题类型（优先 Excel，其次 JSON，最后内置默认）。
 */
import {
  EIP_USER_JOURNEY,
  EIP_NODE_ISSUE_MAP,
  EIP_NODE_SERVICE_MAP,
  EIP_REQUEST_SCENE_PATH_MAP,
  EIP_PROBLEM_TYPE_PATH_MAP,
} from './journeys/eipJourney.js'
import {
  DC_USER_JOURNEY,
  DC_NODE_ISSUE_MAP,
  DC_NODE_SERVICE_MAP,
  DC_PRODUCT_MATCH,
  DC_REQUEST_SCENE_PATH_MAP,
  DC_PROBLEM_TYPE_PATH_MAP,
} from './journeys/dcJourney.js'
import {
  SLB_USER_JOURNEY,
  SLB_NODE_ISSUE_MAP,
  SLB_NODE_SERVICE_MAP,
  SLB_PRODUCT_MATCH,
  SLB_REQUEST_SCENE_PATH_MAP,
  SLB_PROBLEM_TYPE_PATH_MAP,
} from './journeys/slbJourney.js'
import {
  VPC_USER_JOURNEY,
  VPC_NODE_ISSUE_MAP,
  VPC_NODE_SERVICE_MAP,
  VPC_PRODUCT_MATCH,
  VPC_REQUEST_SCENE_PATH_MAP,
  VPC_PROBLEM_TYPE_PATH_MAP,
} from './journeys/vpcJourney.js'
import {
  MONITOR_USER_JOURNEY,
  MONITOR_NODE_ISSUE_MAP,
  MONITOR_NODE_SERVICE_MAP,
  MONITOR_PRODUCT_MATCH,
  MONITOR_REQUEST_SCENE_PATH_MAP,
  MONITOR_PROBLEM_TYPE_PATH_MAP,
} from './journeys/monitorJourney.js'
import {
  CC_USER_JOURNEY,
  CC_NODE_ISSUE_MAP,
  CC_NODE_SERVICE_MAP,
  CC_PRODUCT_MATCH,
  CC_REQUEST_SCENE_PATH_MAP,
  CC_PROBLEM_TYPE_PATH_MAP,
} from './journeys/ccJourney.js'
import {
  NAT_USER_JOURNEY,
  NAT_NODE_ISSUE_MAP,
  NAT_NODE_SERVICE_MAP,
  NAT_PRODUCT_MATCH,
  NAT_REQUEST_SCENE_PATH_MAP,
  NAT_PROBLEM_TYPE_PATH_MAP,
} from './journeys/natJourney.js'
import {
  VPN_USER_JOURNEY,
  VPN_NODE_ISSUE_MAP,
  VPN_NODE_SERVICE_MAP,
  VPN_PRODUCT_MATCH,
  VPN_REQUEST_SCENE_PATH_MAP,
  VPN_PROBLEM_TYPE_PATH_MAP,
} from './journeys/vpnJourney.js'
import { DEFAULT_THEME_RULES } from './themes.js'
import { parseTaxonomyWorkbook } from './taxonomyExcel.js'
import {
  applyJourneyPatchesToProducts,
  mergeProblemTypes,
  emptyOverrides,
} from './tagLibrary/overrides.js'
import { normalizeProvisionedTemplate } from './productCenterSync.js'
import { REQUEST_SCENES_BUILTIN, PROBLEM_TYPES_BUILTIN } from './sharedTagDefs.js'
import { canonicalTaxonomyKey } from './taxonomyKeyAliases.js'

/** @typedef {import('./themes.js').ThemeRule} ThemeRule */
/** @typedef {import('./productTaxonomy.js').JourneyL1} JourneyL1 */

const CONFIG_BASE = '/config/taxonomy'
const EXCEL_CONFIG_FILE = '打标配置.xlsx'

const SHARED_PROBLEM_TYPES_BUILTIN = PROBLEM_TYPES_BUILTIN
const SHARED_REQUEST_SCENES_BUILTIN = REQUEST_SCENES_BUILTIN

/** @type {Record<string, object>} */
const BUILTIN_PRODUCTS = {
  eip: {
    key: 'eip',
    name: '弹性公网 IP',
    match: [
      '弹性公网',
      '公网IP',
      '公网 IP',
      'EIP',
      'eip',
      '弹性ip',
      '移动IP',
      'IPv6带宽',
    ],
    journeys: EIP_USER_JOURNEY,
    themes: null,
    nodeMaps: {
      serviceMap: EIP_NODE_SERVICE_MAP,
      issueMap: EIP_NODE_ISSUE_MAP,
      requestSceneMap: EIP_REQUEST_SCENE_PATH_MAP,
      problemTypePathMap: EIP_PROBLEM_TYPE_PATH_MAP,
    },
  },
  dc: {
    key: 'dc',
    name: '云专线',
    match: DC_PRODUCT_MATCH,
    journeys: DC_USER_JOURNEY,
    themes: null,
    nodeMaps: {
      serviceMap: DC_NODE_SERVICE_MAP,
      issueMap: DC_NODE_ISSUE_MAP,
      requestSceneMap: DC_REQUEST_SCENE_PATH_MAP,
      problemTypePathMap: DC_PROBLEM_TYPE_PATH_MAP,
    },
  },
  slb: {
    key: 'slb',
    name: '弹性负载均衡',
    match: SLB_PRODUCT_MATCH,
    journeys: SLB_USER_JOURNEY,
    themes: null,
    nodeMaps: {
      serviceMap: SLB_NODE_SERVICE_MAP,
      issueMap: SLB_NODE_ISSUE_MAP,
      requestSceneMap: SLB_REQUEST_SCENE_PATH_MAP,
      problemTypePathMap: SLB_PROBLEM_TYPE_PATH_MAP,
    },
  },
  vpc: {
    key: 'vpc',
    name: '虚拟私有云',
    match: VPC_PRODUCT_MATCH,
    journeys: VPC_USER_JOURNEY,
    themes: null,
    nodeMaps: {
      serviceMap: VPC_NODE_SERVICE_MAP,
      issueMap: VPC_NODE_ISSUE_MAP,
      requestSceneMap: VPC_REQUEST_SCENE_PATH_MAP,
      problemTypePathMap: VPC_PROBLEM_TYPE_PATH_MAP,
    },
  },
  monitor: {
    key: 'monitor',
    name: '云监控',
    match: MONITOR_PRODUCT_MATCH,
    journeys: MONITOR_USER_JOURNEY,
    themes: null,
    nodeMaps: {
      serviceMap: MONITOR_NODE_SERVICE_MAP,
      issueMap: MONITOR_NODE_ISSUE_MAP,
      requestSceneMap: MONITOR_REQUEST_SCENE_PATH_MAP,
      problemTypePathMap: MONITOR_PROBLEM_TYPE_PATH_MAP,
    },
  },
  cc: {
    key: 'cc',
    name: '云组网',
    match: CC_PRODUCT_MATCH,
    journeys: CC_USER_JOURNEY,
    themes: null,
    nodeMaps: {
      serviceMap: CC_NODE_SERVICE_MAP,
      issueMap: CC_NODE_ISSUE_MAP,
      requestSceneMap: CC_REQUEST_SCENE_PATH_MAP,
      problemTypePathMap: CC_PROBLEM_TYPE_PATH_MAP,
    },
  },
  nat: {
    key: 'nat',
    name: 'NAT网关',
    match: NAT_PRODUCT_MATCH,
    journeys: NAT_USER_JOURNEY,
    themes: null,
    nodeMaps: {
      serviceMap: NAT_NODE_SERVICE_MAP,
      issueMap: NAT_NODE_ISSUE_MAP,
      requestSceneMap: NAT_REQUEST_SCENE_PATH_MAP,
      problemTypePathMap: NAT_PROBLEM_TYPE_PATH_MAP,
    },
  },
  vpn: {
    key: 'vpn',
    name: '融合VPN',
    match: VPN_PRODUCT_MATCH,
    journeys: VPN_USER_JOURNEY,
    themes: null,
    nodeMaps: {
      serviceMap: VPN_NODE_SERVICE_MAP,
      issueMap: VPN_NODE_ISSUE_MAP,
      requestSceneMap: VPN_REQUEST_SCENE_PATH_MAP,
      problemTypePathMap: VPN_PROBLEM_TYPE_PATH_MAP,
    },
  },
  generic: {
    key: 'generic',
    name: '通用产品',
    match: [],
    journeys: [
      {
        id: 'consult',
        label: '咨询了解',
        description: '产品咨询与了解',
        children: [
          {
            id: 'consult-general',
            label: '产品咨询',
            description: '一般咨询',
            keywords: ['咨询', '了解'],
          },
        ],
      },
      {
        id: 'onboard',
        label: '开通使用',
        description: '开通与初始配置',
        children: [
          {
            id: 'onboard-setup',
            label: '开通配置',
            description: '开通与配置',
            keywords: ['开通', '配置'],
          },
        ],
      },
      {
        id: 'operate',
        label: '日常运维',
        description: '日常使用与运维',
        children: [
          {
            id: 'operate-run',
            label: '使用运维',
            description: '日常运维',
            keywords: ['使用', '运维'],
          },
        ],
      },
      {
        id: 'incident',
        label: '故障处理',
        description: '故障排查与修复',
        children: [
          {
            id: 'incident-fix',
            label: '排障修复',
            description: '故障处理',
            keywords: ['故障', '排查'],
          },
        ],
      },
    ],
    themes: null,
  },
}

/** @type {{ loadedAt: string | null; source: 'excel' | 'json' | 'builtin'; configFile: string; products: Record<string, object>; sharedProblemTypes: { label: string; description?: string; keywords: string[] }[]; sharedRequestScenes: { label: string; description?: string; keywords: string[] }[]; indexVersion: number }} */
let cache = {
  loadedAt: null,
  source: 'builtin',
  configFile: '',
  products: { ...BUILTIN_PRODUCTS },
  sharedProblemTypes: [...SHARED_PROBLEM_TYPES_BUILTIN],
  sharedRequestScenes: [...SHARED_REQUEST_SCENES_BUILTIN],
  indexVersion: 0,
  tagLibraryVersion: 'taxonomy-static-1',
}

function cloneProduct(p) {
  return JSON.parse(JSON.stringify(p))
}

function normalizeProduct(raw) {
  if (!raw?.key) return null
  const builtin = BUILTIN_PRODUCTS[raw.key]
  return {
    key: raw.key,
    name: raw.name || raw.key,
    match: raw.match || [],
    journeys: raw.journeys || [],
    themes: null,
    nodeMaps: raw.nodeMaps || builtin?.nodeMaps || null,
  }
}

/** @type {Record<string, { serviceMap: Record<string, string>; issueMap: Record<string, { l1: string; l2?: string }> }>} */
const BUILTIN_NODE_MAPS = {
  eip: {
    serviceMap: EIP_NODE_SERVICE_MAP,
    issueMap: EIP_NODE_ISSUE_MAP,
    requestSceneMap: EIP_REQUEST_SCENE_PATH_MAP,
    problemTypePathMap: EIP_PROBLEM_TYPE_PATH_MAP,
  },
  dc: {
    serviceMap: DC_NODE_SERVICE_MAP,
    issueMap: DC_NODE_ISSUE_MAP,
    requestSceneMap: DC_REQUEST_SCENE_PATH_MAP,
    problemTypePathMap: DC_PROBLEM_TYPE_PATH_MAP,
  },
  slb: {
    serviceMap: SLB_NODE_SERVICE_MAP,
    issueMap: SLB_NODE_ISSUE_MAP,
    requestSceneMap: SLB_REQUEST_SCENE_PATH_MAP,
    problemTypePathMap: SLB_PROBLEM_TYPE_PATH_MAP,
  },
  vpc: {
    serviceMap: VPC_NODE_SERVICE_MAP,
    issueMap: VPC_NODE_ISSUE_MAP,
    requestSceneMap: VPC_REQUEST_SCENE_PATH_MAP,
    problemTypePathMap: VPC_PROBLEM_TYPE_PATH_MAP,
  },
  monitor: {
    serviceMap: MONITOR_NODE_SERVICE_MAP,
    issueMap: MONITOR_NODE_ISSUE_MAP,
    requestSceneMap: MONITOR_REQUEST_SCENE_PATH_MAP,
    problemTypePathMap: MONITOR_PROBLEM_TYPE_PATH_MAP,
  },
  cc: {
    serviceMap: CC_NODE_SERVICE_MAP,
    issueMap: CC_NODE_ISSUE_MAP,
    requestSceneMap: CC_REQUEST_SCENE_PATH_MAP,
    problemTypePathMap: CC_PROBLEM_TYPE_PATH_MAP,
  },
  nat: {
    serviceMap: NAT_NODE_SERVICE_MAP,
    issueMap: NAT_NODE_ISSUE_MAP,
    requestSceneMap: NAT_REQUEST_SCENE_PATH_MAP,
    problemTypePathMap: NAT_PROBLEM_TYPE_PATH_MAP,
  },
  vpn: {
    serviceMap: VPN_NODE_SERVICE_MAP,
    issueMap: VPN_NODE_ISSUE_MAP,
    requestSceneMap: VPN_REQUEST_SCENE_PATH_MAP,
    problemTypePathMap: VPN_PROBLEM_TYPE_PATH_MAP,
  },
}

async function loadFromExcel() {
  const url = `${CONFIG_BASE}/${encodeURIComponent(EXCEL_CONFIG_FILE)}?t=${Date.now()}`
  const res = await fetch(url)
  if (!res.ok) return null
  const buffer = await res.arrayBuffer()
  const { products, sharedProblemTypes, sharedRequestScenes } = parseTaxonomyWorkbook(buffer)
  if (!Object.keys(products).length) return null
  return {
    products: { ...BUILTIN_PRODUCTS, ...products },
    sharedProblemTypes: sharedProblemTypes.length
      ? sharedProblemTypes
      : SHARED_PROBLEM_TYPES_BUILTIN,
    sharedRequestScenes: sharedRequestScenes?.length
      ? sharedRequestScenes
      : SHARED_REQUEST_SCENES_BUILTIN,
    configFile: EXCEL_CONFIG_FILE,
  }
}

async function loadFromJson() {
  const indexRes = await fetch(`${CONFIG_BASE}/index.json?t=${Date.now()}`)
  if (!indexRes.ok) return null
  const index = await indexRes.json()
  const keys = index.products || Object.keys(BUILTIN_PRODUCTS)
  const loaded = { ...BUILTIN_PRODUCTS }

  await Promise.all(
    keys.map(async (key) => {
      const res = await fetch(`${CONFIG_BASE}/${key}.json?t=${Date.now()}`)
      if (!res.ok) return
      const raw = await res.json()
      const norm = normalizeProduct(raw)
      if (norm) loaded[key] = norm
    }),
  )

  const mergedProblems = mergeProblemTypesFromProducts(loaded)
  return {
    products: loaded,
    sharedProblemTypes: index.sharedProblemTypes?.length
      ? index.sharedProblemTypes
      : mergedProblems,
    sharedRequestScenes: index.sharedRequestScenes?.length
      ? index.sharedRequestScenes
      : SHARED_REQUEST_SCENES_BUILTIN,
    configFile: 'index.json + *.json',
    indexVersion: index.version || 1,
  }
}

/** @param {Record<string, object>} products */
function mergeProblemTypesFromProducts(products) {
  /** @type {Map<string, { label: string; keywords: string[] }>} */
  const map = new Map()
  for (const tax of Object.values(products)) {
    for (const pt of tax.problemTypes || []) {
      if (pt?.label && !map.has(pt.label)) map.set(pt.label, pt)
    }
  }
  return map.size ? [...map.values()] : SHARED_PROBLEM_TYPES_BUILTIN
}

/**
 * 用内置默认初始化内存缓存（运行时 SSOT 为共享库 taxonomy_managed，不再读磁盘 Excel/JSON）。
 */
export function initTaxonomyCacheFromBuiltin() {
  cache = {
    loadedAt: new Date().toISOString(),
    source: 'builtin',
    configFile: '内置默认',
    products: cloneProduct(BUILTIN_PRODUCTS),
    sharedProblemTypes: [...SHARED_PROBLEM_TYPES_BUILTIN],
    sharedRequestScenes: [...SHARED_REQUEST_SCENES_BUILTIN],
    indexVersion: 0,
    tagLibraryVersion: 'taxonomy-builtin-1',
  }
  return getTaxonomyState()
}

/**
 * @deprecated 请使用 initTaxonomyCacheFromBuiltin + loadManagedTaxonomy；保留别名避免遗漏调用点。
 */
export async function loadTaxonomyConfig() {
  return initTaxonomyCacheFromBuiltin()
}

export function getTaxonomyState() {
  return {
    loadedAt: cache.loadedAt,
    source: cache.source,
    configFile: cache.configFile,
    indexVersion: cache.indexVersion,
    productKeys: Object.keys(cache.products),
  }
}

/** @returns {Record<string, object>} */
export function getAllProducts() {
  return cache.products
}

/**
 * 打标/LLM 使用的旅程列表：未手工配置的目录产品强制为空（避免 IDB 残留 generic 副本）
 * @param {object} product
 */
export function effectiveJourneysForProduct(product) {
  if (!product) return []
  const normalized = normalizeProvisionedTemplate(
    product,
    cache.products.generic?.journeys,
  )
  return normalized.journeys || []
}

/**
 * @param {string} key
 */
export function getProductByKey(key) {
  if (!key) {
    const g = cache.products.generic
    return g ? { ...g, journeys: effectiveJourneysForProduct(g) } : g
  }
  if (cache.products[key]) {
    const raw = cache.products[key]
    const journeys = effectiveJourneysForProduct(raw)
    return { ...raw, journeys }
  }
  return {
    key,
    name: key,
    match: [],
    journeys: [],
    themes: null,
    nodeMaps: null,
    catalogProvisioned: true,
    journeyConfigured: false,
  }
}

/**
 * @param {string} [productName]
 * @param {string} [productKey]
 */
export function resolveTaxonomyKey(productName, productKey) {
  const pk = productKey?.trim()
  if (pk) {
    const canonical = canonicalTaxonomyKey(pk)
    if (cache.products[canonical]) return canonical
    return canonical
  }
  const p = (productName || '').toLowerCase()
  for (const [key, tax] of Object.entries(cache.products)) {
    if (key === 'generic') continue
    if (tax.match?.some((m) => p.includes(String(m).toLowerCase()))) return key
  }
  return 'generic'
}

/**
 * @param {string} [productName]
 * @param {string} [productKey]
 */
export function getSharedProblemTypes() {
  return cache.sharedProblemTypes?.length
    ? cache.sharedProblemTypes
    : SHARED_PROBLEM_TYPES_BUILTIN
}

export function getSharedRequestScenes() {
  return cache.sharedRequestScenes?.length
    ? cache.sharedRequestScenes
    : SHARED_REQUEST_SCENES_BUILTIN
}

export function getTaxonomy(productName, productKey) {
  const key = resolveTaxonomyKey(productName, productKey)
  const tax = getProductByKey(key)
  return {
    ...tax,
    key,
    problemTypes: getSharedProblemTypes(),
    requestScenes: getSharedRequestScenes(),
  }
}

/**
 * 由用户旅程二级环节生成主题规则（反馈主题已并入旅程，不再单独维护）
 * @param {JourneyL1[]} journeys
 * @returns {ThemeRule[]}
 */
export function journeyToThemeRules(journeys) {
  /** @type {ThemeRule[]} */
  const rules = []
  for (const l1 of journeys || []) {
    for (const l2 of l1.children || []) {
      rules.push({
        id: l2.id,
        label: l2.label,
        description: l2.description || l1.description || '',
        keywords: l2.keywords || [],
      })
    }
  }
  return rules
}

/**
 * @param {{ product?: string; productKey?: string }} record
 */
export function getTaxonomyForRecord(record) {
  return getTaxonomy(record?.product, record?.productKey)
}

/**
 * @param {string} taxonomyKey
 */
export function getJourneyReference(taxonomyKey) {
  return effectiveJourneysForProduct(getProductByKey(taxonomyKey || 'generic'))
}

/**
 * @param {string} taxonomyKey
 */
export function getEipNodeMaps(taxonomyKey) {
  return getNodeMapsForProduct(taxonomyKey)
}

/**
 * 某产品的请求节点映射（Excel「请求节点-服务类型」「请求节点-问题子类」）；无配置则返回空映射
 * @param {string} taxonomyKey
 */
export function getNodeMapsForProduct(taxonomyKey) {
  const tax = getProductByKey(taxonomyKey)
  const builtin = BUILTIN_NODE_MAPS[taxonomyKey] || {
    serviceMap: {},
    issueMap: {},
    requestSceneMap: {},
    problemTypePathMap: {},
  }
  if (tax.nodeMaps) {
    return {
      serviceMap: { ...builtin.serviceMap, ...(tax.nodeMaps.serviceMap || {}) },
      issueMap: { ...builtin.issueMap, ...(tax.nodeMaps.issueMap || {}) },
      requestSceneMap: { ...builtin.requestSceneMap, ...(tax.nodeMaps.requestSceneMap || {}) },
      problemTypePathMap: {
        ...builtin.problemTypePathMap,
        ...(tax.nodeMaps.problemTypePathMap || {}),
      },
    }
  }
  return builtin
}

/** @param {string} taxonomyKey */
export function hasRequestNodeMaps(taxonomyKey) {
  const { serviceMap, issueMap } = getNodeMapsForProduct(taxonomyKey)
  return (
    Object.keys(serviceMap || {}).length > 0 || Object.keys(issueMap || {}).length > 0
  )
}

/**
 * @param {string} [productName]
 * @param {string} [productKey]
 * @returns {ThemeRule[]}
 */
export function getThemeRulesForProduct(productName, productKey) {
  const tax = getTaxonomy(productName, productKey)
  const fromJourney = journeyToThemeRules(tax.journeys)
  if (fromJourney.length) return fromJourney
  return DEFAULT_THEME_RULES
}

/**
 * @param {{ product?: string; productKey?: string }} record
 */
export function getThemeRulesForRecord(record) {
  return getThemeRulesForProduct(record?.product, record?.productKey)
}

export function listJourneyTemplates() {
  return Object.values(cache.products).map((tax) => ({
    key: tax.key,
    name: tax.name,
    l1Count: effectiveJourneysForProduct(tax).length,
    l2Count: effectiveJourneysForProduct(tax).reduce(
      (n, j) => n + (j.children?.length || 0),
      0,
    ),
  }))
}

/**
 * 托管标签库快照中的旅程列表：优先有效环节，空则回退运行时内置模板（避免目录同步后展示 0 条）
 * @param {import('./tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot['products'][string] | undefined} tax
 * @param {string} [productKey]
 */
export function resolveJourneysForManagedProduct(tax, productKey) {
  const key = productKey || tax?.key
  const effective = tax ? effectiveJourneysForProduct(tax) : []
  if (effective.length) return effective
  if (!key) return []
  const builtin = BUILTIN_PRODUCTS[key]?.journeys
  return builtin?.length ? builtin : []
}

/**
 * @param {import('./tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot | null | undefined} snapshot
 * @param {string} productKey
 */
export function countManagedProductJourneyL2(snapshot, productKey) {
  return resolveJourneysForManagedProduct(snapshot?.products?.[productKey], productKey).reduce(
    (n, j) => n + (j.children?.length || 0),
    0,
  )
}

/**
 * 合并运行时设置与旅程环节列表（themeRules 由用户旅程派生）
 * @param {import('./storage.js').AppSettings} settings
 * @param {{ product?: string; productKey?: string }} [record]
 */
export function settingsWithTaxonomy(settings, record) {
  const themeRules = record
    ? getThemeRulesForRecord(record)
    : getThemeRulesForProduct(undefined, 'generic')
  return { ...settings, themeRules }
}

/**
 * @param {import('./tagLibrary/overrides.js').TaxonomyOverrides | null} overrides
 */
export function applyTaxonomyOverridesFromMeta(overrides) {
  if (!overrides) return getTaxonomyState()
  cache.products = applyJourneyPatchesToProducts(cache.products, overrides)
  cache.sharedProblemTypes = mergeProblemTypes(
    cache.sharedProblemTypes || SHARED_PROBLEM_TYPES_BUILTIN,
    overrides.problemTypes,
  )
  cache.tagLibraryVersion = overrides.tagLibraryVersion || cache.tagLibraryVersion
  return getTaxonomyState()
}

export function getTagLibraryVersion() {
  return cache.tagLibraryVersion || 'taxonomy-static-1'
}

/**
 * 从当前内存缓存构建可持久化的对象与标签快照
 */
export function buildSnapshotFromCache() {
  /** @type {import('./tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} */
  const snapshot = {
    tagLibraryVersion: cache.tagLibraryVersion || 'taxonomy-static-1',
    updatedAt: new Date().toISOString(),
    sharedProblemTypes: JSON.parse(JSON.stringify(cache.sharedProblemTypes || [])),
    sharedRequestScenes: JSON.parse(JSON.stringify(cache.sharedRequestScenes || [])),
    products: {},
  }
  for (const [key, tax] of Object.entries(cache.products)) {
    snapshot.products[key] = {
      key,
      name: tax.name || key,
      match: tax.match || [],
      journeys: JSON.parse(JSON.stringify(tax.journeys || [])),
    }
  }
  return snapshot
}

/**
 * 应用本机对象与标签快照（覆盖旅程与通用问题类型）
 * @param {import('./tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot | null} snapshot
 */
export function applyManagedTaxonomySnapshot(snapshot) {
  if (!snapshot) return getTaxonomyState()
  const managedKeys = new Set(Object.keys(snapshot.products || {}))
  for (const key of Object.keys(cache.products)) {
    if (!managedKeys.has(key)) delete cache.products[key]
  }
  const genericJourneys = snapshot.products?.generic?.journeys
  for (const [key, data] of Object.entries(snapshot.products || {})) {
    const prev = cache.products[key]
    const normalized = normalizeProvisionedTemplate(
      {
        key,
        name: data.name || key,
        match: data.match?.length ? [...data.match] : data.match,
        journeys: Array.isArray(data.journeys)
          ? JSON.parse(JSON.stringify(data.journeys))
          : [],
        catalogProvisioned: data.catalogProvisioned,
        journeyConfigured: data.journeyConfigured,
      },
      genericJourneys,
    )
    cache.products[key] = {
      ...normalized,
      key,
      name: normalized.name || key,
      match: normalized.match?.length ? [...normalized.match] : [],
      themes: null,
      nodeMaps:
        data.nodeMaps ??
        prev?.nodeMaps ??
        (key === 'dc'
          ? { serviceMap: DC_NODE_SERVICE_MAP, issueMap: DC_NODE_ISSUE_MAP }
          : key === 'eip'
            ? { serviceMap: EIP_NODE_SERVICE_MAP, issueMap: EIP_NODE_ISSUE_MAP }
            : key === 'slb'
              ? { serviceMap: SLB_NODE_SERVICE_MAP, issueMap: SLB_NODE_ISSUE_MAP }
              : key === 'vpc'
                ? { serviceMap: VPC_NODE_SERVICE_MAP, issueMap: VPC_NODE_ISSUE_MAP }
                : null),
    }
  }
  if (snapshot.sharedProblemTypes?.length) {
    cache.sharedProblemTypes = snapshot.sharedProblemTypes
  }
  if (snapshot.sharedRequestScenes?.length) {
    cache.sharedRequestScenes = snapshot.sharedRequestScenes
  }
  if (snapshot.tagLibraryVersion) {
    cache.tagLibraryVersion = snapshot.tagLibraryVersion
  }
  if (snapshot.updatedAt) {
    cache.loadedAt = snapshot.updatedAt
  }
  return getTaxonomyState()
}

/**
 * @param {import('../domain/tagCandidate.js').TagCandidate} candidate
 */
export function buildOverridePatchFromCandidate(candidate) {
  if (candidate.tagType === 'request_scene') {
    return {
      requestScenes: [{ label: candidate.proposedLabel, keywords: [] }],
      problemTypes: [],
      journeyPatches: [],
    }
  }
  if (candidate.tagType === 'problem_type') {
    return {
      requestScenes: [],
      problemTypes: [{ label: candidate.proposedLabel, keywords: [] }],
      journeyPatches: [],
    }
  }
  return {
    requestScenes: [],
    problemTypes: [],
    journeyPatches: [
      {
        taxonomyKey: candidate.taxonomyKey || 'generic',
        journeyL1: candidate.journeyL1 || candidate.proposedLabel.split('>')[0]?.trim() || '其他',
        journeyL2: candidate.journeyL2 || candidate.proposedLabel.split('>')[1]?.trim() || candidate.proposedLabel,
        description: '',
        keywords: [],
      },
    ],
  }
}

/** 启动时预加载（内置默认；登录后由托管快照覆盖） */
export function ensureTaxonomyLoaded() {
  if (cache.loadedAt) return Promise.resolve(getTaxonomyState())
  return Promise.resolve(initTaxonomyCacheFromBuiltin())
}
