export const META_KEY_WAN_TOU_TARGETS = 'wan_tou_targets_v1'

/**
 * @typedef {Object} WanTouTargetRow
 * @property {string} productKey
 * @property {number} year
 * @property {number | null} [wanTouTarget] 万投比目标值（每产品每年）
 * @property {number | null} [customerExperienceWanTouTarget] 客户体验类万投比目标值
 * @property {string} [updatedAt]
 */

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @returns {Promise<WanTouTargetRow[]>}
 */
export async function listWanTouTargets(adapter) {
  await adapter.init?.()
  const raw = await adapter.getMeta(META_KEY_WAN_TOU_TARGETS)
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => ({
      productKey: String(row.productKey || ''),
      year: Number(row.year) || 0,
      wanTouTarget: normalizeOptionalTarget(row.wanTouTarget),
      customerExperienceWanTouTarget: normalizeOptionalTarget(row.customerExperienceWanTouTarget),
      updatedAt: row.updatedAt,
    }))
    .filter((row) => row.productKey && row.year >= 2000 && row.year <= 2100)
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeOptionalTarget(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {WanTouTargetRow} row
 */
export async function upsertWanTouTarget(adapter, row) {
  const productKey = String(row.productKey || '').trim()
  const year = Number(row.year)
  if (!productKey || !Number.isFinite(year)) {
    throw new Error('产品 Key 与年份不能为空')
  }

  const list = await listWanTouTargets(adapter)
  const idx = list.findIndex((x) => x.productKey === productKey && x.year === year)
  const next = {
    productKey,
    year,
    wanTouTarget: normalizeOptionalTarget(row.wanTouTarget),
    customerExperienceWanTouTarget: normalizeOptionalTarget(row.customerExperienceWanTouTarget),
    updatedAt: new Date().toISOString(),
  }
  if (idx >= 0) list[idx] = next
  else list.push(next)
  await adapter.putMeta(META_KEY_WAN_TOU_TARGETS, list)
  return next
}

/**
 * @param {WanTouTargetRow[]} targets
 * @param {string} productKey
 * @param {number} year
 */
export function getWanTouTargetForYear(targets, productKey, year) {
  return (targets || []).find((row) => row.productKey === productKey && row.year === year) || null
}
