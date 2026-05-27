import { describe, it, expect } from 'vitest'
import {
  migrateSharedTagsInSnapshot,
  migrateSharedTagsOnRecord,
} from './migrateSharedTags.js'
import { REQUEST_SCENES_BUILTIN, PROBLEM_TYPES_BUILTIN } from '../sharedTagDefs.js'

describe('migrateSharedTags', () => {
  it('replaces legacy request scenes with v2 builtins', () => {
    const snapshot = {
      sharedRequestScenes: [{ label: '报障排障', keywords: ['old'] }],
      sharedProblemTypes: [],
      products: {},
    }
    expect(migrateSharedTagsInSnapshot(snapshot)).toBe(true)
    expect(snapshot.sharedRequestScenes.map((t) => t.label)).toEqual(
      REQUEST_SCENES_BUILTIN.map((t) => t.label),
    )
    expect(
      snapshot.sharedRequestScenes.find((t) => t.label === '报障与恢复')?.keywords,
    ).toContain('报障')
  })

  it('replaces legacy problem types with v2 builtins', () => {
    const snapshot = {
      sharedRequestScenes: [],
      sharedProblemTypes: [
        { label: '可用性/连通性', keywords: [] },
        { label: '性能类', keywords: [] },
      ],
      products: {},
    }
    migrateSharedTagsInSnapshot(snapshot)
    expect(snapshot.sharedProblemTypes.map((t) => t.label)).toEqual(
      PROBLEM_TYPES_BUILTIN.map((t) => t.label),
    )
  })

  it('migrates record requestScene and problemType labels', () => {
    const record = {
      requestScene: '报障排障',
      problemType: '性能与稳定性',
    }
    expect(migrateSharedTagsOnRecord(record)).toBe(true)
    expect(record.requestScene).toBe('报障与恢复')
    expect(record.problemType).toBe('性能与质量')
  })
})
