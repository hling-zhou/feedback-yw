const IMPORT_FILE_EXT_RE = /\.(xlsx|xls|csv)$/i

/**
 * 从导入文件名解析 Excel 密码：`名称#密码.xlsx`（取扩展名前最后一个 #）。
 *
 * @param {string | undefined | null} fileName
 * @returns {{ password: string; displayName: string }}
 */
export function parseImportFileNamePassword(fileName) {
  const originalName = String(fileName ?? '')
  const match = originalName.match(IMPORT_FILE_EXT_RE)
  if (!match) {
    return { password: '', displayName: originalName }
  }
  const ext = match[0]
  const stem = originalName.slice(0, -ext.length)
  const hash = stem.lastIndexOf('#')
  if (hash <= 0) {
    return { password: '', displayName: originalName }
  }
  const password = stem.slice(hash + 1)
  const base = stem.slice(0, hash)
  if (!password || !base) {
    return { password: '', displayName: originalName }
  }
  return { password, displayName: `${base}${ext}` }
}

/**
 * 落库 / 界面展示用文件名（剥掉 `#密码` 段）。
 *
 * @param {string | undefined | null} fileName
 */
export function displayImportFileName(fileName) {
  return parseImportFileNamePassword(fileName).displayName
}
