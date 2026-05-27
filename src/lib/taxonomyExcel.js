/**
 * 从 Excel 工作簿解析打标配置
 *
 * 跨表统一列名：产品Key | 一级ID/名称/说明 | 二级ID/名称/说明 | 参考关键词
 * 反馈主题已并入「用户旅程」；通用问题类型为全局表（无产品Key）
 */
import * as XLSX from 'xlsx'

/** @typedef {import('./themes.js').ThemeRule} ThemeRule */

const SHEET_ALIASES = {
  products: ['产品识别', '产品', '产品列表', 'products'],
  journeys: ['用户旅程', '旅程', 'journeys'],
  problemTypes: ['通用问题类型', '问题类型', 'problemTypes'],
  requestScenes: ['请求场景', '请求类型', 'requestScenes'],
  nodeService: ['请求节点-服务类型', '请求节点服务类型', '请求节点·一级', 'nodeService'],
  nodeIssue: ['请求节点-问题子类', '问题子类', '请求节点·一二级', 'nodeIssue'],
  guide: ['填写说明', '说明', 'guide'],
}

const COL = {
  productKey: ['产品Key', '产品key', 'key', '产品KEY'],
  productName: ['产品名称', '名称', 'name'],
  matchKeywords: ['匹配关键词', '匹配词', 'match'],
  keywords: ['参考关键词', '关键词', 'keywords'],
  l1Id: ['一级ID', '一级id', '一级环节ID', 'l1Id'],
  l1Name: ['一级名称', '一级环节', 'l1Label'],
  l1Desc: ['一级说明', '一级描述', 'l1Desc'],
  l2Id: ['二级ID', '二级id', '二级环节ID', 'l2Id'],
  l2Name: ['二级名称', '二级环节', 'l2Label'],
  l2Desc: ['二级说明', '二级描述', 'l2Desc'],
  problemTypeName: ['问题类型名称', '类型名称', '问题类型', 'label'],
  problemTypeDesc: ['问题类型说明', '类型说明'],
  requestSceneName: ['请求场景名称', '场景名称', '请求场景', 'label'],
  requestSceneDesc: ['请求场景说明', '场景说明'],
  nodeServiceType: ['请求节点服务类型', '服务类型', 'serviceType'],
  nodeIssueType: ['请求节点问题子类', '问题子类', '问题子类名称', 'issueType'],
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} keys
 */
function pick(row, keys) {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/**
 * @param {string} text
 */
function splitKeywords(text) {
  return String(text || '')
    .split(/[,，;；\n]/)
    .map((k) => k.trim())
    .filter(Boolean)
}

/**
 * @param {import('xlsx').WorkBook} wb
 * @param {keyof SHEET_ALIASES} kind
 */
function getSheet(wb, kind) {
  const names = SHEET_ALIASES[kind]
  const sheetName = wb.SheetNames.find((n) =>
    names.some((alias) => n === alias || n.includes(alias)),
  )
  if (!sheetName) return []
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
function parseProductsMeta(rows) {
  /** @type {Record<string, { key: string; name: string; match: string[] }>} */
  const meta = {}
  for (const row of rows) {
    const key = pick(row, COL.productKey)
    if (!key) continue
    meta[key] = {
      key,
      name: pick(row, COL.productName) || key,
      match: splitKeywords(pick(row, COL.matchKeywords)),
    }
  }
  return meta
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
function parseJourneys(rows) {
  /** @type {Record<string, Map<string, object>>} */
  const byProduct = {}

  for (const row of rows) {
    const pKey = pick(row, COL.productKey) || 'generic'
    const l1Id = pick(row, COL.l1Id)
    const l1Label = pick(row, COL.l1Name)
    if (!l1Id && !l1Label) continue

    if (!byProduct[pKey]) byProduct[pKey] = new Map()
    const l1Map = byProduct[pKey]
    const l1Key = l1Id || l1Label

    if (!l1Map.has(l1Key)) {
      l1Map.set(l1Key, {
        id: l1Id || l1Key,
        label: l1Label || l1Id,
        description: pick(row, COL.l1Desc),
        children: [],
      })
    }

    const l1 = l1Map.get(l1Key)
    const l2Id = pick(row, COL.l2Id)
    const l2Label = pick(row, COL.l2Name)
    if (!l2Id && !l2Label) continue

    l1.children.push({
      id: l2Id || l2Label,
      label: l2Label || l2Id,
      description: pick(row, COL.l2Desc),
      keywords: splitKeywords(pick(row, COL.keywords)),
    })
  }

  /** @type {Record<string, object[]>} */
  const result = {}
  for (const [pKey, l1Map] of Object.entries(byProduct)) {
    result[pKey] = [...l1Map.values()]
  }
  return result
}

/**
 * 全局通用问题类型（不按产品区分；旧表含产品Key 时忽略该列）
 * @param {Array<Record<string, unknown>>} rows
 */
function parseSharedTagRows(rows, nameKeys, descKeys) {
  /** @type {Map<string, { label: string; description?: string; keywords: string[] }>} */
  const byLabel = new Map()

  for (const row of rows) {
    const label = pick(row, nameKeys)
    if (!label) continue
    if (!byLabel.has(label)) {
      const desc = pick(row, descKeys)
      byLabel.set(label, {
        label,
        description: desc || undefined,
        keywords: splitKeywords(pick(row, COL.keywords)),
      })
    }
  }
  return [...byLabel.values()]
}

function parseSharedProblemTypes(rows) {
  return parseSharedTagRows(rows, COL.problemTypeName, COL.problemTypeDesc)
}

function parseSharedRequestScenes(rows) {
  return parseSharedTagRows(rows, COL.requestSceneName, COL.requestSceneDesc)
}

/**
 * @param {Array<Record<string, unknown>>} serviceRows
 * @param {Array<Record<string, unknown>>} issueRows
 */
function parseNodeMaps(serviceRows, issueRows) {
  /** @type {Record<string, { serviceMap: Record<string, string>; issueMap: Record<string, { l1: string; l2?: string }> }>} */
  const maps = {}

  for (const row of serviceRows) {
    const pKey = pick(row, COL.productKey)
    const serviceType = pick(row, COL.nodeServiceType)
    const l1Id = pick(row, COL.l1Id)
    if (!pKey || !serviceType || !l1Id) continue
    if (!maps[pKey]) maps[pKey] = { serviceMap: {}, issueMap: {} }
    maps[pKey].serviceMap[serviceType] = l1Id
  }

  for (const row of issueRows) {
    const pKey = pick(row, COL.productKey)
    const issueType = pick(row, COL.nodeIssueType)
    const l1Id = pick(row, COL.l1Id)
    if (!pKey || !issueType || !l1Id) continue
    if (!maps[pKey]) maps[pKey] = { serviceMap: {}, issueMap: {} }
    const l2Id = pick(row, COL.l2Id)
    maps[pKey].issueMap[issueType] = l2Id ? { l1: l1Id, l2: l2Id } : { l1: l1Id }
  }

  return maps
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ products: Record<string, object>; sharedProblemTypes: { label: string; keywords: string[] }[] }}
 */
export function parseTaxonomyWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })

  const productRows = getSheet(wb, 'products')
  const journeyRows = getSheet(wb, 'journeys')
  const problemRows = getSheet(wb, 'problemTypes')
  const requestSceneRows = getSheet(wb, 'requestScenes')
  const serviceRows = getSheet(wb, 'nodeService')
  const issueRows = getSheet(wb, 'nodeIssue')

  const meta = parseProductsMeta(productRows)
  const journeys = parseJourneys(journeyRows)
  const sharedProblemTypes = parseSharedProblemTypes(problemRows)
  const sharedRequestScenes = parseSharedRequestScenes(requestSceneRows)
  const nodeMaps = parseNodeMaps(serviceRows, issueRows)

  const allKeys = new Set([...Object.keys(meta), ...Object.keys(journeys)])

  /** @type {Record<string, object>} */
  const products = {}
  for (const key of allKeys) {
    products[key] = {
      key,
      name: meta[key]?.name || key,
      match: meta[key]?.match || [],
      journeys: journeys[key] || [],
      themes: null,
      problemTypes: [],
      nodeMaps: nodeMaps[key] || null,
    }
  }

  return { products, sharedProblemTypes, sharedRequestScenes }
}
