import { REQUEST_SCENES_BUILTIN } from '../sharedTagDefs.js'

/**
 * 将内置请求场景合并进托管快照（按 label 去重，不覆盖已有项）。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean} 是否向 snapshot 写入了新条目
 */
export function ensureBuiltinRequestScenesInSnapshot(snapshot) {
  if (!snapshot.sharedRequestScenes) snapshot.sharedRequestScenes = []
  const labels = new Set(snapshot.sharedRequestScenes.map((t) => t.label))
  let changed = false
  for (const builtin of REQUEST_SCENES_BUILTIN) {
    if (labels.has(builtin.label)) continue
    snapshot.sharedRequestScenes.push(JSON.parse(JSON.stringify(builtin)))
    labels.add(builtin.label)
    changed = true
  }
  return changed
}
