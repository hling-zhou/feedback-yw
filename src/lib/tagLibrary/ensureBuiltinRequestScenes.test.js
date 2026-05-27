import { describe, expect, it } from 'vitest'
import { REQUEST_SCENES_BUILTIN } from '../sharedTagDefs.js'
import { ensureBuiltinRequestScenesInSnapshot } from './ensureBuiltinRequestScenes.js'

describe('ensureBuiltinRequestScenesInSnapshot', () => {
  it('fills empty sharedRequestScenes with all builtins', () => {
    const snapshot = { sharedRequestScenes: [], products: {} }
    const changed = ensureBuiltinRequestScenesInSnapshot(snapshot)
    expect(changed).toBe(true)
    expect(snapshot.sharedRequestScenes).toHaveLength(REQUEST_SCENES_BUILTIN.length)
    expect(snapshot.sharedRequestScenes.map((t) => t.label)).toEqual(
      REQUEST_SCENES_BUILTIN.map((t) => t.label),
    )
  })

  it('does not overwrite existing labels', () => {
    const snapshot = {
      sharedRequestScenes: [{ label: '报障与恢复', keywords: ['custom'] }],
      products: {},
    }
    const changed = ensureBuiltinRequestScenesInSnapshot(snapshot)
    expect(changed).toBe(true)
    expect(snapshot.sharedRequestScenes.find((t) => t.label === '报障与恢复').keywords).toEqual([
      'custom',
    ])
  })

  it('is idempotent when all builtins present', () => {
    const snapshot = {
      sharedRequestScenes: REQUEST_SCENES_BUILTIN.map((t) => ({ ...t })),
      products: {},
    }
    expect(ensureBuiltinRequestScenesInSnapshot(snapshot)).toBe(false)
  })
})
