import { storageRepository } from './storageRepository.js'

/**
 * 服务端快照重建用 StorageAdapter（只实现 snapshotService 所需子集）
 * @returns {import('../src/storage/adapter.js').StorageAdapter}
 */
export function createRepositoryStorageAdapter() {
  const repo = storageRepository
  return {
    async init() {
      await repo.init()
    },

    async listInsightPeriods() {
      return repo.listInsightPeriods()
    },

    async putInsightPeriod(period) {
      repo.putInsightPeriod(period)
    },

    async getInsightPeriod(id) {
      return repo.getInsightPeriod(id)
    },

    async listRecords(query = {}) {
      return repo.listRecords(query)
    },

    async getStorageStats() {
      return repo.getStats()
    },

    async putRecord(record) {
      repo.putRecord(record)
    },

    async putRecords(records) {
      repo.putRecords(records)
    },

    async replaceAllRecords(records) {
      repo.replaceAllRecords(records)
    },

    async getRecord(id) {
      return repo.getRecord(id)
    },

    async deleteRecord(id) {
      repo.deleteRecord(id)
    },

    async putAnalysisRun(run) {
      repo.putAnalysisRun(run)
    },

    async getAnalysisRun(id) {
      return repo.getAnalysisRun(id)
    },

    async findRunByIdempotencyKey(idempotencyKey) {
      return repo.findRunByIdempotencyKey(idempotencyKey)
    },

    async listAnalysisRuns(insightPeriodId, dataSourceType) {
      return repo.listAnalysisRuns(insightPeriodId, dataSourceType)
    },

    async putArtifact(artifact, debug = false) {
      repo.putArtifact(artifact, debug)
    },

    async listArtifactsByRun(runId, debug = false) {
      return repo.listArtifactsByRun(runId, debug)
    },

    async putSnapshot(snapshot) {
      repo.putSnapshot(snapshot)
    },

    async getSnapshot(id) {
      return repo.getSnapshot(id)
    },

    async listSnapshotsByPeriod(insightPeriodId) {
      return repo.listSnapshotsByPeriod(insightPeriodId)
    },

    async getMeta(key) {
      return repo.getMeta(key)
    },

    async putMeta(key, value) {
      repo.putMeta(key, value)
    },

    async listTagCandidates(filters = {}) {
      return repo.listTagCandidates(filters)
    },

    async putTagCandidate(candidate) {
      repo.putTagCandidate(candidate)
    },

    async putTagCandidates(candidates) {
      repo.putTagCandidates(candidates)
    },

    async deleteTagCandidate(id) {
      repo.deleteTagCandidate(id)
    },

    async clearImportedData(options) {
      return repo.clearImportedData(options)
    },
  }
}
