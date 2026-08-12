/**
 * v2 存储适配器契约（NFR-E-030）
 * MVP: LocalIdbAdapter；二期: ApiStorageAdapter
 */

/** @typedef {import('../domain/records.js').InsightRecord} InsightRecord */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('../domain/analysisRun.js').AnalysisRun} AnalysisRun */
/** @typedef {import('../domain/analysisRun.js').RecordArtifact} RecordArtifact */
/** @typedef {import('../domain/analysisRun.js').RunArtifact} RunArtifact */
/** @typedef {import('../domain/snapshot.js').InsightSnapshot} InsightSnapshot */
/** @typedef {import('../domain/snapshot.js').OverviewSnapshot} OverviewSnapshot */
/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/**
 * @typedef {Object} RecordQuery
 * @property {string} [tenantId]
 * @property {string} [insightPeriodId]
 * @property {DataSourceType} [dataSourceType]
 * @property {string} [importBatchId]
 * @property {number} [limit] 分页大小；不传则返回全部（慎用）
 * @property {number} [offset] 分页偏移，默认 0
 * @property {'list' | 'full'} [fields] payload 投影：list 剔除大文本字段，full/默认原样
 */

/**
 * @typedef {Object} RecordListResult
 * @property {InsightRecord[]} records
 * @property {number} total
 * @property {number} limit
 * @property {number} offset
 */

/**
 * @typedef {Object} StorageAdapter
 * @property {() => Promise<void>} init
 * @property {() => Promise<InsightPeriod[]>} listInsightPeriods
 * @property {(period: InsightPeriod) => Promise<void>} putInsightPeriod
 * @property {(id: string) => Promise<InsightPeriod | null>} getInsightPeriod
 * @property {(query?: RecordQuery) => Promise<RecordListResult>} listRecords
 * @property {(dataSourceType?: string) => Promise<string[]>} [listExistingTicketIds] 该数据类型下全部已有工单号
 * @property {(dataSourceType: string, ticketIds: string[]) => Promise<InsightRecord[]>} [listRecordsByTicketIds] 按工单号批量取记录（导入覆盖合并）
 * @property {() => Promise<{ months: Array<{ importMonth: string; count: number }>; bySource: Array<{ dataSourceType: string; importMonth: string; count: number }>; total: number }>} [listImportMonthSummary] 首屏默认周期推断：按导入月份×数据源聚合记录数
 * @property {() => Promise<{ records: number; snapshots: number; tagCandidates: number }>} [getStorageStats]
 * @property {(record: InsightRecord, options?: import('../domain/recordRevision.js').PutRecordOptions) => Promise<{ recordRevision?: number } | void>} putRecord
 * @property {(records: InsightRecord[]) => Promise<void>} putRecords
 * @property {(records: InsightRecord[]) => Promise<void>} replaceAllRecords
 * @property {(id: string) => Promise<InsightRecord | null>} getRecord
 * @property {(id: string) => Promise<void>} deleteRecord
 * @property {(run: AnalysisRun) => Promise<void>} putAnalysisRun
 * @property {(id: string) => Promise<AnalysisRun | null>} getAnalysisRun
 * @property {(idempotencyKey: string) => Promise<AnalysisRun | null>} findRunByIdempotencyKey
 * @property {(insightPeriodId: string, dataSourceType?: DataSourceType) => Promise<AnalysisRun[]>} listAnalysisRuns
 * @property {(artifact: RecordArtifact | RunArtifact, debug?: boolean) => Promise<void>} putArtifact
 * @property {(runId: string, debug?: boolean) => Promise<(RecordArtifact | RunArtifact)[]>} listArtifactsByRun
 * @property {(snapshot: InsightSnapshot | OverviewSnapshot) => Promise<void>} putSnapshot
 * @property {(id: string) => Promise<InsightSnapshot | OverviewSnapshot | null>} getSnapshot
 * @property {(insightPeriodId: string) => Promise<(InsightSnapshot | OverviewSnapshot)[]>} listSnapshotsByPeriod
 * @property {(key: string) => Promise<unknown>} getMeta
 * @property {(key: string, value: unknown) => Promise<void>} putMeta
 * @property {(filters?: { status?: string; tagType?: string }) => Promise<import('../domain/tagCandidate.js').TagCandidate[]>} listTagCandidates
 * @property {(candidate: import('../domain/tagCandidate.js').TagCandidate) => Promise<void>} putTagCandidate
 * @property {(candidates: import('../domain/tagCandidate.js').TagCandidate[]) => Promise<void>} putTagCandidates
 * @property {(id: string) => Promise<void>} deleteTagCandidate
 * @property {(options?: import('./clearImportedData.js').ClearImportedDataOptions) => Promise<import('./clearImportedData.js').ClearImportedDataResult>} [clearImportedData]
 * @property {() => Promise<{ revision: number; updatedAt: string | null }>} [getDataRevision]
 */

export {}
