import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { normalizeCatalogProducts } from '../src/lib/productCatalogManageModel.js'
import { META_KEY_PRODUCT_CATALOG_MANAGED } from '../src/storage/productCatalogStore.js'
import { storageRepository } from './storageRepository.js'
import { bumpRecordsRevision } from './dataRevision.js'
import { PROJECT_ROOT } from './taxonomyPublish.js'
import { writeBufferAtomically } from './writeFileAtomic.js'

export const PRODUCT_CATALOG_DIR =
  process.env.PRODUCT_CATALOG_CONFIG_DIR ||
  path.join(PROJECT_ROOT, 'public/config/product-catalog')
export const PRODUCT_CATALOG_EXCEL_FILE =
  process.env.PRODUCT_CATALOG_EXCEL_FILE || '产品规格配置.xlsx'
export const PRODUCT_CATALOG_JSON_FILE =
  process.env.PRODUCT_CATALOG_JSON_FILE || 'product-catalog.json'

/**
 * @param {import('../src/lib/productCatalogLoader.js').CatalogProduct[]} products
 */
export function buildProductCatalogSheets(products) {
  const guideRows = [
    {
      工作表: '（总览）',
      说明: '由「对象与标签 → 发布产品目录到服务端」从共享库生成。导入时仅分析「是否启用=是」的产品。',
      示例: new Date().toISOString(),
    },
    {
      工作表: '目标产品',
      说明: '每行一个目标产品。产品Key 唯一；旅程模板Key 对应打标配置中的产品Key',
      示例: 'eip | 弹性公网IP | 是 | eip | 是',
    },
    {
      工作表: '产品规格',
      说明: '每行一个规格，用产品Key 关联。匹配别名：逗号分隔',
      示例: 'eip | 弹性公网IP-移动IP | 别名1,别名2',
    },
  ]

  const productRows = products.map((p) => ({
    产品Key: p.key,
    产品名称: p.name,
    是否启用: p.enabled ? '是' : '否',
    旅程模板Key: p.taxonomyKey || p.key,
    接受产品名匹配: p.acceptParentName !== false ? '是' : '否',
  }))

  /** @type {Record<string, unknown>[]} */
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

  return {
    填写说明: guideRows,
    目标产品: productRows,
    产品规格: specRows,
  }
}

/**
 * @param {Record<string, Record<string, unknown>[]>} sheets
 */
function writeProductCatalogWorkbook(sheets) {
  const wb = XLSX.utils.book_new()
  for (const name of ['填写说明', '目标产品', '产品规格']) {
    const rows = sheets[name] || []
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows.length ? rows : [{ 提示: '暂无数据' }]),
      name,
    )
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/**
 * @param {import('../src/lib/productCatalogLoader.js').CatalogProduct[]} products
 * @param {string} dir
 */
function publishProductCatalogJson(products, dir) {
  const jsonPath = path.join(dir, PRODUCT_CATALOG_JSON_FILE)
  /** @type {Record<string, unknown>} */
  let base = {
    version: 1,
    description:
      '目标产品与产品规格关系表。导入时仅分析 enabled=true 的产品及其规格。',
    products: [],
  }
  if (fs.existsSync(jsonPath)) {
    try {
      base = { ...JSON.parse(fs.readFileSync(jsonPath, 'utf8')), ...base }
    } catch {
      /* use defaults */
    }
  }
  const payload = {
    ...base,
    version: 1,
    updatedAt: new Date().toISOString(),
    products,
  }
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')
  return jsonPath
}

/**
 * @param {{ writeJson?: boolean; publishedBy?: string }} [options]
 */
export function publishProductCatalogToFiles(options = {}) {
  const { writeJson = true, publishedBy = 'system' } = options

  const snap = storageRepository.getMeta(META_KEY_PRODUCT_CATALOG_MANAGED)
  if (!snap?.products?.length) {
    throw new Error('共享库中尚无产品目录配置，请先在「产品配置」中保存')
  }

  const products = normalizeCatalogProducts(snap.products)
  fs.mkdirSync(PRODUCT_CATALOG_DIR, { recursive: true })

  const excelPath = path.join(PRODUCT_CATALOG_DIR, PRODUCT_CATALOG_EXCEL_FILE)

  const sheets = buildProductCatalogSheets(products)
  const buffer = writeProductCatalogWorkbook(sheets)
  const excelWrite = writeBufferAtomically(excelPath, Buffer.from(buffer))

  const jsonPath = writeJson ? publishProductCatalogJson(products, PRODUCT_CATALOG_DIR) : null

  const enabledCount = products.filter((p) => p.enabled).length
  const specCount = products.reduce((n, p) => n + (p.specs?.length || 0), 0)

  const meta = {
    lastPublishedAt: new Date().toISOString(),
    lastPublishedBy: publishedBy,
    excelPath,
    jsonPath,
  }
  storageRepository.putMeta('product_catalog_last_publish', meta)
  bumpRecordsRevision()

  return {
    ok: true,
    excelPath,
    jsonPath,
    excelSize: excelWrite.size,
    excelModifiedAt: excelWrite.modifiedAt,
    stats: {
      products: products.length,
      enabled: enabledCount,
      specs: specCount,
    },
    publishedAt: meta.lastPublishedAt,
    publishedBy,
  }
}

export function getProductCatalogPublishStatus() {
  const excelPath = path.join(PRODUCT_CATALOG_DIR, PRODUCT_CATALOG_EXCEL_FILE)
  const jsonPath = path.join(PRODUCT_CATALOG_DIR, PRODUCT_CATALOG_JSON_FILE)
  const managed = storageRepository.getMeta(META_KEY_PRODUCT_CATALOG_MANAGED)
  const lastPublish = storageRepository.getMeta('product_catalog_last_publish')
  const managedAt =
    managed && typeof managed === 'object' && 'updatedAt' in managed
      ? String(/** @type {{ updatedAt?: string }} */ (managed).updatedAt || '')
      : ''
  const publishedAt =
    lastPublish && typeof lastPublish === 'object' && 'lastPublishedAt' in lastPublish
      ? String(/** @type {{ lastPublishedAt?: string }} */ (lastPublish).lastPublishedAt || '')
      : ''
  const diskStale = Boolean(
    managedAt && (!publishedAt || managedAt.localeCompare(publishedAt) > 0),
  )
  return {
    configured: true,
    dir: PRODUCT_CATALOG_DIR,
    excelPath,
    excelFile: PRODUCT_CATALOG_EXCEL_FILE,
    jsonPath,
    jsonFile: PRODUCT_CATALOG_JSON_FILE,
    exists: fs.existsSync(excelPath),
    jsonExists: fs.existsSync(jsonPath),
    lastPublish,
    lastError: storageRepository.getMeta('product_catalog_publish_error'),
    managedUpdatedAt: managedAt || null,
    diskStale,
  }
}
