import {
  SCHEMA_VERSION,
  PIPELINE_VERSION_TICKET,
  TAG_LIBRARY_VERSION_DEFAULT,
} from '../domain/constants.js'

/**
 * @typedef {import('../domain/records.js').VersionedMeta} VersionedMeta
 */

/**
 * @param {Record<string, unknown>} entity
 * @param {Partial<VersionedMeta>} [versions]
 * @returns {Record<string, unknown>}
 */
export function stampVersion(entity, versions = {}) {
  return {
    ...entity,
    schemaVersion: versions.schemaVersion ?? SCHEMA_VERSION,
    ...(versions.pipelineVersion != null ? { pipelineVersion: versions.pipelineVersion } : {}),
    ...(versions.tagLibraryVersion != null
      ? { tagLibraryVersion: versions.tagLibraryVersion }
      : {}),
  }
}

/**
 * @param {{ schemaVersion?: string }} entity
 * @param {string} [expected]
 */
export function assertSchemaVersion(entity, expected = SCHEMA_VERSION) {
  if (entity.schemaVersion && entity.schemaVersion !== expected) {
    throw new Error(
      `schemaVersion 不匹配：期望 ${expected}，实际 ${entity.schemaVersion}。请迁移或重建快照。`,
    )
  }
}

/** @returns {import('../domain/records.js').VersionedMeta} */
export function defaultAnalysisVersions() {
  return {
    schemaVersion: SCHEMA_VERSION,
    pipelineVersion: PIPELINE_VERSION_TICKET,
    tagLibraryVersion: TAG_LIBRARY_VERSION_DEFAULT,
  }
}
