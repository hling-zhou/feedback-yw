import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reprocessAllThemesAndSentiment } from './applyThemes.js'

vi.mock('./llmClient.js', () => ({
  resolveSettingsForLlm: vi.fn(async (s) => s),
}))

const enrichRecordsWithSharedDimensions = vi.fn(async (records) =>
  records.map((r) => ({ ...r, requestScene: 'scene' })),
)
const retagRecordsSharedDimensionsAfterTicketLlm = vi.fn(async (records) => records)
vi.mock('./dimensionTagging.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    enrichRecordsWithSharedDimensions: (...args) => enrichRecordsWithSharedDimensions(...args),
    retagRecordsSharedDimensionsAfterTicketLlm: (...args) =>
      retagRecordsSharedDimensionsAfterTicketLlm(...args),
  }
})

const enrichRecordsWithJourneys = vi.fn(async (records) =>
  records.map((r) => ({ ...r, journeyL1: 'J1', journeyL2: 'J2' })),
)
vi.mock('./journeySemantic.js', () => ({
  enrichRecordsWithJourneys: (...args) => enrichRecordsWithJourneys(...args),
  recordsNeedJourneyLlmProposal: vi.fn(() => false),
  recordHasUnknownJourney: vi.fn(() => true),
}))

const enrichRecordsWithTicketLlm = vi.fn(async (records) =>
  records.map((r) => ({ ...r, painPoint: 'ticket-llm' })),
)
vi.mock('./ticketAnalysis/ticketLlmEnrichment.js', () => ({
  enrichRecordsWithTicketLlm: (...args) => enrichRecordsWithTicketLlm(...args),
}))

vi.mock('./themeSemantic.js', () => ({
  canUseSemanticMatch: vi.fn(() => true),
}))

const BASE_RECORD = {
  id: '1',
  rawText: 'test',
  dataSourceType: 'complaint_ticket',
  themes: ['未分类'],
  sentiment: 'neutral',
}

const LLM_SETTINGS = { llmApiKey: 'sk-test', themeMatchMode: 'hybrid' }

describe('reprocessAllThemesAndSentiment pipeline order', () => {
  beforeEach(() => {
    enrichRecordsWithSharedDimensions.mockClear()
    enrichRecordsWithJourneys.mockClear()
    enrichRecordsWithTicketLlm.mockClear()
    retagRecordsSharedDimensionsAfterTicketLlm.mockClear()
    enrichRecordsWithTicketLlm.mockImplementation(async (records) =>
      records.map((r) => ({ ...r, painPoint: 'ticket-llm' })),
    )
  })

  it('O-01: ticket_first invokes ticket LLM before journey', async () => {
    /** @type {string[]} */
    const order = []
    enrichRecordsWithTicketLlm.mockImplementation(async (records) => {
      order.push('ticket')
      return records.map((r) => ({ ...r, painPoint: 'ticket-llm' }))
    })
    enrichRecordsWithJourneys.mockImplementation(async (records) => {
      order.push('journey')
      return records.map((r) => ({ ...r, journeyL1: 'J1', journeyL2: 'J2' }))
    })

    await reprocessAllThemesAndSentiment([BASE_RECORD], LLM_SETTINGS, undefined, {
      pipelineOrder: 'ticket_first',
    })

    expect(order).toEqual(['ticket', 'journey'])
    expect(retagRecordsSharedDimensionsAfterTicketLlm).toHaveBeenCalledTimes(1)
  })

  it('O-03: legacy invokes journey before ticket LLM', async () => {
    /** @type {string[]} */
    const order = []
    enrichRecordsWithTicketLlm.mockImplementation(async (records) => {
      order.push('ticket')
      return records.map((r) => ({ ...r, painPoint: 'ticket-llm' }))
    })
    enrichRecordsWithJourneys.mockImplementation(async (records) => {
      order.push('journey')
      return records.map((r) => ({ ...r, journeyL1: 'J1', journeyL2: 'J2' }))
    })

    await reprocessAllThemesAndSentiment([BASE_RECORD], LLM_SETTINGS, undefined, {
      pipelineOrder: 'legacy',
    })

    expect(order).toEqual(['journey', 'ticket'])
  })

  it('O-02: ticket_first abort skips journey when ticket LLM throws', async () => {
    enrichRecordsWithTicketLlm.mockRejectedValueOnce(new Error('429'))

    await expect(
      reprocessAllThemesAndSentiment([BASE_RECORD], LLM_SETTINGS, undefined, {
        pipelineOrder: 'ticket_first',
      }),
    ).rejects.toThrow('429')

    expect(enrichRecordsWithJourneys).not.toHaveBeenCalled()
  })

  it('O-04: ticketLlmOnly skips shared dimensions and journey', async () => {
    await reprocessAllThemesAndSentiment([BASE_RECORD], LLM_SETTINGS, undefined, {
      ticketLlmOnly: true,
    })

    expect(enrichRecordsWithSharedDimensions).not.toHaveBeenCalled()
    expect(enrichRecordsWithJourneys).not.toHaveBeenCalled()
    expect(enrichRecordsWithTicketLlm).toHaveBeenCalledTimes(1)
    expect(retagRecordsSharedDimensionsAfterTicketLlm).toHaveBeenCalledTimes(1)
  })

  it('O-05: journeyLlmOnly skips ticket LLM and shared dimensions', async () => {
    await reprocessAllThemesAndSentiment([BASE_RECORD], LLM_SETTINGS, undefined, {
      journeyLlmOnly: true,
    })

    expect(enrichRecordsWithSharedDimensions).not.toHaveBeenCalled()
    expect(enrichRecordsWithTicketLlm).not.toHaveBeenCalled()
    expect(enrichRecordsWithJourneys).toHaveBeenCalledTimes(1)
  })

  it('O-06: retag after ticket LLM can be disabled', async () => {
    await reprocessAllThemesAndSentiment([BASE_RECORD], LLM_SETTINGS, undefined, {
      pipelineOrder: 'ticket_first',
      retagDimensionsAfterTicketLlm: false,
    })

    expect(retagRecordsSharedDimensionsAfterTicketLlm).not.toHaveBeenCalled()
  })
})
