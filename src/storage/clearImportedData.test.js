import { describe, expect, it } from 'vitest'
import {
  analysisRunMatchesClearFilter,
  describeClearImportedScopeRisk,
  isClearAllImportedData,
  parseClearImportedDataOptions,
  recordMatchesClearFilter,
  snapshotMatchesClearFilter,
  validateClearImportedDataOptions,
  validateScopedClearOptions,
} from './clearImportedData.js'
import { sourceSnapshotId } from '../domain/snapshot.js'

const q2Period = {
  id: 'period:quarter:2026-Q2',
  label: '2026年Q2',
  startDate: '2026-04-01',
  endDate: '2026-06-30',
  granularity: 'quarter',
  anchorYear: 2026,
  anchorQuarter: 2,
  status: 'active',
  tenantId: 'local',
  schemaVersion: '2.0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const period = {
  id: 'period:month:2026-05',
  label: '2026年5月',
  startDate: '2026-05-01',
  endDate: '2026-05-31',
  granularity: 'month',
  anchorYear: 2026,
  anchorMonth: 5,
  status: 'active',
  tenantId: 'local',
  schemaVersion: '2.0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('clearImportedData', () => {
  it('parseClearImportedDataOptions normalizes query', () => {
    expect(
      parseClearImportedDataOptions({
        insightPeriodId: ' period:month:2026-05 ',
        dataSourceType: 'complaint_ticket',
      }),
    ).toEqual({
      insightPeriodId: 'period:month:2026-05',
      dataSourceType: 'complaint_ticket',
    })
  })

  it('parseClearImportedDataOptions treats scope=all as full clear', () => {
    expect(parseClearImportedDataOptions({ scope: 'all' })).toEqual({ all: true })
    expect(isClearAllImportedData({ all: true })).toBe(true)
    expect(isClearAllImportedData({})).toBe(false)
  })

  it('validateClearImportedDataOptions rejects empty options', () => {
    expect(validateClearImportedDataOptions({})).toMatch(/scope=all/)
    expect(validateClearImportedDataOptions({ all: true })).toBeNull()
    expect(validateClearImportedDataOptions({ insightPeriodId: 'p1' })).toBeNull()
    expect(validateClearImportedDataOptions({ dataSourceType: 'complaint_ticket' })).toBeNull()
  })

  it('validateScopedClearOptions requires period, source and product selection', () => {
    expect(validateScopedClearOptions({ insightPeriodId: 'p1' })).toMatch(/同时/)
    expect(validateScopedClearOptions({ dataSourceType: 'complaint_ticket' })).toMatch(/同时/)
    expect(
      validateScopedClearOptions({
        insightPeriodId: q2Period.id,
        dataSourceType: 'complaint_ticket',
      }),
    ).toMatch(/全部产品/)
    expect(
      validateScopedClearOptions({
        insightPeriodId: q2Period.id,
        dataSourceType: 'complaint_ticket',
        product: '云主机 ECS',
      }),
    ).toBeNull()
    expect(
      validateScopedClearOptions({
        insightPeriodId: q2Period.id,
        dataSourceType: 'complaint_ticket',
        allProducts: true,
      }),
    ).toBeNull()
  })

  it('recordMatchesClearFilter for Q2 complaint intersection', () => {
    const inScope = {
      id: '1',
      importMonth: '2026-05',
      dataSourceType: 'complaint_ticket',
      customerQuote: 'x',
      requestScene: '',
      problemType: '',
      journeyL1: '',
      journeyL2: '',
      problemSummary: '',
      solutionSummary: '',
      rootCause: '',
      optimizationSuggestion: '',
      sentiment: 'neutral',
      themes: [],
      status: 'open',
      importedAt: '2026-05-01T00:00:00.000Z',
    }
    const consult = { ...inScope, id: '2', dataSourceType: 'consultation_ticket' }
    const oldComplaint = { ...inScope, id: '3', importMonth: '2022-08' }
    const opts = { insightPeriodId: q2Period.id, dataSourceType: 'complaint_ticket' }
    expect(recordMatchesClearFilter(inScope, opts, q2Period)).toBe(true)
    expect(recordMatchesClearFilter(consult, opts, q2Period)).toBe(false)
    expect(recordMatchesClearFilter(oldComplaint, opts, q2Period)).toBe(false)
  })

  it('recordMatchesClearFilter respects product name', () => {
    const base = {
      id: '1',
      importMonth: '2026-05',
      dataSourceType: 'complaint_ticket',
      customerQuote: 'x',
      requestScene: '',
      problemType: '',
      journeyL1: '',
      journeyL2: '',
      problemSummary: '',
      solutionSummary: '',
      rootCause: '',
      optimizationSuggestion: '',
      sentiment: 'neutral',
      themes: [],
      status: 'open',
      importedAt: '2026-05-01T00:00:00.000Z',
    }
    const ecs = { ...base, id: '4', product: '云主机 ECS' }
    const vpc = { ...ecs, id: '5', product: 'VPC' }
    const opts = {
      insightPeriodId: q2Period.id,
      dataSourceType: 'complaint_ticket',
      product: '云主机 ECS',
    }
    expect(recordMatchesClearFilter(ecs, opts, q2Period)).toBe(true)
    expect(recordMatchesClearFilter(vpc, opts, q2Period)).toBe(false)
  })

  it('snapshotMatchesClearFilter skips snapshot when product scoped', () => {
    const id = sourceSnapshotId('complaint_ticket', period.id)
    expect(
      snapshotMatchesClearFilter(id, {
        insightPeriodId: period.id,
        dataSourceType: 'complaint_ticket',
        product: '云主机 ECS',
      }),
    ).toBe(false)
  })

  it('recordMatchesClearFilter by period and source', () => {
    const record = {
      id: '1',
      importMonth: '2026-05',
      dataSourceType: 'complaint_ticket',
      customerQuote: 'x',
      requestScene: '',
      problemType: '',
      journeyL1: '',
      journeyL2: '',
      problemSummary: '',
      solutionSummary: '',
      rootCause: '',
      optimizationSuggestion: '',
      sentiment: 'neutral',
      themes: [],
      status: 'open',
      importedAt: '2026-05-01T00:00:00.000Z',
    }
    expect(
      recordMatchesClearFilter(
        record,
        { insightPeriodId: period.id, dataSourceType: 'complaint_ticket' },
        period,
      ),
    ).toBe(true)
    expect(
      recordMatchesClearFilter(record, { dataSourceType: 'consultation_ticket' }, period),
    ).toBe(false)
    expect(recordMatchesClearFilter(record, { insightPeriodId: period.id }, period)).toBe(
      true,
    )
  })

  it('snapshotMatchesClearFilter respects period and source', () => {
    const id = sourceSnapshotId('complaint_ticket', period.id)
    expect(
      snapshotMatchesClearFilter(id, {
        insightPeriodId: period.id,
        dataSourceType: 'complaint_ticket',
      }),
    ).toBe(true)
    expect(
      snapshotMatchesClearFilter(id, {
        insightPeriodId: period.id,
        dataSourceType: 'consultation_ticket',
      }),
    ).toBe(false)
    expect(snapshotMatchesClearFilter(id, { dataSourceType: 'complaint_ticket' })).toBe(true)
  })

  it('describeClearImportedScopeRisk warns on broad filters', () => {
    expect(describeClearImportedScopeRisk({ all: true })).toContain('全部')
    expect(describeClearImportedScopeRisk({ dataSourceType: 'complaint_ticket' })).toContain(
      '所有月份',
    )
    expect(
      describeClearImportedScopeRisk({
        insightPeriodId: period.id,
        dataSourceType: 'complaint_ticket',
        product: '云主机 ECS',
      }),
    ).toContain('交集')
    expect(
      describeClearImportedScopeRisk({
        insightPeriodId: period.id,
        dataSourceType: 'complaint_ticket',
        allProducts: true,
      }),
    ).toContain('全部产品')
  })

  it('recordMatchesClearFilter resolves period from id when period object omitted', () => {
    const inScope = {
      id: '1',
      importMonth: '2026-05',
      dataSourceType: 'complaint_ticket',
      customerQuote: 'x',
      requestScene: '',
      problemType: '',
      journeyL1: '',
      journeyL2: '',
      problemSummary: '',
      solutionSummary: '',
      rootCause: '',
      optimizationSuggestion: '',
      sentiment: 'neutral',
      themes: [],
      status: 'open',
      importedAt: '2026-05-01T00:00:00.000Z',
    }
    const outScope = { ...inScope, id: '2', importMonth: '2026-04' }
    const opts = { insightPeriodId: period.id, dataSourceType: 'complaint_ticket' }
    expect(recordMatchesClearFilter(inScope, opts)).toBe(true)
    expect(recordMatchesClearFilter(outScope, opts)).toBe(false)
  })

  it('analysisRunMatchesClearFilter', () => {
    const run = {
      id: 'run-1',
      insightPeriodId: period.id,
      dataSourceType: 'complaint_ticket',
      status: 'succeeded',
      schemaVersion: '2.0',
      pipelineVersion: '1',
      tagLibraryVersion: '1',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      tenantId: 'local',
      successCount: 1,
      failureCount: 0,
    }
    expect(analysisRunMatchesClearFilter(run, { insightPeriodId: period.id })).toBe(true)
    expect(
      analysisRunMatchesClearFilter(run, {
        insightPeriodId: period.id,
        dataSourceType: 'consultation_ticket',
      }),
    ).toBe(false)
  })
})
