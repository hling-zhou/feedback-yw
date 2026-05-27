import { AnalysisPipeline } from '../core/AnalysisPipeline.js'
import { ArtifactCollector } from '../core/ArtifactCollector.js'
import { pickImportRowMeta } from '../../lib/importUtils.js'
import { processRow } from '../../lib/pipeline.js'
import { createTicketRecord } from '../../lib/recordFactory.js'
import { recordMatchesPeriod } from '../../domain/insightPeriod.js'

/**
 * @typedef {import('../core/AnalysisContext.js').AnalysisContext} AnalysisContext
 */

/** 投诉 / 咨询工单分析（包裹 v1 pipeline） */
export class TicketAnalysisPipeline extends AnalysisPipeline {
  /**
   * @param {Object[]} rows
   * @param {AnalysisContext} ctx
   */
  validate(rows, ctx) {
    const errors = []
    if (!rows?.length) errors.push('没有可分析的数据行')
    if (!ctx.settings) errors.push('缺少分析设置')
    return { ok: errors.length === 0, errors }
  }

  /**
   * @param {Object[]} rows
   * @param {AnalysisContext} ctx
   * @param {{ insightPeriod?: import('../../domain/insightPeriod.js').InsightPeriod }} [opts]
   */
  async analyze(rows, ctx, opts = {}) {
    const collector = new ArtifactCollector(crypto.randomUUID(), false)
    collector.setRunParams({
      dataSourceType: ctx.dataSourceType,
      useRegex: ctx.settings?.useRegex,
      themeMatchMode: ctx.settings?.themeMatchMode,
    })

    /** @type {import('../../domain/records.js').TicketRecord[]} */
    const records = []
    /** @type {import('../../domain/analysisRun.js').AnalysisRunFailure[]} */
    const failures = []
    const useRegex = ctx.settings?.useRegex ?? true
    const period = opts.insightPeriod

    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i]
        const legacy = processRow(row, useRegex, ctx.settings)
        if (!legacy) {
          failures.push({
            rowIndex: i,
            code: 'OUT_OF_SCOPE',
            message: '产品不在目录范围内或行无效',
          })
          continue
        }

        const rowMeta = pickImportRowMeta(row)
        const record = createTicketRecord(
          {
            ...legacy,
            ...rowMeta,
            dataSourceType: ctx.dataSourceType,
            insightPeriodId: ctx.insightPeriodId,
            importBatchId: ctx.importBatchId || rowMeta.importBatchId,
            importBatchName: ctx.importBatchName || rowMeta.importBatchName,
          },
          { recordStatus: 'analyzed', insightPeriodId: ctx.insightPeriodId },
        )

        if (period && !recordMatchesPeriod(record, period)) {
          record.outOfPeriodWarning = true
        }

        await collector.addRecordResult({
          recordId: record.id,
          sourceText: record.handlingText || record.rawText,
          ...AnalysisPipeline.artifactTagsFromTicket(record),
        })

        records.push(record)
      } catch (err) {
        failures.push({
          rowIndex: i,
          code: 'PROCESS_ERROR',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { records, failures, collector }
  }
}
