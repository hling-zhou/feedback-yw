const RECORD_AUDIT_IGNORE_KEYS = new Set(['recordRevision', 'updatedAt', 'updatedBy'])

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function jsonEqual(a, b) {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  } catch {
    return false
  }
}

/**
 * 工单保存审计：相对旧记录变化的顶层字段名（不含 revision 元数据）。
 * @param {Record<string, unknown> | null | undefined} previous
 * @param {Record<string, unknown> | null | undefined} next
 * @returns {string[]}
 */
export function listChangedRecordFields(previous, next) {
  const prev = previous && typeof previous === 'object' ? previous : {}
  const nxt = next && typeof next === 'object' ? next : {}
  const keys = new Set([...Object.keys(prev), ...Object.keys(nxt)])
  const changed = []
  for (const key of keys) {
    if (RECORD_AUDIT_IGNORE_KEYS.has(key)) continue
    if (!jsonEqual(prev[key], nxt[key])) changed.push(key)
  }
  return changed.sort()
}

/**
 * @param {unknown} previous
 * @param {unknown} next
 * @returns {string[]}
 */
export function listChangedObjectKeys(previous, next) {
  const prev = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}
  const nxt = next && typeof next === 'object' && !Array.isArray(next) ? next : {}
  const keys = new Set([...Object.keys(prev), ...Object.keys(nxt)])
  const changed = []
  for (const key of keys) {
    if (key === 'updatedAt') continue
    if (!jsonEqual(prev[key], nxt[key])) changed.push(key)
  }
  return changed.sort()
}
