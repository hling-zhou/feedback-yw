/**
 * 省代表回访「优化建议（自动生成）」re-read merge 写回（2026-11-19，
 * DESIGN-用后即评抽屉优化建议 §5）。
 *
 * 写回防覆盖拍板：批量/单条生成完只 merge optimizationProduct/Service/Source 三字段
 * 进最新库值，禁止整条覆盖（防冲掉在线编辑的内部评估/经办人/备注）；
 * 记录已删（meta 中无此 id）则跳过返回 null。
 *
 * 与 routes/postUseVisit.js 的 mutateVisitRecord 不同点：这里不校验 updatedAt
 * （优化建议与人工编辑字段域不相交，并发写互不覆盖对方关心的字段）；
 * 已有建议不覆盖（幂等——needsPostUseOptimization 在生成侧已判，此处兜底再防一次）。
 */
import { META_KEY_POST_USE_VISITS } from '../src/lib/postUseRating/visitRecords.js'
import { storageRepository } from './storageRepository.js'
import { bumpDataRevision } from './dataRevision.js'

/**
 * @param {string} id
 * @param {{ optimizationProduct: string, optimizationService: string, optimizationSource: 'rule' | 'llm' }} patch
 * @returns {Promise<Record<string, any> | null>} 写回后的记录；id 不存在返回 null；已有建议返回原记录（幂等跳过）
 */
export async function mergeVisitOptimizationPatch(id, patch) {
  const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  const recordList = Array.isArray(raw?.records) ? raw.records : []
  const idx = recordList.findIndex((item) => String(item?.id || '') === String(id))
  if (idx < 0) return null
  const existing = recordList[idx]
  if (String(existing?.optimizationProduct || '').trim()) return existing

  const next = [...recordList]
  next[idx] = {
    ...existing,
    optimizationProduct: String(patch.optimizationProduct || ''),
    optimizationService: String(patch.optimizationService || ''),
    optimizationSource: String(patch.optimizationSource || ''),
    updatedAt: new Date().toISOString(),
  }
  storageRepository.putMeta(META_KEY_POST_USE_VISITS, {
    ...raw,
    updatedAt: new Date().toISOString(),
    records: next,
  })
  // putMeta 不自动 bump：手动触发，否则前端增量同步感知不到回访变化
  bumpDataRevision()
  return next[idx]
}
