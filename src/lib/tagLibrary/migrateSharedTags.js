import {
  REQUEST_SCENES_BUILTIN,
  PROBLEM_TYPES_BUILTIN,
  REQUEST_SCENE_LABEL_MIGRATION,
  PROBLEM_TYPE_LABEL_MIGRATION,
} from '../sharedTagDefs.js'

/**
 * @param {SharedTagRule[]} builtins
 * @param {SharedTagRule[]} existing
 * @param {Record<string, string>} labelMap
 */
function mergeSharedTagList(builtins, existing, labelMap) {
  const builtinLabels = new Set(builtins.map((b) => b.label))
  /** @type {SharedTagRule[]} */
  const extras = []

  for (const item of existing || []) {
    const label = (item.label || '').trim()
    if (!label) continue
    const newLabel = labelMap[label] || label
    if (builtinLabels.has(newLabel)) continue
    if (extras.some((e) => e.label === newLabel)) continue
    extras.push({
      label: newLabel,
      description: item.description,
      keywords: [...(item.keywords || [])],
    })
  }

  return [...builtins.map((b) => structuredClone(b)), ...extras]
}

/**
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateSharedTagsInSnapshot(snapshot) {
  let changed = false
  const nextScenes = mergeSharedTagList(
    REQUEST_SCENES_BUILTIN,
    snapshot.sharedRequestScenes,
    REQUEST_SCENE_LABEL_MIGRATION,
  )
  const nextTypes = mergeSharedTagList(
    PROBLEM_TYPES_BUILTIN,
    snapshot.sharedProblemTypes,
    PROBLEM_TYPE_LABEL_MIGRATION,
  )

  if (JSON.stringify(snapshot.sharedRequestScenes) !== JSON.stringify(nextScenes)) {
    snapshot.sharedRequestScenes = nextScenes
    changed = true
  }
  if (JSON.stringify(snapshot.sharedProblemTypes) !== JSON.stringify(nextTypes)) {
    snapshot.sharedProblemTypes = nextTypes
    changed = true
  }
  return changed
}

/**
 * @param {import('../../storage/types.js').FeedbackRecord} record
 * @returns {boolean}
 */
export function migrateSharedTagsOnRecord(record) {
  if (!record) return false
  let changed = false

  const rs = record.requestScene?.trim()
  if (rs && REQUEST_SCENE_LABEL_MIGRATION[rs]) {
    record.requestScene = REQUEST_SCENE_LABEL_MIGRATION[rs]
    changed = true
  }

  const pt = record.problemType?.trim()
  if (pt && PROBLEM_TYPE_LABEL_MIGRATION[pt]) {
    record.problemType = PROBLEM_TYPE_LABEL_MIGRATION[pt]
    changed = true
  }

  return changed
}
