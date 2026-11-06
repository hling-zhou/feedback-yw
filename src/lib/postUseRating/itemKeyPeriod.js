/**
 * 用后即评清单条目键的「周期包含语义」匹配（2026-11-06 用户拍板）。
 *
 * 背景：itemKey 按勾选时周期口径存储（月键=单月段、季度键=多月并集段，方案 B）。
 * 读取时大周期行需看到被其包含的小周期键状态——7 月视图勾选（q:code:产品:2026-07）
 * 在 Q3 行（q:code:产品:2026-07|2026-08|2026-09）应显示勾选（被包含关系）。
 *
 * 规则：存储键月份集合 ⊆ 行键月份集合 即匹配；
 * 无月份段的旧格式键视为任意周期可见（迁移残留兼容）。
 */

/**
 * 拆 itemKey 为 { prefix, months }：prefix = 月份段之前的部分（q:code:产品）。
 * 无月份段（旧格式）months=[]；非 q: 前缀或格式不符返回 null。
 * @param {string} itemKey
 * @returns {{ prefix: string, months: string[] } | null}
 */
function splitItemKey(itemKey) {
  const key = String(itemKey || '')
  const m = key.match(/^(q:[^:]+:.+):((?:\d{4}-\d{2})(?:\|\d{4}-\d{2})*)$/)
  if (m) return { prefix: m[1], months: m[2].split('|').sort() }
  if (/^q:[^:]+:.+$/.test(key)) return { prefix: key, months: [] }
  return null
}

/**
 * 判定存储键是否被行键（周期口径）包含。
 * 前提：两者非月份前缀（q:code:产品）必须相同——不同客户/产品的键永不互相匹配。
 * @param {string} rowKey 当前行键（大周期口径）
 * @param {string} storedKey 存储键（勾选/归档/标记时的口径）
 * @returns {boolean}
 */
export function itemKeySubsetMatches(rowKey, storedKey) {
  if (rowKey === storedKey) return true
  const row = splitItemKey(rowKey)
  const stored = splitItemKey(storedKey)
  if (!row || !stored) return rowKey === storedKey
  if (row.prefix !== stored.prefix) return false
  // 旧格式键（无月份段）与同前缀任意行键匹配：迁移残留/兼容
  if (!stored.months.length) return true
  if (!row.months.length) return false
  return stored.months.every((month) => row.months.includes(month))
}

/**
 * 从 itemKey 提取月份段（q:code:产品:2026-07|2026-08 → ['2026-07','2026-08']）。
 * 无月份段（旧格式）返回空数组；非 q: 前缀或多段格式不符返回空数组。
 * @param {string} itemKey
 * @returns {string[]}
 */
export function extractItemKeyMonths(itemKey) {
  return splitItemKey(itemKey)?.months || []
}

/**
 * 按「包含语义」在 Map 中查行键的全部命中条目（决策/归档/标记共用）。
 * @template T
 * @param {Map<string, T>} map
 * @param {string} rowKey
 * @returns {T[]}
 */
export function lookupBySubset(map, rowKey) {
  const exact = map.get(rowKey)
  if (exact) return [exact]
  const hits = []
  for (const [storedKey, value] of map) {
    if (itemKeySubsetMatches(rowKey, storedKey)) hits.push(value)
  }
  return hits
}

/**
 * 行键在 Map 中的全部命中键（含精确 + 被包含子集）：
 * 取消勾选/取消标记时对这些键全部写 false，保证取消在大周期视图也生效。
 * @param {Map<string, unknown>} map
 * @param {string} rowKey
 * @returns {string[]}
 */
export function allMatchingKeys(map, rowKey) {
  const keys = []
  for (const storedKey of map.keys()) {
    if (itemKeySubsetMatches(rowKey, storedKey)) keys.push(storedKey)
  }
  if (!keys.includes(rowKey) && map.has(rowKey)) keys.push(rowKey)
  return keys
}
