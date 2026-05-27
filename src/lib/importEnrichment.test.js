import { describe, expect, it, vi } from 'vitest'
import { enrichTicketRecordsForImport } from './importEnrichment.js'

vi.mock('./dimensionTagging.js', () => ({
  enrichRecordsWithSharedDimensions: vi.fn(async (records) =>
    records.map((r) => ({ ...r, requestScene: '报障与恢复', problemType: '性能与质量' })),
  ),
}))

vi.mock('./journeySemantic.js', () => ({
  enrichRecordsWithJourneys: vi.fn(async (records) =>
    records.map((r) => ({ ...r, journeyL1: '日常运维', journeyL2: '使用运维' })),
  ),
}))

vi.mock('./applyThemes.js', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod }
})

describe('enrichTicketRecordsForImport', () => {
  it('returns tagged records even when downstream steps would warn without API key', async () => {
    const records = [
      {
        id: '1',
        rawText: '无法访问',
        handlingText: '无法访问公网',
        customerQuote: '不通',
        dataSourceType: 'complaint_ticket',
        problemType: '未分类',
        requestScene: '未分类',
        journeyL1: '未识别环节',
        journeyL2: '未识别子环节',
        themes: ['未分类'],
        sentiment: 'neutral',
      },
    ]

    const { records: out, warnings } = await enrichTicketRecordsForImport(records, {}, () => {})

    expect(out[0].requestScene).toBe('报障与恢复')
    expect(out[0].problemType).toBe('性能与质量')
    expect(out[0].journeyL1).toBe('日常运维')
    expect(out[0].themes).toEqual(['使用运维'])
    expect(warnings.some((w) => w.includes('LLM'))).toBe(true)
  })
})
