/**
 * 服务端同步读取万投比目标 meta（AI 助手工具用）。
 */
import { storageRepository } from './storageRepository.js'

export const META_KEY_WAN_TOU_TARGETS = 'wan_tou_targets_v1'

/**
 * @returns {{ productKey: string; year: number; wanTouTarget: number | null; customerExperienceWanTouTarget: number | null }[]}
 */
export function listWanTouTargetsSync() {
  const raw = storageRepository.getMeta(META_KEY_WAN_TOU_TARGETS)
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => ({
      productKey: String(row?.productKey || '').trim(),
      year: Number(row?.year) || 0,
      wanTouTarget: row?.wanTouTarget == null ? null : Number(row.wanTouTarget),
      customerExperienceWanTouTarget:
        row?.customerExperienceWanTouTarget == null ? null : Number(row.customerExperienceWanTouTarget),
    }))
    .filter((row) => row.productKey && row.year >= 2000 && row.year <= 2100)
}
