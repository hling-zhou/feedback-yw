/**
 * 集成冒烟：P0 逻辑链（无浏览器）
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeImportMonth,
  validateImportFile,
  validateRowCount,
  pickImportRowMeta,
} from '../lib/importUtils.js'
import {
  recordMatchesPeriod,
  isImportMonthInPeriod,
  buildPeriodSpec,
  insightPeriodFromSpec,
} from '../domain/insightPeriod.js'
import {
  mergeImportByKey,
  validateTaxonomyImport,
} from '../lib/tagLibrary/taxonomyManageModel.js'
import { mergeCandidateIntoSnapshot } from '../lib/tagLibrary/taxonomyManagedStore.js'
import * as XLSX from 'xlsx'

describe('smoke P0 integration', () => {
  it('IMP-01: invalid import months rejected', () => {
    expect(normalizeImportMonth('2025-5')).toBeNull()
    expect(normalizeImportMonth('')).toBeNull()
    expect(normalizeImportMonth('2025-05')).toBe('2025-05')
  })

  it('IMP-02: pickImportRowMeta preserves importMonth', () => {
    const meta = pickImportRowMeta({ importMonth: '2025-05', ticketId: 'T1' })
    expect(meta.importMonth).toBe('2025-05')
  })

  it('IMP-04/05: file and row limits', () => {
    const bad = validateImportFile({ name: 'a.exe', size: 100 })
    expect(bad.ok).toBe(false)
    const big = validateRowCount(6000)
    expect(big.ok).toBe(false)
  })

  it('PER-01: record filtered by importMonth not createdAt', () => {
    const period = insightPeriodFromSpec(
      buildPeriodSpec({ granularity: 'month', year: 2025, month: 5 }),
      1,
    )
    const inPeriod = {
      importMonth: '2025-05',
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const outPeriod = {
      importMonth: '2024-12',
      createdAt: '2025-05-01T00:00:00.000Z',
    }
    expect(recordMatchesPeriod(inPeriod, period)).toBe(true)
    expect(recordMatchesPeriod(outPeriod, period)).toBe(false)
    expect(isImportMonthInPeriod('2025-05', period)).toBe(true)
  })

  it('TAG-07: import validates empty problem type name', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ 问题类型名称: '', 参考关键词: 'kw' }]),
      '通用问题类型',
    )
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const r = validateTaxonomyImport(buf)
    expect(r.ok).toBe(false)
  })

  it('REV-03: approve merges candidate into managed snapshot', () => {
    const snapshot = {
      tagLibraryVersion: 'v1',
      updatedAt: '',
      sharedProblemTypes: [],
      products: { generic: { key: 'generic', name: '通用', match: [], journeys: [] } },
    }
    mergeCandidateIntoSnapshot(snapshot, {
      id: 'c1',
      tagType: 'problem_type',
      proposedLabel: '新采纳类型',
      status: 'pending',
      occurrenceCount: 1,
    })
    expect(snapshot.sharedProblemTypes.some((t) => t.label === '新采纳类型')).toBe(true)
  })

  it('TAG-06: merge import updates existing key', () => {
    const current = {
      tagLibraryVersion: 'v1',
      updatedAt: '',
      sharedProblemTypes: [{ label: '已有', description: '旧', keywords: [] }],
      products: {},
    }
    const { updated } = mergeImportByKey(current, {
      sharedProblemTypes: [{ label: '已有', description: '新', keywords: ['x'] }],
      products: {},
    })
    expect(updated.problemTypes).toBe(1)
    expect(current.sharedProblemTypes[0].description).toBe('新')
    expect(current.sharedProblemTypes[0].keywords).toEqual(['x'])
  })
})
