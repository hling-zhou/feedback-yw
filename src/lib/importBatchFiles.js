/** 单次导入最多文件数 */
export const MAX_IMPORT_FILES = 5

/** 单文件最大行数（与 validateRowCount 一致） */
export const MAX_ROWS_PER_FILE = 5000

/** 多文件合并后总行数上限 */
export const MAX_ROWS_BATCH_TOTAL = MAX_ROWS_PER_FILE * MAX_IMPORT_FILES

/**
 * @param {string[]} a
 * @param {string[]} b
 */
export function headersMatch(a, b) {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((h, i) => h === sb[i])
}

/**
 * @param {string[]} hashes
 */
export function combineImportFileSha256(hashes) {
  return [...hashes].filter(Boolean).sort().join('|') || 'no-file'
}

/**
 * @typedef {Object} ParsedUploadFile
 * @property {string} id
 * @property {File} file
 * @property {string} sha256
 * @property {string[]} sheetNames
 * @property {string} selectedSheet
 * @property {string[]} headers
 * @property {Record<string, string>[]} rows
 */

/**
 * @param {ParsedUploadFile[]} files
 * @returns {{
 *   headers: string[]
 *   rows: Record<string, string>[]
 *   rowSources: { fileName: string; sheetName: string }[]
 *   totalRows: number
 *   fileNames: string[]
 * }}
 */
export function mergeParsedUploadFiles(files) {
  if (!files.length) {
    return { headers: [], rows: [], rowSources: [], totalRows: 0, fileNames: [] }
  }

  const headers = files[0].headers
  const mismatched = files.filter((f) => !headersMatch(headers, f.headers))
  if (mismatched.length) {
    const names = mismatched.map((f) => f.file.name).join('、')
    throw new Error(
      `以下文件的表头与「${files[0].file.name}」不一致，请统一列结构或移除：${names}`,
    )
  }

  /** @type {Record<string, string>[]} */
  const rows = []
  /** @type {{ fileName: string; sheetName: string }[]} */
  const rowSources = []

  for (const entry of files) {
    for (const row of entry.rows) {
      rows.push(row)
      rowSources.push({
        fileName: entry.file.name,
        sheetName: entry.selectedSheet,
      })
    }
  }

  if (rows.length > MAX_ROWS_BATCH_TOTAL) {
    throw new Error(
      `合并后共 ${rows.length} 行，超过单次导入上限 ${MAX_ROWS_BATCH_TOTAL} 行（最多 ${MAX_IMPORT_FILES} 个文件）`,
    )
  }

  return {
    headers,
    rows,
    rowSources,
    totalRows: rows.length,
    fileNames: files.map((f) => f.file.name),
  }
}
