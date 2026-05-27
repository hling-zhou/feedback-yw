import { AnalysisPipeline } from '../core/AnalysisPipeline.js'
import { ArtifactCollector } from '../core/ArtifactCollector.js'
import { createTicketRecord } from '../../lib/recordFactory.js'
import { SCHEMA_VERSION } from '../../domain/constants.js'
import { pickImportRowMeta } from '../../lib/importUtils.js'
import { extractQuoteFromFields } from '../../lib/quoteExtraction.js'

/**
 * @typedef {import('../core/AnalysisContext.js').AnalysisContext} AnalysisContext
 */

/** @type {'stub'} */
export const STUB_PIPELINE_STATUS = 'stub'

/**
 * 占位流水线：仅导入与最小记录；工作台专项图表与指标 Pipeline 尚未实现。
 */
export class StubAnalysisPipeline extends AnalysisPipeline {
  static implementationStatus = STUB_PIPELINE_STATUS
  /**
   * @param {Object[]} rows
   * @param {AnalysisContext} ctx
   */
  async analyze(rows, ctx) {
    const collector = new ArtifactCollector(crypto.randomUUID())
    collector.setRunParams({
      stub: true,
      pipelineStatus: STUB_PIPELINE_STATUS,
      dataSourceType: ctx.dataSourceType,
    })

    const records = rows.map((row, i) => {
      const id = crypto.randomUUID()
      const body =
        row.commentText ||
        row.openText ||
        row.body ||
        row.rawText ||
        row.handlingText ||
        JSON.stringify(row).slice(0, 500)

      const rowMeta = pickImportRowMeta(row)
      const rawText = String(body || '')
      const { customerQuote, quoteExtractionVersion } = extractQuoteFromFields(
        {
          rawText,
          commentText: row.commentText,
          openText: row.openText,
        },
        {
          dataSourceType: ctx.dataSourceType,
          settings: ctx.settings ?? null,
          useRegex: ctx.settings?.useRegex ?? true,
        },
      )
      const base = {
        id,
        schemaVersion: SCHEMA_VERSION,
        tenantId: ctx.tenantId,
        dataSourceType: ctx.dataSourceType,
        recordStatus: /** @type {const} */ ('raw'),
        importedAt: rowMeta.importedAt || new Date().toISOString(),
        importBatchId: ctx.importBatchId || rowMeta.importBatchId,
        importBatchName: ctx.importBatchName || rowMeta.importBatchName,
        importFileName: rowMeta.importFileName,
        importSheetName: rowMeta.importSheetName,
        rawText,
        customerQuote,
        quoteExtractionVersion,
        importMonth: rowMeta.importMonth,
        createdAt: row.createdAt,
        product: row.product,
      }

      if (ctx.dataSourceType === 'post_use_rating') {
        return {
          ...base,
          ratingScore: row.ratingScore != null ? Number(row.ratingScore) : undefined,
          ratingDimension: row.ratingDimension,
          commentText: row.commentText || body,
        }
      }
      if (ctx.dataSourceType === 'user_survey') {
        return {
          ...base,
          surveyId: row.surveyId,
          questionId: row.questionId,
          responseValue: row.responseValue,
          openText: row.openText || body,
        }
      }
      if (ctx.dataSourceType === 'complaint_ticket' || ctx.dataSourceType === 'consultation_ticket') {
        return createTicketRecord({ ...base, ...row, dataSourceType: ctx.dataSourceType })
      }

      return { ...base, title: row.title, body }
    })

    for (let i = 0; i < records.length; i++) {
      await collector.addRecordResult({
        recordId: records[i].id,
        sourceText: records[i].rawText || records[i].commentText || '',
        localTags: { stub: true },
        mergedTags: { stub: true },
        mergeReason: 'stub_pipeline',
      })
    }

    return { records, failures: [], collector }
  }
}
