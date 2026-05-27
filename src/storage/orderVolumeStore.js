export const META_KEY_ORDER_VOLUMES = 'product_order_volumes_v1'

/**
 * @typedef {Object} OrderVolumeRow
 * @property {string} productKey
 * @property {string} month YYYY-MM
 * @property {number} orderCount
 * @property {string} [updatedAt]
 */

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function listOrderVolumes(adapter) {
  await adapter.init?.()
  const raw = await adapter.getMeta(META_KEY_ORDER_VOLUMES)
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => ({
      productKey: String(row.productKey || ''),
      month: String(row.month || '').slice(0, 7),
      orderCount: Number(row.orderCount) || 0,
      updatedAt: row.updatedAt,
    }))
    .filter((r) => r.productKey && /^\d{4}-\d{2}$/.test(r.month))
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {OrderVolumeRow} row
 */
export async function upsertOrderVolume(adapter, row) {
  const productKey = String(row.productKey || '').trim()
  const month = String(row.month || '').trim()
  const orderCount = Math.max(0, Number(row.orderCount) || 0)
  if (!productKey || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('产品 Key 与月份（YYYY-MM）不能为空')
  }

  const list = await listOrderVolumes(adapter)
  const idx = list.findIndex((x) => x.productKey === productKey && x.month === month)
  const next = {
    productKey,
    month,
    orderCount,
    updatedAt: new Date().toISOString(),
  }
  if (idx >= 0) list[idx] = next
  else list.push(next)
  await adapter.putMeta(META_KEY_ORDER_VOLUMES, list)
  return next
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {string} productKey
 * @param {string} month
 */
export async function deleteOrderVolume(adapter, productKey, month) {
  const list = (await listOrderVolumes(adapter)).filter(
    (x) => !(x.productKey === productKey && x.month === month),
  )
  await adapter.putMeta(META_KEY_ORDER_VOLUMES, list)
}
