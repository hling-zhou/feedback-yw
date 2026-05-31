import { describe, expect, it, vi, beforeEach } from 'vitest'
import { enrichTicketRecordsForImport } from './importEnrichment.js'

const enrichRecordsWithSharedDimensions = vi.fn(async (records) =>
  records.map((r) => ({ ...r, requestScene: '报障与排错', problemType: '性能问题' })),
)
const retagRecordsSharedDimensionsAfterTicketLlm = vi.fn(async (records) => records)
vi.mock('./dimensionTagging.js', () => ({
  enrichRecordsWithSharedDimensions: (...args) => enrichRecordsWithSharedDimensions(...args),
  retagRecordsSharedDimensionsAfterTicketLlm: (...args) =>
    retagRecordsSharedDimensionsAfterTicketLlm(...args),
}))

const enrichRecordsWithJourneys = vi.fn(async (records) =>
  records.map((r) => ({ ...r, journeyL1: '日常运维', journeyL2: '使用运维' })),
)
vi.mock('./journeySemantic.js', () => ({
  enrichRecordsWithJourneys: (...args) => enrichRecordsWithJourneys(...args),
}))

const enrichRecordsWithTicketLlm = vi.fn(async (records) =>
  records.map((r) => ({ ...r, painPoint: r.painPoint || 'LLM痛点' })),
)
vi.mock('./ticketAnalysis/ticketLlmEnrichment.js', () => ({
  enrichRecordsWithTicketLlm: (...args) => enrichRecordsWithTicketLlm(...args),
}))

vi.mock('./applyThemes.js', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod }
})

describe('enrichTicketRecordsForImport', () => {
  beforeEach(() => {
    enrichRecordsWithSharedDimensions.mockClear()
    enrichRecordsWithJourneys.mockClear()
    enrichRecordsWithTicketLlm.mockClear()
    retagRecordsSharedDimensionsAfterTicketLlm.mockClear()
  })

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

    expect(out[0].requestScene).toBe('报障与排错')
    expect(out[0].problemType).toBe('性能问题')
    expect(out[0].journeyL1).toBe('日常运维')
    expect(out[0].painPoint).toBe('LLM痛点')
    expect(out[0].themes).toEqual(['使用运维'])
    expect(warnings.some((w) => w.includes('LLM'))).toBe(true)
  })

  it('ticket_first runs ticket LLM before journey on import', async () => {
    /** @type {string[]} */
    const order = []
    enrichRecordsWithTicketLlm.mockImplementation(async (records) => {
      order.push('ticket')
      return records.map((r) => ({ ...r, painPoint: 'LLM痛点' }))
    })
    enrichRecordsWithJourneys.mockImplementation(async (records) => {
      order.push('journey')
      return records.map((r) => ({ ...r, journeyL1: '日常运维', journeyL2: '使用运维' }))
    })

    const records = [
      {
        id: '1',
        rawText: '无法访问',
        dataSourceType: 'complaint_ticket',
        themes: ['未分类'],
        sentiment: 'neutral',
      },
    ]

    await enrichTicketRecordsForImport(
      records,
      { llmApiKey: 'sk-test', taggingPipelineOrder: 'ticket_first' },
      () => {},
    )

    expect(order).toEqual(['ticket', 'journey'])
    expect(retagRecordsSharedDimensionsAfterTicketLlm).toHaveBeenCalledTimes(1)
  })

  it('legacy runs journey before ticket LLM on import', async () => {
    /** @type {string[]} */
    const order = []
    enrichRecordsWithTicketLlm.mockImplementation(async (records) => {
      order.push('ticket')
      return records.map((r) => ({ ...r, painPoint: 'LLM痛点' }))
    })
    enrichRecordsWithJourneys.mockImplementation(async (records) => {
      order.push('journey')
      return records.map((r) => ({ ...r, journeyL1: '日常运维', journeyL2: '使用运维' }))
    })

    const records = [
      {
        id: '1',
        rawText: '无法访问',
        dataSourceType: 'complaint_ticket',
        themes: ['未分类'],
        sentiment: 'neutral',
      },
    ]

    await enrichTicketRecordsForImport(
      records,
      { llmApiKey: 'sk-test', taggingPipelineOrder: 'legacy' },
      () => {},
    )

    expect(order).toEqual(['journey', 'ticket'])
  })
})
