import * as XLSX from 'xlsx'
import { parseProductCatalogWorkbook } from './productCatalogExcel.js'
import { canonicalTaxonomyKey } from './taxonomyKeyAliases.js'

/** @typedef {import('./productCatalogLoader.js').CatalogProduct} CatalogProduct */
/** @typedef {import('./productCatalogLoader.js').ProductSpecDef} ProductSpecDef */

/**
 * @param {string} name
 */
export function slugProductKey(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32) || `product_${Date.now()}`
}

/**
 * @param {unknown} raw
 * @returns {CatalogProduct[]}
 */
export function normalizeCatalogProducts(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p) => p && typeof p === 'object' && p.key)
    .map((p) => {
      const key = canonicalTaxonomyKey(String(p.key).trim())
      return {
        key,
        name: String(p.name || p.key).trim(),
        enabled: Boolean(p.enabled),
        analysisPostUseRating: Boolean(p.analysisPostUseRating),
        focusTracked: Boolean(p.analysisPostUseRating && p.focusTracked),
        taxonomyKey: canonicalTaxonomyKey(String(p.taxonomyKey || p.key || '').trim()),
        acceptParentName: p.acceptParentName !== false,
        specs: (p.specs || [])
          .filter((s) => s?.name)
          .map((s) => ({
            name: String(s.name).trim(),
            match: Array.isArray(s.match)
              ? s.match.map((m) => String(m).trim()).filter(Boolean)
              : undefined,
          })),
      }
    })
}

/**
 * @param {CatalogProduct[]} products
 */
export function validateCatalogProducts(products) {
  const keys = new Set()
  for (const p of products) {
    if (!p.key?.trim()) throw new Error('产品 Key 不能为空')
    if (keys.has(p.key)) throw new Error(`产品 Key 重复：${p.key}`)
    keys.add(p.key)
    if (!p.name?.trim()) throw new Error(`产品「${p.key}」名称不能为空`)
    const specNames = new Set()
    for (const s of p.specs || []) {
      if (!s.name?.trim()) throw new Error(`产品「${p.name}」存在空规格名称`)
      if (specNames.has(s.name)) throw new Error(`产品「${p.name}」规格名称重复：${s.name}`)
      specNames.add(s.name)
    }
  }
}

/**
 * @param {CatalogProduct} product
 * @param {string} key
 */
export function ensureUniqueProductKey(products, key, excludeKey) {
  if (products.some((p) => p.key === key && p.key !== excludeKey)) {
    throw new Error(`产品 Key 已存在：${key}`)
  }
}

/**
 * 按 Key 合并导入的 hover / 说明文案
 */
export const MERGE_CATALOG_BY_KEY_HELP = `按 Key 匹配合并到共享库：
· 产品：以「产品 Key」为 Key；新 Key 会新增，已存在 Key 会覆盖名称、是否启用、旅程模板 Key、接受产品名匹配
· 规格：以「产品 Key + 规格名称」为 Key；新 Key 会新增，已存在 Key 会覆盖匹配别名（名称即 Key，不会改名）
· 共享库中有而 Excel 中无的行不会删除`

/**
 * @param {{ added: { products: number; specs: number }; updated: { products: number; specs: number } }} result
 */
export function formatMergeCatalogResultMessage(result) {
  const { added, updated } = result
  return `合并导入完成：新增 产品 ${added.products}、规格 ${added.specs}；更新 产品 ${updated.products}、规格 ${updated.specs}`
}

/**
 * @param {CatalogProduct[]} current
 * @param {CatalogProduct[]} incoming
 * @param {{ replace?: boolean }} [opts]
 */
export function mergeCatalogByKey(current, incoming, opts = {}) {
  const normalized = normalizeCatalogProducts(incoming)
  validateCatalogProducts(normalized)

  if (opts.replace) {
    const specCount = normalized.reduce((n, p) => n + (p.specs?.length || 0), 0)
    return {
      products: normalized,
      added: { products: normalized.length, specs: specCount },
      updated: { products: 0, specs: 0 },
    }
  }

  /** @type {Map<string, CatalogProduct>} */
  const byKey = new Map(current.map((p) => [p.key, structuredClone(p)]))
  let addedProducts = 0
  let addedSpecs = 0
  let updatedProducts = 0
  let updatedSpecs = 0

  for (const inc of normalized) {
    if (!byKey.has(inc.key)) {
      byKey.set(inc.key, inc)
      addedProducts += 1
      addedSpecs += inc.specs?.length || 0
      continue
    }
    const cur = byKey.get(inc.key)
    cur.name = inc.name || cur.name
    cur.enabled = inc.enabled
    cur.analysisPostUseRating = Boolean(inc.analysisPostUseRating)
    cur.focusTracked = Boolean(inc.focusTracked)
    cur.taxonomyKey = inc.taxonomyKey || cur.taxonomyKey
    cur.acceptParentName = inc.acceptParentName
    updatedProducts += 1

    const specByName = new Map((cur.specs || []).map((s) => [s.name, s]))
    for (const spec of inc.specs || []) {
      if (!specByName.has(spec.name)) {
        specByName.set(spec.name, { ...spec })
        addedSpecs += 1
      } else {
        const prev = specByName.get(spec.name)
        prev.match = spec.match?.length ? [...spec.match] : undefined
        updatedSpecs += 1
      }
    }
    cur.specs = [...specByName.values()]
  }

  return {
    products: [...byKey.values()],
    added: { products: addedProducts, specs: addedSpecs },
    updated: { products: updatedProducts, specs: updatedSpecs },
  }
}

/** @deprecated 使用 mergeCatalogByKey */
export const mergeCatalogImport = mergeCatalogByKey

/**
 * @param {ArrayBuffer} buffer
 */
export function parseCatalogImportFile(buffer) {
  const { products } = parseProductCatalogWorkbook(buffer)
  return normalizeCatalogProducts(products)
}

/**
 * @param {unknown} raw
 */
export function parseCatalogImportJson(raw) {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
  const list = obj?.products ?? obj
  return normalizeCatalogProducts(list)
}

/**
 * @param {CatalogProduct[]} products
 * @param {string} [filename]
 */
export function downloadProductCatalogExcel(products, filename = '产品规格配置.xlsx') {
  const guideRows = [
    {
      工作表: '（总览）',
      说明: '导入时仅分析「是否启用=是」的产品；工单「产品规格」列须匹配规格名称或别名',
      示例: '—',
    },
    {
      工作表: '目标产品',
      说明: '每行一个目标产品。产品Key 唯一',
      示例: 'eip | 弹性公网IP | 是 | eip | 是',
    },
    {
      工作表: '产品规格',
      说明: '每行一个规格，用产品Key 关联',
      示例: 'eip | 弹性公网IP-移动IP | 别名1,别名2',
    },
  ]

  const productRows = products.map((p) => ({
    产品Key: p.key,
    产品名称: p.name,
    是否启用: p.enabled ? '是' : '否',
    用后即评分析: p.analysisPostUseRating ? '是' : '否',
    重点跟踪: p.focusTracked ? '是' : '否',
    旅程模板Key: p.taxonomyKey || p.key,
    接受产品名匹配: p.acceptParentName !== false ? '是' : '否',
  }))

  const specRows = []
  for (const p of products) {
    for (const s of p.specs || []) {
      specRows.push({
        产品Key: p.key,
        规格名称: s.name,
        匹配别名: (s.match || []).join(','),
      })
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(guideRows), '填写说明')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows), '目标产品')
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(specRows.length ? specRows : [{ 提示: '暂无规格' }]),
    '产品规格',
  )

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {CatalogProduct[]} products
 * @param {string} [filename]
 */
export function downloadProductCatalogJson(products, filename = 'product-catalog.json') {
  const blob = new Blob([JSON.stringify({ products }, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {CatalogProduct[]} products
 */
export function catalogToTableRows(products) {
  return products.map((p) => ({
    key: p.key,
    name: p.name,
    enabled: p.enabled,
    analysisPostUseRating: Boolean(p.analysisPostUseRating),
    focusTracked: Boolean(p.analysisPostUseRating && p.focusTracked),
    taxonomyKey: p.taxonomyKey,
    acceptParentName: p.acceptParentName !== false,
    specs: p.specs || [],
    specCount: (p.specs || []).length,
  }))
}
