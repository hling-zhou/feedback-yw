/**
 * 对象与标签：扁平行模型、校验、按 Key 合并导入、导出
 */
import * as XLSX from 'xlsx'
import { parseTaxonomyWorkbook } from '../taxonomyExcel.js'
import { getAllProducts } from '../taxonomyLoader.js'

export const META_KEY_TAXONOMY_MANAGED = 'taxonomy_managed'

/**
 * @typedef {'request_scene' | 'problem_type' | 'journey'} TagManageRowType
 */

/**
 * @typedef {Object} ProblemTypeRow
 * @property {string} id
 * @property {'problem_type'} rowType
 * @property {string} label
 * @property {string} keywordsText
 */

/**
 * @typedef {Object} JourneyTagRow
 * @property {string} id
 * @property {'journey'} rowType
 * @property {string} productKey
 * @property {string} productName
 * @property {string} l1Id
 * @property {string} l1Name
 * @property {string} l1Desc
 * @property {string} l2Id
 * @property {string} l2Name
 * @property {string} l2Desc
 * @property {string} keywordsText
 */

/**
 * @typedef {Object} TaxonomyManagedSnapshot
 * @property {string} tagLibraryVersion
 * @property {string} updatedAt
 * @property {{ label: string; description?: string; keywords: string[] }[]} sharedRequestScenes
 * @property {{ label: string; description?: string; keywords: string[] }[]} sharedProblemTypes
 * @property {Record<string, { key: string; name: string; match?: string[]; journeys: import('../productTaxonomy.js').JourneyL1[] }>} products
 */

/**
 * @param {string} label
 */
export function problemTypeRowId(label) {
  return `pt::${label}`
}

/**
 * @param {string} productKey
 * @param {string} l1
 * @param {string} l2
 */
export function journeyRowId(productKey, l1, l2) {
  return `j::${productKey}::${l1}::${l2}`
}

/**
 * @param {string[]} keywords
 */
export function keywordsToText(keywords) {
  return (keywords || []).join('，')
}

/**
 * @param {string} text
 */
export function textToKeywords(text) {
  return String(text || '')
    .split(/[,，;；\n]/)
    .map((k) => k.trim())
    .filter(Boolean)
}

/**
 * @param {TaxonomyManagedSnapshot} snapshot
 */
export function requestSceneRowId(label) {
  return `rs::${label}`
}

export function flattenSnapshotToRows(snapshot) {
  /** @type {(ProblemTypeRow | JourneyTagRow)[]} */
  const rows = []

  for (const rs of snapshot.sharedRequestScenes || []) {
    rows.push({
      id: requestSceneRowId(rs.label),
      rowType: 'request_scene',
      label: rs.label,
      keywordsText: keywordsToText(rs.keywords),
    })
  }

  for (const pt of snapshot.sharedProblemTypes || []) {
    rows.push({
      id: problemTypeRowId(pt.label),
      rowType: 'problem_type',
      label: pt.label,
      keywordsText: keywordsToText(pt.keywords),
    })
  }

  for (const [key, tax] of Object.entries(snapshot.products || {})) {
    for (const l1 of tax.journeys || []) {
      for (const l2 of l1.children || []) {
        rows.push({
          id: journeyRowId(key, l1.label, l2.label),
          rowType: 'journey',
          productKey: key,
          productName: tax.name || key,
          l1Id: l1.id || l1.label,
          l1Name: l1.label,
          l1Desc: l1.description || '',
          l2Id: l2.id || l2.label,
          l2Name: l2.label,
          l2Desc: l2.description || '',
          keywordsText: keywordsToText(l2.keywords),
        })
      }
    }
  }

  return rows
}

/**
 * @param {{ problemTypes: ProblemTypeRow[]; journeys: JourneyTagRow[] }} groups
 * @param {string} [version]
 */
export function rowsToSnapshot(groups, version = 'taxonomy-managed-1') {
  /** @type {TaxonomyManagedSnapshot} */
  const snapshot = {
    tagLibraryVersion: version,
    updatedAt: new Date().toISOString(),
    sharedRequestScenes: (groups.requestScenes || []).map((r) => ({
      label: r.label.trim(),
      keywords: textToKeywords(r.keywordsText),
    })),
    sharedProblemTypes: groups.problemTypes.map((r) => ({
      label: r.label.trim(),
      keywords: textToKeywords(r.keywordsText),
    })),
    products: {},
  }

  const products = getAllProducts()
  for (const key of Object.keys(products)) {
    snapshot.products[key] = {
      key,
      name: products[key].name || key,
      match: products[key].match || [],
      journeys: [],
    }
  }

  /** @type {Map<string, Map<string, import('../productTaxonomy.js').JourneyL1>>} */
  const l1Maps = new Map()

  for (const row of groups.journeys) {
    const pKey = row.productKey || 'generic'
    if (!snapshot.products[pKey]) {
      snapshot.products[pKey] = {
        key: pKey,
        name: row.productName || pKey,
        match: [],
        journeys: [],
      }
    }
    if (!l1Maps.has(pKey)) l1Maps.set(pKey, new Map())
    const l1Map = l1Maps.get(pKey)
    const l1Key = row.l1Name || row.l1Id
    if (!l1Map.has(l1Key)) {
      l1Map.set(l1Key, {
        id: row.l1Id || l1Key,
        label: row.l1Name || row.l1Id,
        description: row.l1Desc || '',
        children: [],
      })
    }
    const l1 = l1Map.get(l1Key)
    l1.children.push({
      id: row.l2Id || row.l2Name,
      label: row.l2Name || row.l2Id,
      description: row.l2Desc || '',
      keywords: textToKeywords(row.keywordsText),
    })
  }

  for (const [pKey, l1Map] of l1Maps) {
    snapshot.products[pKey].journeys = [...l1Map.values()]
  }

  return snapshot
}

const IMPORT_SHEET_ALIASES = {
  journeys: ['用户旅程', '旅程', 'journeys'],
  problemTypes: ['通用问题类型', '问题类型', 'problemTypes'],
}

const IMPORT_COL = {
  productKey: ['产品Key', '产品key', 'key', '产品KEY'],
  l1Name: ['一级名称', '一级环节', 'l1Label'],
  l1Id: ['一级ID', '一级id', '一级环节ID', 'l1Id'],
  l2Name: ['二级名称', '二级环节', 'l2Label'],
  l2Id: ['二级ID', '二级id', '二级环节ID', 'l2Id'],
  problemTypeName: ['问题类型名称', '类型名称', '问题类型', 'label'],
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} keys
 */
function pickImportCol(row, keys) {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/**
 * @param {import('xlsx').WorkBook} wb
 * @param {keyof IMPORT_SHEET_ALIASES} kind
 */
function getImportSheetRows(wb, kind) {
  const names = IMPORT_SHEET_ALIASES[kind]
  const sheetName = wb.SheetNames.find((n) =>
    names.some((alias) => n === alias || n.includes(alias)),
  )
  if (!sheetName) return []
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
}

/**
 * @param {ArrayBuffer} buffer
 */
export function validateTaxonomyImport(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  /** @type {string[]} */
  const errors = []

  const problemRows = getImportSheetRows(wb, 'problemTypes')
  problemRows.forEach((row, idx) => {
    const label = pickImportCol(row, IMPORT_COL.problemTypeName)
    const hasOther = Object.values(row).some((v) => String(v ?? '').trim() !== '')
    if (hasOther && !label) {
      errors.push(`通用问题类型 第 ${idx + 1} 行：问题类型名称不能为空`)
    }
  })

  const journeyRows = getImportSheetRows(wb, 'journeys')
  journeyRows.forEach((row, idx) => {
    const pKey = pickImportCol(row, IMPORT_COL.productKey)
    const l1 = pickImportCol(row, IMPORT_COL.l1Name) || pickImportCol(row, IMPORT_COL.l1Id)
    const l2 = pickImportCol(row, IMPORT_COL.l2Name) || pickImportCol(row, IMPORT_COL.l2Id)
    const hasOther = Object.values(row).some((v) => String(v ?? '').trim() !== '')
    if (!hasOther) return
    const prefix = `用户旅程 第 ${idx + 1} 行`
    if (!pKey) errors.push(`${prefix}：产品Key不能为空`)
    if (!l1) errors.push(`${prefix}：一级名称/ID不能为空`)
    if (!l2) errors.push(`${prefix}：二级名称/ID不能为空`)
  })

  const parsed = parseTaxonomyWorkbook(buffer)

  if (!problemRows.length && !journeyRows.length) {
    errors.push('Excel 中未识别到「通用问题类型」或「用户旅程」工作表')
  }

  return { ok: errors.length === 0, errors, parsed }
}

/** Excel 按 Key 合并导入的 hover / 说明文案 */
export const MERGE_IMPORT_BY_KEY_HELP = `按 Key 匹配合并到共享库：
· 请求场景 / 问题类型：以「名称」为 Key；新 Key 会新增，已存在 Key 会覆盖说明与关键词（名称即 Key，不会改名）
· 用户旅程：以「产品 Key + 一级 ID + 二级 ID」为 Key；新 Key 会新增，已存在 Key 会覆盖环节名称、说明与关键词
· 共享库中有而 Excel 中无的行不会删除`

/**
 * @param {{ added: { requestScenes: number; problemTypes: number; journeys: number }; updated: { requestScenes: number; problemTypes: number; journeys: number } }} result
 */
export function formatMergeImportResultMessage(result) {
  const { added, updated } = result
  return `合并导入完成：新增 请求场景 ${added.requestScenes}、问题类型 ${added.problemTypes}、旅程 ${added.journeys}；更新 请求场景 ${updated.requestScenes}、问题类型 ${updated.problemTypes}、旅程 ${updated.journeys}`
}

/**
 * 按 Key 合并：新 Key 新增；已存在 Key 覆盖外显名称、说明、关键词
 * @param {TaxonomyManagedSnapshot} current
 * @param {ReturnType<typeof parseTaxonomyWorkbook>} parsed
 */
export function mergeImportByKey(current, parsed) {
  const added = { requestScenes: 0, problemTypes: 0, journeys: 0 }
  const updated = { requestScenes: 0, problemTypes: 0, journeys: 0 }

  if (!current.sharedRequestScenes) current.sharedRequestScenes = []
  const rsMap = new Map((current.sharedRequestScenes || []).map((t) => [t.label, t]))
  for (const rs of parsed.sharedRequestScenes || []) {
    const label = rs.label?.trim()
    if (!label) continue
    const existing = rsMap.get(label)
    if (existing) {
      existing.description = rs.description
      existing.keywords = rs.keywords || []
      updated.requestScenes += 1
    } else {
      const row = {
        label,
        description: rs.description,
        keywords: rs.keywords || [],
      }
      current.sharedRequestScenes.push(row)
      rsMap.set(label, row)
      added.requestScenes += 1
    }
  }

  if (!current.sharedProblemTypes) current.sharedProblemTypes = []
  const ptMap = new Map((current.sharedProblemTypes || []).map((t) => [t.label, t]))
  for (const pt of parsed.sharedProblemTypes || []) {
    const label = pt.label?.trim()
    if (!label) continue
    const existing = ptMap.get(label)
    if (existing) {
      existing.description = pt.description
      existing.keywords = pt.keywords || []
      updated.problemTypes += 1
    } else {
      const row = {
        label,
        description: pt.description,
        keywords: pt.keywords || [],
      }
      current.sharedProblemTypes.push(row)
      ptMap.set(label, row)
      added.problemTypes += 1
    }
  }

  for (const [pKey, product] of Object.entries(parsed.products || {})) {
    if (!current.products[pKey]) {
      current.products[pKey] = {
        key: pKey,
        name: product.name || pKey,
        match: product.match || [],
        journeys: [],
      }
    }
    const tax = current.products[pKey]
    for (const l1 of product.journeys || []) {
      const l1Id = l1.id || l1.label
      if (!l1Id) continue

      let l1Node = tax.journeys.find((j) => (j.id || j.label) === l1Id)
      if (!l1Node) {
        l1Node = {
          id: l1Id,
          label: l1.label || l1Id,
          description: l1.description || '',
          children: [],
        }
        tax.journeys.push(l1Node)
      } else {
        l1Node.id = l1Node.id || l1Id
        l1Node.label = l1.label || l1Node.label
        l1Node.description = l1.description ?? l1Node.description ?? ''
      }

      for (const l2 of l1.children || []) {
        const l2Id = l2.id || l2.label
        if (!l2Id) continue

        const children = l1Node.children || (l1Node.children = [])
        let l2Node = children.find((c) => (c.id || c.label) === l2Id)
        if (!l2Node) {
          children.push({
            id: l2Id,
            label: l2.label || l2Id,
            description: l2.description || '',
            keywords: l2.keywords || [],
          })
          added.journeys += 1
        } else {
          l2Node.label = l2.label || l2Node.label
          l2Node.description = l2.description ?? l2Node.description ?? ''
          l2Node.keywords = l2.keywords || []
          updated.journeys += 1
        }
      }
    }
  }

  current.updatedAt = new Date().toISOString()
  return { snapshot: current, added, updated }
}

/** @deprecated 使用 mergeImportByKey */
export const mergeImportIncremental = mergeImportByKey

/**
 * @param {TaxonomyManagedSnapshot} snapshot
 * @param {string} [filename]
 */
export function downloadManagedTaxonomyExcel(snapshot, filename) {
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

  /** @type {Record<string, unknown>[]} */
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

  const wb = XLSX.utils.book_new()
  const wsJ = XLSX.utils.json_to_sheet(
    journeyRows.length ? journeyRows : [{ 提示: '暂无用户旅程标签' }],
  )
  XLSX.utils.book_append_sheet(wb, wsJ, '用户旅程')
  const wsR = XLSX.utils.json_to_sheet(
    requestSceneRows.length ? requestSceneRows : [{ 提示: '暂无请求场景' }],
  )
  XLSX.utils.book_append_sheet(wb, wsR, '请求场景')
  const wsP = XLSX.utils.json_to_sheet(
    problemTypeRows.length ? problemTypeRows : [{ 提示: '暂无问题类型' }],
  )
  XLSX.utils.book_append_sheet(wb, wsP, '通用问题类型')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const name =
    filename ||
    `打标配置-${snapshot.tagLibraryVersion || 'export'}.xlsx`.replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.endsWith('.xlsx') ? name : `${name}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
