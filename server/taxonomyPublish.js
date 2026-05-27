import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { keywordsToText } from '../src/lib/tagLibrary/taxonomyManageModel.js'
import { META_KEY_TAXONOMY_MANAGED } from '../src/lib/tagLibrary/taxonomyManageModel.js'
import { storageRepository } from './storageRepository.js'
import { bumpDataRevision } from './dataRevision.js'
import { writeBufferAtomically } from './writeFileAtomic.js'

/** @type {Record<string, string[]>} */
const MANAGED_SHEET_HEADERS = {
  产品识别: ['产品Key', '产品名称', '匹配关键词'],
  用户旅程: [
    '产品Key',
    '一级ID',
    '一级名称',
    '一级说明',
    '二级ID',
    '二级名称',
    '二级说明',
    '参考关键词',
  ],
  请求场景: ['请求场景名称', '请求场景说明', '参考关键词'],
  通用问题类型: ['问题类型名称', '问题类型说明', '参考关键词'],
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = process.env.PROJECT_ROOT || path.join(__dirname, '..')
export const TAXONOMY_DIR =
  process.env.TAXONOMY_CONFIG_DIR || path.join(PROJECT_ROOT, 'public/config/taxonomy')
export const TAXONOMY_EXCEL_FILE = process.env.TAXONOMY_EXCEL_FILE || '打标配置.xlsx'

const OPTIONAL_SHEET_NAMES = new Set([
  '填写说明',
  '请求节点-服务类型',
  '请求节点-问题子类',
])

const MANAGED_SHEET_NAMES = new Set([
  '填写说明',
  '产品识别',
  '用户旅程',
  '请求场景',
  '通用问题类型',
  '请求节点-服务类型',
  '请求节点-问题子类',
])

/**
 * @param {import('../src/lib/tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 */
export function buildManagedSheetsFromSnapshot(snapshot) {
  /** @type {Record<string, unknown>[]} */
  const productRows = []
  for (const [pKey, tax] of Object.entries(snapshot.products || {})) {
    productRows.push({
      产品Key: pKey,
      产品名称: tax.name || pKey,
      匹配关键词: (tax.match || []).join(','),
    })
  }

  /** @type {Record<string, unknown>[]} */
  const journeyRows = []
  for (const [pKey, tax] of Object.entries(snapshot.products || {})) {
    for (const l1 of tax.journeys || []) {
      for (const l2 of l1.children || []) {
        journeyRows.push({
          产品Key: pKey,
          一级ID: l1.id || l1.label,
          一级名称: l1.label,
          一级说明: l1.description || '',
          二级ID: l2.id || l2.label,
          二级名称: l2.label,
          二级说明: l2.description || '',
          参考关键词: keywordsToText(l2.keywords),
        })
      }
    }
  }

  const requestSceneRows = (snapshot.sharedRequestScenes || []).map((rs) => ({
    请求场景名称: rs.label,
    请求场景说明: rs.description || '',
    参考关键词: keywordsToText(rs.keywords),
  }))

  const problemTypeRows = (snapshot.sharedProblemTypes || []).map((pt) => ({
    问题类型名称: pt.label,
    问题类型说明: pt.description || '',
    参考关键词: keywordsToText(pt.keywords),
  }))

  return {
    产品识别: productRows,
    用户旅程: journeyRows,
    请求场景: requestSceneRows,
    通用问题类型: problemTypeRows,
  }
}

/**
 * 共享库未同步的请求场景等，发布前从磁盘 index / 现有 Excel 补全（避免只更新 JSON）。
 * @param {import('../src/lib/tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @param {string} dir
 * @param {string} excelPath
 */
function hydrateSnapshotForPublish(snapshot, dir, excelPath) {
  const next = structuredClone(snapshot)
  const indexPath = path.join(dir, 'index.json')
  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      if (!next.sharedRequestScenes?.length && index.sharedRequestScenes?.length) {
        next.sharedRequestScenes = index.sharedRequestScenes
      }
      if (!next.sharedProblemTypes?.length && index.sharedProblemTypes?.length) {
        next.sharedProblemTypes = index.sharedProblemTypes
      }
    } catch {
      /* ignore */
    }
  }

  if (!next.sharedRequestScenes?.length && fs.existsSync(excelPath)) {
    try {
      const wb = XLSX.read(fs.readFileSync(excelPath), { type: 'buffer' })
      const sheet = wb.Sheets['请求场景']
      if (sheet) {
        const rows = XLSX.utils.sheet_to_json(sheet).filter((r) => {
          const name = r['请求场景名称']
          return name && String(name).trim() && !r['提示']
        })
        if (rows.length) {
          next.sharedRequestScenes = rows.map((r) => ({
            label: String(r['请求场景名称']).trim(),
            description: r['请求场景说明'] ? String(r['请求场景说明']) : '',
            keywords: String(r['参考关键词'] || '')
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          }))
        }
      }
    } catch {
      /* ignore */
    }
  }

  return next
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {string} sheetName
 */
function rowsToWorksheet(rows, sheetName) {
  if (rows.length) return XLSX.utils.json_to_sheet(rows)
  const headers = MANAGED_SHEET_HEADERS[sheetName]
  if (headers) return XLSX.utils.aoa_to_sheet([headers])
  return XLSX.utils.json_to_sheet([{ 提示: '暂无数据' }])
}

/**
 * @param {Record<string, Record<string, unknown>[]>} managedSheets
 * @param {string} excelPath
 */
function buildWorkbook(managedSheets, excelPath) {
  const wb = XLSX.utils.book_new()
  const sheetOrder = []

  if (fs.existsSync(excelPath)) {
    // Node ESM 下 namespace 导入无 readFile，用 buffer + read
    const existing = XLSX.read(fs.readFileSync(excelPath), { type: 'buffer' })
    for (const name of existing.SheetNames) {
      if (OPTIONAL_SHEET_NAMES.has(name) && !managedSheets[name]) {
        const ws = existing.Sheets[name]
        XLSX.utils.book_append_sheet(wb, ws, name)
        sheetOrder.push(name)
      }
    }
  }

  if (!sheetOrder.includes('填写说明')) {
    const guide = [
      {
        工作表: '（说明）',
        适用产品: '—',
        用途与填写要点:
          '本文件由「标签管理 → 发布到服务端配置」从共享库生成。请求场景/问题类型/用户旅程以在线编辑为准；请求节点表若存在则保留原表未覆盖。',
        示例: new Date().toISOString(),
      },
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(guide), '填写说明')
    sheetOrder.unshift('填写说明')
  }

  const order = ['产品识别', '用户旅程', '请求场景', '通用问题类型', '请求节点-服务类型', '请求节点-问题子类']
  for (const name of order) {
    if (sheetOrder.includes(name)) continue
    const rows = managedSheets[name]
    if (rows) {
      XLSX.utils.book_append_sheet(wb, rowsToWorksheet(rows, name), name)
      sheetOrder.push(name)
    }
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/**
 * @param {string} excelPath
 */
function summarizeExcelFile(excelPath) {
  if (!fs.existsSync(excelPath)) return { sheets: {} }
  const wb = XLSX.read(fs.readFileSync(excelPath), { type: 'buffer' })
  /** @type {Record<string, number>} */
  const sheets = {}
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name] || {})
    sheets[name] = rows.filter((r) => !r['提示']).length
  }
  return { sheets }
}

/**
 * @param {import('../src/lib/tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @param {string} dir
 */
function publishJsonFiles(snapshot, dir) {
  const written = []
  const indexPath = path.join(dir, 'index.json')
  let indexBase = {
    version: 3,
    description: '打标配置：各产品用户旅程；请求场景与问题类型全产品共用',
    products: Object.keys(snapshot.products || {}),
    sharedRequestScenes: snapshot.sharedRequestScenes || [],
    sharedProblemTypes: snapshot.sharedProblemTypes || [],
  }
  if (fs.existsSync(indexPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      indexBase = { ...prev, ...indexBase }
    } catch {
      /* use defaults */
    }
  }
  fs.writeFileSync(indexPath, JSON.stringify(indexBase, null, 2), 'utf8')
  written.push(indexPath)

  for (const [pKey, tax] of Object.entries(snapshot.products || {})) {
    const jsonPath = path.join(dir, `${pKey}.json`)
    /** @type {Record<string, unknown>} */
    let prev = {}
    if (fs.existsSync(jsonPath)) {
      try {
        prev = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      } catch {
        prev = {}
      }
    }
    const next = {
      ...prev,
      key: pKey,
      name: tax.name || pKey,
      match: tax.match || [],
      journeys: tax.journeys || [],
    }
    if (!next.problemTypes && Array.isArray(prev.problemTypes)) {
      next.problemTypes = prev.problemTypes
    }
    if (!next.nodeMaps && prev.nodeMaps) {
      next.nodeMaps = prev.nodeMaps
    }
    fs.writeFileSync(jsonPath, JSON.stringify(next, null, 2), 'utf8')
    written.push(jsonPath)
  }

  return written
}

/**
 * @param {{
 *   writeJson?: boolean
 *   publishedBy?: string
 * }} [options]
 */
export function publishTaxonomyToFiles(options = {}) {
  const { writeJson = true, publishedBy = 'system' } = options

  const rawSnapshot = storageRepository.getMeta(META_KEY_TAXONOMY_MANAGED)
  if (!rawSnapshot?.products) {
    throw new Error('共享库中尚无标签配置，请先在标签管理中添加并保存')
  }

  fs.mkdirSync(TAXONOMY_DIR, { recursive: true })
  const excelPath = path.join(TAXONOMY_DIR, TAXONOMY_EXCEL_FILE)

  const snapshot = hydrateSnapshotForPublish(
    /** @type {import('../src/lib/tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} */ (
      rawSnapshot
    ),
    TAXONOMY_DIR,
    excelPath,
  )

  const managedSheets = buildManagedSheetsFromSnapshot(snapshot)
  const buffer = buildWorkbook(managedSheets, excelPath)
  const excelWrite = writeBufferAtomically(excelPath, Buffer.from(buffer))

  const jsonFiles = writeJson ? publishJsonFiles(snapshot, TAXONOMY_DIR) : []
  const excelSummary = summarizeExcelFile(excelPath)

  const meta = {
    lastPublishedAt: new Date().toISOString(),
    lastPublishedBy: publishedBy,
    excelPath,
  }
  storageRepository.putMeta('taxonomy_last_publish', meta)
  bumpDataRevision()

  return {
    ok: true,
    excelPath,
    jsonFiles,
    excelSize: excelWrite.size,
    excelModifiedAt: excelWrite.modifiedAt,
    excelSheets: excelSummary.sheets,
    stats: {
      products: Object.keys(snapshot.products || {}).length,
      requestScenes: (snapshot.sharedRequestScenes || []).length,
      problemTypes: (snapshot.sharedProblemTypes || []).length,
      journeyRows: managedSheets.用户旅程.length,
    },
    publishedAt: meta.lastPublishedAt,
    publishedBy,
  }
}

/**
 * @returns {{ configured: boolean; dir: string; excelPath: string; exists: boolean; lastPublish: unknown }}
 */
export function getTaxonomyPublishStatus() {
  const excelPath = path.join(TAXONOMY_DIR, TAXONOMY_EXCEL_FILE)
  const managed = storageRepository.getMeta(META_KEY_TAXONOMY_MANAGED)
  const lastPublish = storageRepository.getMeta('taxonomy_last_publish')
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
    dir: TAXONOMY_DIR,
    excelPath,
    excelFile: TAXONOMY_EXCEL_FILE,
    exists: fs.existsSync(excelPath),
    lastPublish,
    lastError: storageRepository.getMeta('taxonomy_publish_error'),
    managedUpdatedAt: managedAt || null,
    diskStale,
  }
}
