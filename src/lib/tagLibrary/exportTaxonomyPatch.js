/**
 * 将本地 taxonomy_overrides 转为可合并到服务端配置的 Excel 行与 JSON Patch。
 */
import * as XLSX from 'xlsx'
import { buildOverridePatchFromCandidate } from '../taxonomyLoader.js'

export const TAXONOMY_CONFIG_DIR = 'public/config/taxonomy/'
export const TAXONOMY_EXCEL_FILE = '打标配置.xlsx'

/**
 * @param {string} text
 */
function simpleHash(text) {
  let h = 0
  for (const c of String(text)) h = ((h << 5) - h + c.charCodeAt(0)) | 0
  return Math.abs(h).toString(36).slice(0, 8)
}

/**
 * 为采纳标签生成稳定、可写入 Excel 的环节 ID（英文+数字，避免中文 ID）。
 * @param {string} label
 * @param {string} [prefix]
 */
export function toAdoptId(label, prefix = 'adopt') {
  const ascii = String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20)
  const suffix = simpleHash(label)
  const core = ascii || 'adopt'
  return `${prefix}-${core}-${suffix}`.slice(0, 48)
}

/**
 * @param {import('./overrides.js').TaxonomyOverrides} overrides
 */
export function overridesToExcelRows(overrides) {
  /** @type {Record<string, unknown>[]} */
  const journeyRows = []
  /** @type {Record<string, unknown>[]} */
  const problemTypeRows = []

  for (const patch of overrides?.journeyPatches || []) {
    const l1Id = toAdoptId(patch.journeyL1, 'l1')
    const l2Id = toAdoptId(`${patch.taxonomyKey}-${patch.journeyL1}-${patch.journeyL2}`, 'l2')
    journeyRows.push({
      产品Key: patch.taxonomyKey || 'generic',
      一级ID: l1Id,
      一级名称: patch.journeyL1,
      一级说明: '',
      二级ID: l2Id,
      二级名称: patch.journeyL2,
      二级说明: patch.description || '',
      参考关键词: (patch.keywords || []).join(','),
      _来源: 'tag-review-adopt',
    })
  }

  for (const pt of overrides?.problemTypes || []) {
    problemTypeRows.push({
      问题类型名称: pt.label,
      问题类型说明: '',
      参考关键词: (pt.keywords || []).join(','),
      _来源: 'tag-review-adopt',
    })
  }

  return { journeyRows, problemTypeRows }
}

/**
 * @param {import('./overrides.js').TaxonomyOverrides} overrides
 */
export function overridesToJsonPatch(overrides) {
  /** @type {Record<string, { journeysAppend: object[] }>} */
  const products = {}

  for (const patch of overrides?.journeyPatches || []) {
    const key = patch.taxonomyKey || 'generic'
    if (!products[key]) products[key] = { journeysAppend: [] }
    const l1Id = toAdoptId(patch.journeyL1, 'l1')
    const l2Id = toAdoptId(`${key}-${patch.journeyL1}-${patch.journeyL2}`, 'l2')
    products[key].journeysAppend.push({
      l1: {
        id: l1Id,
        label: patch.journeyL1,
        description: '',
      },
      l2: {
        id: l2Id,
        label: patch.journeyL2,
        description: patch.description || '',
        keywords: patch.keywords || [],
      },
    })
  }

  return {
    tagLibraryVersion: overrides?.tagLibraryVersion,
    updatedAt: overrides?.updatedAt,
    sharedProblemTypesAppend: (overrides?.problemTypes || []).map((pt) => ({
      label: pt.label,
      keywords: pt.keywords || [],
    })),
    products,
  }
}

/**
 * @param {import('./overrides.js').TaxonomyOverrides | null} overrides
 * @param {{ approvedCount?: number }} [opts]
 */
export function buildTaxonomyPatchPackage(overrides, opts = {}) {
  const base = overrides || {
    tagLibraryVersion: 'none',
    problemTypes: [],
    journeyPatches: [],
    updatedAt: new Date().toISOString(),
  }
  const excel = overridesToExcelRows(base)
  const json = overridesToJsonPatch(base)

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      tagLibraryVersion: base.tagLibraryVersion,
      approvedPendingMerge: opts.approvedCount ?? 0,
      generator: 'feedback-insights',
    },
    mergeGuide: {
      excel: `将 excel.journeyRows 追加到 ${TAXONOMY_CONFIG_DIR}${TAXONOMY_EXCEL_FILE} 的「用户旅程」表；将 excel.problemTypeRows 追加到「通用问题类型」表（去重后保存）。`,
      json: `将 json.products.<产品Key>.journeysAppend 中各 l2 合并进 ${TAXONOMY_CONFIG_DIR}<产品Key>.json 的 journeys 树；sharedProblemTypesAppend 合并进 generic.json 或 Excel 通用表。`,
      reload: '合并保存后，在应用「设置」点击「重新加载配置」，并重新生成洞察快照 / 必要时重新打标。',
    },
    excel,
    json,
  }
}

/**
 * @param {import('../domain/tagCandidate.js').TagCandidate} candidate
 */
export function buildSingleCandidatePatchPackage(candidate) {
  const patch = buildOverridePatchFromCandidate(candidate)
  const overrides = {
    tagLibraryVersion: `taxonomy-candidate-${candidate.id}`,
    problemTypes: patch.problemTypes || [],
    journeyPatches: patch.journeyPatches || [],
    updatedAt: new Date().toISOString(),
  }
  return buildTaxonomyPatchPackage(overrides, { approvedCount: 1 })
}

/**
 * @param {object} pkg
 * @param {string} [filename]
 */
export function downloadTaxonomyPatchJson(pkg, filename) {
  const name =
    filename ||
    `taxonomy-patch-${pkg.meta?.tagLibraryVersion || 'export'}.json`.replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json;charset=utf-8' })
  triggerDownload(blob, name.endsWith('.json') ? name : `${name}.json`)
}

/**
 * @param {import('./overrides.js').TaxonomyOverrides | null} overrides
 * @param {string} [filename]
 */
export function downloadTaxonomyPatchExcel(overrides, filename) {
  const { journeyRows, problemTypeRows } = overridesToExcelRows(
    overrides || { journeyPatches: [], problemTypes: [] },
  )
  const wb = XLSX.utils.book_new()
  if (journeyRows.length) {
    const ws = XLSX.utils.json_to_sheet(journeyRows)
    XLSX.utils.book_append_sheet(wb, ws, '用户旅程')
  }
  if (problemTypeRows.length) {
    const ws = XLSX.utils.json_to_sheet(problemTypeRows)
    XLSX.utils.book_append_sheet(wb, ws, '通用问题类型')
  }
  if (!journeyRows.length && !problemTypeRows.length) {
    const ws = XLSX.utils.aoa_to_sheet([
      ['提示', '暂无已采纳的本地覆盖项可导出'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, '说明')
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const name =
    filename ||
    `taxonomy-merge-rows-${overrides?.tagLibraryVersion || 'export'}.xlsx`.replace(
      /[^\w\u4e00-\u9fa5.-]+/g,
      '_',
    )
  triggerDownload(blob, name.endsWith('.xlsx') ? name : `${name}.xlsx`)
}

/**
 * @param {object} pkg
 */
export async function copyTaxonomyPatchJson(pkg) {
  const text = JSON.stringify(pkg, null, 2)
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
