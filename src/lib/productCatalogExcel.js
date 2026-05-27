/**
 * 从 Excel 解析「目标产品 · 产品规格」配置
 */
import * as XLSX from 'xlsx'

const SHEET_ALIASES = {
  guide: ['填写说明', '说明', 'guide'],
  products: ['目标产品', '产品列表', 'products'],
  specs: ['产品规格', '规格列表', 'specs'],
}

const COL = {
  productKey: ['产品Key', '产品key', 'key', '产品KEY'],
  productName: ['产品名称', '名称', 'name'],
  enabled: ['是否启用', '启用', 'enabled'],
  taxonomyKey: ['旅程模板Key', '打标模板Key', 'taxonomyKey', '模板Key'],
  acceptParentName: ['接受产品名匹配', '允许产品名', 'acceptParentName'],
  specName: ['规格名称', '产品规格名称', '规格', 'name'],
  matchAliases: ['匹配别名', '别名', '匹配关键词', 'match'],
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
function splitList(text) {
  return String(text || '')
    .split(/[,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * @param {string} text
 */
function parseEnabled(text) {
  const s = String(text || '').trim().toLowerCase()
  if (!s) return false
  return ['是', 'yes', 'y', '1', 'true', '启用', '开启'].includes(s)
}

/**
 * @param {string} text
 */
function parseAcceptParent(text) {
  const s = String(text || '').trim().toLowerCase()
  if (!s) return true
  if (['否', 'no', 'n', '0', 'false', '关闭'].includes(s)) return false
  return true
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
 * @param {ArrayBuffer} buffer
 * @returns {{ products: import('./productCatalogLoader.js').CatalogProduct[] }}
 */
export function parseProductCatalogWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const productRows = getSheet(wb, 'products')
  const specRows = getSheet(wb, 'specs')

  /** @type {Map<string, import('./productCatalogLoader.js').CatalogProduct>} */
  const byKey = new Map()

  for (const row of productRows) {
    const key = pick(row, COL.productKey)
    if (!key) continue
    byKey.set(key, {
      key,
      name: pick(row, COL.productName) || key,
      enabled: parseEnabled(pick(row, COL.enabled)),
      taxonomyKey: pick(row, COL.taxonomyKey) || key,
      acceptParentName: parseAcceptParent(pick(row, COL.acceptParentName)),
      specs: [],
    })
  }

  for (const row of specRows) {
    const pKey = pick(row, COL.productKey)
    const name = pick(row, COL.specName)
    if (!pKey || !name) continue
    if (!byKey.has(pKey)) {
      byKey.set(pKey, {
        key: pKey,
        name: pKey,
        enabled: false,
        taxonomyKey: pKey,
        acceptParentName: true,
        specs: [],
      })
    }
    const product = byKey.get(pKey)
    const match = splitList(pick(row, COL.matchAliases))
    product.specs.push({
      name,
      match: match.length ? match : undefined,
    })
  }

  return { products: [...byKey.values()] }
}
