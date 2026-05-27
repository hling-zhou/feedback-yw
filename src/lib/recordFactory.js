import { DEFAULT_TENANT_ID, SCHEMA_VERSION } from '../domain/constants.js'

/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */
/** @typedef {import('../domain/enums.js').RecordStatus} RecordStatus */
/** @typedef {import('../domain/records.js').TicketRecord} TicketRecord */
/** @typedef {import('../domain/records.js').InsightRecord} InsightRecord */

/**
 * 从 v1 FeedbackRecord 或导入行构建 v2 工单记录壳
 * @param {Partial<TicketRecord> & { dataSourceType?: DataSourceType }} input
 * @param {Object} [opts]
 * @param {string} [opts.insightPeriodId]
 * @param {RecordStatus} [opts.recordStatus]
 */
export function createTicketRecord(input, opts = {}) {
  const now = new Date().toISOString()
  /** @type {DataSourceType} */
  const dataSourceType = input.dataSourceType || 'complaint_ticket'

  return {
    schemaVersion: SCHEMA_VERSION,
    tenantId: input.tenantId || DEFAULT_TENANT_ID,
    insightPeriodId: input.insightPeriodId ?? opts.insightPeriodId,
    dataSourceType,
    recordStatus: opts.recordStatus || input.recordStatus || 'analyzed',
    id: input.id || crypto.randomUUID(),
    importedAt: input.importedAt || now,
    importMonth: input.importMonth,
    importBatchId: input.importBatchId,
    importBatchName: input.importBatchName,
    importFileName: input.importFileName,
    importSheetName: input.importSheetName,
    createdAt: input.createdAt,
    product: input.product,
    productKey: input.productKey,
    outOfPeriodWarning: input.outOfPeriodWarning,
    source: input.source,
    rawText: input.rawText || '',
    customerQuote: input.customerQuote || '',
    quoteExtractionVersion: input.quoteExtractionVersion,
    responseText: input.responseText,
    handlingText: input.handlingText,
    productSpec: input.productSpec,
    version: input.version,
    ticketId: input.ticketId,
    resourcePool: input.resourcePool,
    requestScene: input.requestScene || '未分类',
    problemType: input.problemType || '未分类',
    journeyL1: input.journeyL1 || '未识别环节',
    journeyL2: input.journeyL2 || '未识别子环节',
    problemSummary: input.problemSummary || '',
    solutionSummary: input.solutionSummary || '',
    rootCause: input.rootCause || '',
    optimizationSuggestion: input.optimizationSuggestion || '',
    manualReviewRootCause: input.manualReviewRootCause || '',
    manualReviewSolution: input.manualReviewSolution || '',
    manualReviewAction: input.manualReviewAction || '',
    sourceColumns: input.sourceColumns,
    sentiment: input.sentiment || 'neutral',
    themes: input.themes || ['未分类'],
    status: input.status || 'open',
    note: input.note,
  }
}

/**
 * @param {import('./types.js').FeedbackRecord} legacy
 * @param {DataSourceType} [dataSourceType]
 * @returns {TicketRecord}
 */
export function ticketRecordFromLegacy(legacy, dataSourceType = 'complaint_ticket') {
  return createTicketRecord({ ...legacy, dataSourceType }, { recordStatus: 'analyzed' })
}
