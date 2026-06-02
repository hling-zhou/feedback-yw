import { SCHEMA_VERSION } from '../../domain/constants.js'
import { buildIdempotencyKey } from '../../domain/analysisRun.js'
import { defaultAnalysisVersions, stampVersion } from '../../lib/versioning.js'
import { ArtifactCollector } from './ArtifactCollector.js'
import { randomId } from '../../lib/randomId.js'

/**
 * @typedef {import('./AnalysisContext.js').AnalysisContext} AnalysisContext
 * @typedef {import('../registry.js').PipelineDescriptor} PipelineDescriptor
 * @typedef {import('../../domain/records.js').InsightRecord} InsightRecord
 * @typedef {import('../../domain/analysisRun.js').AnalysisRun} AnalysisRun
 */

/**
 * @typedef {Object} PipelineValidateResult
 * @property {boolean} ok
 * @property {string[]} [errors]
 */

/**
 * @typedef {Object} PipelineAnalyzeResult
 * @property {InsightRecord[]} records
 * @property {import('../../domain/analysisRun.js').AnalysisRunFailure[]} failures
 * @property {ArtifactCollector} collector
 */

/** 分析流水线基类（WP2） */
export class AnalysisPipeline {
  /**
   * @param {PipelineDescriptor} descriptor
   */
  constructor(descriptor) {
    this.descriptor = descriptor
  }

  get dataSourceType() {
    return this.descriptor.dataSourceType
  }

  /**
   * @param {unknown[]} rows
   * @param {AnalysisContext} _ctx
   * @returns {PipelineValidateResult}
   */
  validate(_rows, _ctx) {
    return { ok: true }
  }

  /**
   * @param {unknown[]} rows
   * @param {AnalysisContext} ctx
   * @returns {Promise<PipelineAnalyzeResult>}
   */
  async analyze(_rows, ctx) {
    throw new Error(`${this.descriptor.id}: analyze() 未实现`)
  }

  /**
   * @param {AnalysisContext} ctx
   * @param {number} total
   * @param {number} successCount
   * @param {import('../../domain/analysisRun.js').AnalysisRunFailure[]} failures
   * @param {'succeeded' | 'partial_failed' | 'failed'} status
   */
  buildRun(ctx, total, successCount, failures, status) {
    const versions = defaultAnalysisVersions()
    const now = new Date().toISOString()
    /** @type {AnalysisRun} */
    const run = stampVersion(
      {
        id: randomId(),
        tenantId: ctx.tenantId,
        insightPeriodId: ctx.insightPeriodId,
        dataSourceType: ctx.dataSourceType,
        importBatchId: ctx.importBatchId,
        idempotencyKey: buildIdempotencyKey({
          insightPeriodId: ctx.insightPeriodId,
          dataSourceType: ctx.dataSourceType,
          importBatchId: ctx.importBatchId,
          fileSha256: ctx.fileSha256,
        }),
        status,
        total,
        successCount,
        failureCount: failures.length,
        successRecordIds: [],
        failures,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        pipelineVersion: ctx.pipelineVersion || versions.pipelineVersion,
        tagLibraryVersion: ctx.tagLibraryVersion || versions.tagLibraryVersion,
      },
      versions,
    )
    return /** @type {AnalysisRun} */ (run)
  }

  /**
   * @param {AnalysisRun} run
   * @param {string[]} successRecordIds
   */
  finalizeRun(run, successRecordIds) {
    run.successRecordIds = successRecordIds
    if (run.finishedAt && run.startedAt) {
      run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    }
    return run
  }

  /** @param {InsightRecord} record */
  static artifactTagsFromTicket(record) {
    return {
      localTags: {
        problemType: record.problemType,
        journeyL1: record.journeyL1,
        journeyL2: record.journeyL2,
      },
      mergedTags: {
        problemType: record.problemType,
        journeyL1: record.journeyL1,
        journeyL2: record.journeyL2,
        themes: record.themes,
      },
      mergeReason: 'ticket_pipeline',
    }
  }
}

export { SCHEMA_VERSION }
