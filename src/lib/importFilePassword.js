const IMPORT_FILE_EXT_RE = /\.(xlsx|xls|csv)$/i

/**
 * 扩展名前最后一个 `#` 或全角 `＃`（中文输入法常见）。
 * @param {string} stem
 */
function lastPasswordSeparatorIndex(stem) {
  let last = -1
  for (let i = 0; i < stem.length; i++) {
    if (stem[i] === '#' || stem[i] === '＃') last = i
  }
  return last
}

/**
 * 从导入文件名解析 Excel 密码：`名称#密码.xlsx`（取扩展名前最后一个 # / ＃）。
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
  const hash = lastPasswordSeparatorIndex(stem)
  if (hash <= 0) {
    return { password: '', displayName: originalName }
  }
  const password = stem.slice(hash + 1).trim()
  const base = stem.slice(0, hash).trim()
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
