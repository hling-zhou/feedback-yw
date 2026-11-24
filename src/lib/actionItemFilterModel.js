import {
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_STATUS_LABELS,
} from '../domain/actionItem.js'
import { isAnalysisEnabledProduct } from './productCatalog/analysisScope.js'

/** @typedef {import('../domain/actionItem.js').ActionItemStatus} ActionItemStatus */
/** @typedef {import('./productCatalogLoader.js').CatalogProduct} CatalogProduct */

/**
 * @typedef {Object} ActionItemFilterValues
 * @property {string[]} productKeys
 * @property {ActionItemStatus[]} statuses
 * @property {string} ticketId
 * @property {string} problemType
 * @property {string} journeyL1
 */

/** @typedef {keyof ActionItemFilterValues} ActionItemFilterKey */

/** @type {{ label: string; keys: ActionItemFilterKey[] }[]} */
export const ACTION_ITEM_FILTER_GROUPS = [
  { label: '关联', keys: ['ticketId'] },
  { label: '举措', keys: ['productKeys', 'statuses'] },
  { label: '问题维度', keys: ['problemType', 'journeyL1'] },
]

/** @type {Record<ActionItemFilterKey, string>} */
export const ACTION_ITEM_FILTER_LABELS = {
  productKeys: '产品',
  statuses: '状态',
  ticketId: '关联反馈号',
  problemType: '问题类型',
  journeyL1: '用户旅程',
}

/** @returns {ActionItemFilterValues} */
export function createEmptyActionItemFilters() {
  return {
    productKeys: [],
    statuses: [],
    ticketId: '',
    problemType: '',
    journeyL1: '',
  }
}

/**
 * @param {ActionItemFilterValues} values
 * @param {ActionItemFilterKey} key
 */
export function isActionItemFilterActive(values, key) {
  switch (key) {
    case 'productKeys':
      return values.productKeys.length > 0
    case 'statuses':
      return values.statuses.length > 0
    case 'ticketId':
      return Boolean(values.ticketId.trim())
    case 'problemType':
      return Boolean(values.problemType.trim())
    case 'journeyL1':
      return Boolean(values.journeyL1.trim())
    default:
      return false
  }
}

/**
 * @param {ActionItemFilterValues} values
 * @returns {ActionItemFilterKey[]}
 */
export function listActiveActionItemFilterChipKeys(values) {
  /** @type {ActionItemFilterKey[]} */
  const keys = []
  if (isActionItemFilterActive(values, 'ticketId')) keys.push('ticketId')
  if (isActionItemFilterActive(values, 'productKeys')) keys.push('productKeys')
  if (isActionItemFilterActive(values, 'statuses')) keys.push('statuses')
  if (isActionItemFilterActive(values, 'problemType')) keys.push('problemType')
  if (isActionItemFilterActive(values, 'journeyL1')) keys.push('journeyL1')
  return keys
}

/**
 * @param {ActionItemFilterValues} values
 */
export function countActiveActionItemFilters(values) {
  return listActiveActionItemFilterChipKeys(values).length
}

/**
 * @param {ActionItemFilterKey} key
 * @param {ActionItemFilterValues} values
 * @param {{ productNameByKey?: Map<string, string> }} [ctx]
 */
export function formatActionItemFilterChipLabel(key, values, ctx = {}) {
  const nameByKey = ctx.productNameByKey || new Map()
  switch (key) {
    case 'productKeys': {
      if (values.productKeys.length === 1) {
        const pk = values.productKeys[0]
        return nameByKey.get(pk) || pk
      }
      return `${values.productKeys.length} 个`
    }
    case 'statuses': {
      if (values.statuses.length === 1) {
        return ACTION_ITEM_STATUS_LABELS[values.statuses[0]] || values.statuses[0]
      }
      return `${values.statuses.length} 个`
    }
    case 'ticketId':
      return values.ticketId.trim()
    case 'problemType':
      return values.problemType.trim()
    case 'journeyL1':
      return values.journeyL1.trim()
    default:
      return ''
  }
}

/**
 * @param {ActionItemFilterKey} key
 * @param {ActionItemFilterValues} values
 */
export function isActionItemFilterAddDisabled(key, values) {
  return isActionItemFilterActive(values, key)
}

/**
 * @param {ActionItemFilterKey} key
 * @param {ActionItemFilterValues} values
 * @returns {string | undefined}
 */
export function getActionItemFilterAddDisabledReason(key, values) {
  if (isActionItemFilterActive(values, key)) return '已添加该筛选条件'
  return undefined
}

/**
 * @param {ActionItemFilterKey} key
 */
export function normalizeActionItemFilterEditorKey(key) {
  return key
}

/**
 * @param {ActionItemFilterKey} key
 * @param {Partial<ActionItemFilterValues>} patch
 * @param {ActionItemFilterValues} current
 * @returns {ActionItemFilterValues}
 */
export function applyActionItemFilterPatch(key, patch, current) {
  return { ...current, ...patch }
}

/**
 * @param {ActionItemFilterKey} key
 * @param {ActionItemFilterValues} current
 * @returns {ActionItemFilterValues}
 */
export function clearActionItemFilterKey(key, current) {
  /** @type {Partial<ActionItemFilterValues>} */
  const patch = {}
  switch (key) {
    case 'productKeys':
      patch.productKeys = []
      break
    case 'statuses':
      patch.statuses = []
      break
    case 'ticketId':
      patch.ticketId = ''
      break
    case 'problemType':
      patch.problemType = ''
      break
    case 'journeyL1':
      patch.journeyL1 = ''
      break
    default:
      break
  }
  return applyActionItemFilterPatch(key, patch, current)
}

/** @returns {ActionItemFilterValues} */
export function clearAllActionItemFilters() {
  return createEmptyActionItemFilters()
}

/**
 * 举措筛选/表单用产品选项：value 必须是唯一 productKey（禁止 taxonomy generic 塌缩）。
 * 优先产品目录名，再用举措库中的 productKey 补齐未入库项。
 *
 * 11-24 口径：传入 catalogProducts 时选项收窄到「分析范围内」产品
 * （enabled || analysisPostUseRating，与专题分析 analysisScope 同判据）——
 * 云主机/云硬盘等双开关全关的产品不进复合搜索（先例：用户报告部署环境
 * 复合搜索出现范围外产品）。库内举措存量若含范围外 key（历史数据），
 * 目录给出的范围外 key 一并排除，杜绝"筛了但永远筛不出有意义的集合"。
 * 未传 catalogProducts 时保持旧行为（全部 productNameByKey + scopeItems），
 * 兼容旧调用方与测试。
 *
 * @param {{ productKey?: string; productName?: string }[]} [scopeItems]
 * @param {Map<string, string> | Record<string, string>} [productNameByKey]
 * @param {CatalogProduct[]} [catalogProducts]
 * @returns {{ label: string; value: string }[]}
 */
export function buildActionItemProductFilterOptions(scopeItems = [], productNameByKey, catalogProducts) {
  /** @type {Map<string, string>} */
  const map = new Map()

  if (productNameByKey instanceof Map) {
    for (const [key, name] of productNameByKey) {
      const k = String(key || '').trim()
      if (!k) continue
      map.set(k, String(name || '').trim() || k)
    }
  } else if (productNameByKey && typeof productNameByKey === 'object') {
    for (const [key, name] of Object.entries(productNameByKey)) {
      const k = String(key || '').trim()
      if (!k) continue
      map.set(k, String(name || '').trim() || k)
    }
  }

  /** 11-24：分析范围内 key 白名单（目录 key 精确匹配） */
  const inScopeKeys =
    Array.isArray(catalogProducts) && catalogProducts.length
      ? new Set(catalogProducts.filter(isAnalysisEnabledProduct).map((p) => String(p.key || '').trim()))
      : null

  for (const item of scopeItems) {
    const k = item?.productKey?.trim()
    if (!k || map.has(k)) continue
    map.set(k, item.productName?.trim() || k)
  }

  return [...map.entries()]
    .filter(([value]) => !inScopeKeys || inScopeKeys.has(value))
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

/**
 * @param {ActionItemFilterValues} filters
 * @returns {{
 *   productKeys?: string
 *   statuses?: string
 *   ticketId?: string
 *   problemType?: string
 *   journeyL1?: string
 * }}
 */
export function actionItemFiltersToListQuery(filters) {
  return {
    productKeys: filters.productKeys.length ? filters.productKeys.join(',') : undefined,
    statuses: filters.statuses.length ? filters.statuses.join(',') : undefined,
    ticketId: filters.ticketId.trim() || undefined,
    problemType: filters.problemType.trim() || undefined,
    journeyL1: filters.journeyL1.trim() || undefined,
  }
}
