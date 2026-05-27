import { describe, it, expect, beforeEach } from 'vitest'
import { createLocalIdbAdapter } from './localIdbAdapter.js'
import { resetDatabaseForTests } from './idb.js'
import { createTicketRecord } from '../lib/recordFactory.js'
import { SCHEMA_VERSION, LEGACY_INSIGHT_PERIOD_ID } from '../domain/constants.js'
import { buildIdempotencyKey } from '../domain/analysisRun.js'
import { defaultAnalysisVersions, stampVersion } from '../lib/versioning.js'

describe('LocalIdbAdapter', () => {
  beforeEach(async () => {
    await resetDatabaseForTests()
  })

  it('init seeds legacy insight period', async () => {
    const adapter = createLocalIdbAdapter()
    await adapter.init()
    const periods = await adapter.listInsightPeriods()
    expect(periods.some((p) => p.id === LEGACY_INSIGHT_PERIOD_ID)).toBe(true)
    expect(periods[0].schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('putRecord and listRecords by period and source', async () => {
    const adapter = createLocalIdbAdapter()
    await adapter.init()

    const record = createTicketRecord({
      ticketId: 'T-001',
      rawText: 'test',
      customerQuote: 'test',
      importMonth: '2025-05',
      dataSourceType: 'complaint_ticket',
    })
    await adapter.putRecord(record)

    const listed = await adapter.listRecords({
      insightPeriodId: LEGACY_INSIGHT_PERIOD_ID,
      dataSourceType: 'complaint_ticket',
    })
    expect(listed.records).toHaveLength(1)
    expect(listed.records[0].ticketId).toBe('T-001')
    expect(listed.total).toBe(1)
  })

  it('analysis run idempotency lookup', async () => {
    const adapter = createLocalIdbAdapter()
    await adapter.init()

    const key = buildIdempotencyKey({
      insightPeriodId: LEGACY_INSIGHT_PERIOD_ID,
      dataSourceType: 'consultation_ticket',
      importBatchId: 'batch-1',
      fileSha256: 'abc',
    })

    const run = stampVersion(
      {
        id: crypto.randomUUID(),
        tenantId: 'local',
        insightPeriodId: LEGACY_INSIGHT_PERIOD_ID,
        dataSourceType: 'consultation_ticket',
        importBatchId: 'batch-1',
        idempotencyKey: key,
        status: 'succeeded',
        total: 10,
        successCount: 10,
        failureCount: 0,
        startedAt: new Date().toISOString(),
        ...defaultAnalysisVersions(),
      },
      defaultAnalysisVersions(),
    )

    await adapter.putAnalysisRun(/** @type {import('../domain/analysisRun.js').AnalysisRun} */ (run))
    const found = await adapter.findRunByIdempotencyKey(key)
    expect(found?.status).toBe('succeeded')
  })

  it('replaceAllRecords replaces entire store', async () => {
    const adapter = createLocalIdbAdapter()
    await adapter.init()
    const a = createTicketRecord({
      id: 'r1',
      ticketId: 'T-1',
      rawText: 'a',
      customerQuote: 'a',
      importMonth: '2025-05',
    })
    const b = createTicketRecord({
      id: 'r2',
      ticketId: 'T-2',
      rawText: 'b',
      customerQuote: 'b',
      importMonth: '2025-05',
    })
    await adapter.putRecord(a)
    await adapter.replaceAllRecords([b])
    const all = await adapter.listRecords({})
    expect(all.records).toHaveLength(1)
    expect(all.records[0].id).toBe('r2')
  })

  it('stores lean artifact by runId', async () => {
    const adapter = createLocalIdbAdapter()
    await adapter.init()

    const runId = crypto.randomUUID()
    await adapter.putArtifact({
      id: `${runId}:rec-1`,
      runId,
      recordId: 'rec-1',
      artifactType: 'record',
      inputTextHash: 'hash',
      excerpt: '脱敏摘录',
      localTags: { journeyL1: '购买' },
      mergedTags: { journeyL1: '购买' },
      mergeReason: 'local',
    })

    const arts = await adapter.listArtifactsByRun(runId)
    expect(arts).toHaveLength(1)
    expect(arts[0].excerpt).toBe('脱敏摘录')
  })
})
