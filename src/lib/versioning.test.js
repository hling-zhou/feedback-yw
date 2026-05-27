import { describe, it, expect } from 'vitest'
import {
  stampVersion,
  assertSchemaVersion,
  defaultAnalysisVersions,
} from './versioning.js'
import { SCHEMA_VERSION } from '../domain/constants.js'

describe('versioning', () => {
  it('stampVersion applies defaults', () => {
    const entity = stampVersion({ id: '1' })
    expect(entity.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('assertSchemaVersion throws on mismatch', () => {
    expect(() => assertSchemaVersion({ schemaVersion: '1.0' })).toThrow(/schemaVersion/)
  })

  it('defaultAnalysisVersions includes pipeline and tag library', () => {
    const v = defaultAnalysisVersions()
    expect(v.pipelineVersion).toBeTruthy()
    expect(v.tagLibraryVersion).toBeTruthy()
  })
})
