import { DATA_SOURCE_TYPES } from '../domain/enums.js'

/** 合并多次数据变更后的自动重建防抖（毫秒） */
export const SNAPSHOT_AUTO_REBUILD_DEBOUNCE_MS = 400

/**
 * @param {{ sourceSnapshots?: Partial<Record<string, { summary?: { recordCount?: number } }>> }} loaded
 */
export function snapshotsHavePeriodData(loaded) {
  const sources = loaded.sourceSnapshots || {}
  return DATA_SOURCE_TYPES.some((type) => (sources[type]?.summary?.recordCount ?? 0) > 0)
}
