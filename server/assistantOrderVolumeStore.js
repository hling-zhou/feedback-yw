/**
 * 服务端同步读取订单量 meta（AI 助手工具用，避免走异步 adapter）。
 */
import { storageRepository } from './storageRepository.js'

export const META_KEY_ORDER_VOLUMES = 'product_order_volumes_v1'

/**
 * @returns {{ productKey: string; month: string; orderCount: number }[]}
 */
export function listOrderVolumesSync() {
  const raw = storageRepository.getMeta(META_KEY_ORDER_VOLUMES)
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => ({
      productKey: String(row?.productKey || '').trim(),
      month: String(row?.month || '').trim().slice(0, 7),
      orderCount: Number(row?.orderCount) || 0,
    }))
    .filter((row) => row.productKey && row.month && row.orderCount > 0)
}
