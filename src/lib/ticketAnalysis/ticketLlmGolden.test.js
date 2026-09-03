import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TICKET_LLM_GOLDEN_CASES } from './fixtures/ticketLlmGoldenCases.js'
import {
  GOLDEN_REQUEST_PAIN_JACCARD_MIN,
  meetsOptimizationGoldenRatio,
  optimizationLlmNonGenericRate,
  requestPainJaccard,
} from './ticketLlmGolden.js'
import { enrichRecordWithTicketLlm, recordToTicketAnalysisInput } from './ticketLlmEnrichment.js'
import { buildTicketAnalysisCorpus } from './ticketAnalysisCorpus.js'

/** @type {Map<string, import('./fixtures/ticketLlmGoldenCases.js').TicketLlmGoldenCase['llm']>} */
const goldenByTaggingText = new Map()

function rebuildGoldenMap() {
  goldenByTaggingText.clear()
  for (const c of TICKET_LLM_GOLDEN_CASES) {
    const corpus = buildTicketAnalysisCorpus(recordToTicketAnalysisInput(c.record))
    goldenByTaggingText.set(corpus.taggingText, c.llm)
  }
}

rebuildGoldenMap()

vi.mock('./customerRequestLLM.js', () => ({
  extractCustomerRequestWithLLM: vi.fn(async ({ taggingText, ruleFallback }) => {
    const g = goldenByTaggingText.get(taggingText)
    return g?.customerRequest || ruleFallback
  }),
}))

vi.mock('./painPointLLM.js', () => ({
  extractPainPointWithLLM: vi.fn(async ({ taggingText }) => {
    const g = goldenByTaggingText.get(taggingText)
    return g?.painPoint || ''
  }),
}))

vi.mock('./ticketOptimizationLLM.js', () => ({
  extractTicketOptimizationsWithLLM: vi.fn(async ({ text }) => {
    const g = goldenByTaggingText.get(text)
    return {
      optimizationProduct: (g?.productOptimizations || []).join('\n'),
      optimizationService: (g?.serviceOptimizations || []).join('\n'),
    }
  }),
}))

vi.mock('./ticketAnalysisUnifiedLLM.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    extractTicketAnalysisUnifiedWithLLM: vi.fn(async ({ taggingText, ruleFallback }) => {
      const g = goldenByTaggingText.get(taggingText)
      if (!g) {
        return {
          ...ruleFallback,
          customerRequestSource: 'rule',
          painPointSource: 'rule',
          optimizationSource: 'rule',
        }
      }
      return {
        customerRequest: g.customerRequest,
        customerRequestSource: 'llm',
        painPoint: g.painPoint,
        painPointSource: 'llm',
        optimizationProduct: g.productOptimizations.join('\n'),
        optimizationService: (g.serviceOptimizations || []).join('\n'),
        optimizationSuggestion: [...g.productOptimizations, ...(g.serviceOptimizations || [])].join('\n'),
        optimizationSource: 'llm',
      }
    }),
  }
})

const SETTINGS = { llmServerConfigured: true, themeMatchMode: 'hybrid' }

describe('ticketLlmGolden U-06 / O-golden', () => {
  beforeEach(() => {
    rebuildGoldenMap()
  })

  it('U-06: unified vs separate on 20 golden cases — request/pain Jaccard ≥ 0.85', async () => {
    /** @type {import('../types.js').FeedbackRecord[]} */
    const separateOut = []
    /** @type {import('../types.js').FeedbackRecord[]} */
    const unifiedOut = []

    for (const { record } of TICKET_LLM_GOLDEN_CASES) {
      const base = /** @type {import('../types.js').FeedbackRecord} */ ({
        ...record,
        themes: ['未分类'],
        sentiment: 'neutral',
      })
      separateOut.push(
        await enrichRecordWithTicketLlm(base, { ...SETTINGS, ticketLlmMode: 'separate' }),
      )
      unifiedOut.push(
        await enrichRecordWithTicketLlm({ ...base }, { ...SETTINGS, ticketLlmMode: 'unified' }),
      )
    }

    const jaccards = separateOut.map((sep, i) => requestPainJaccard(sep, unifiedOut[i]))
    const min = Math.min(...jaccards)
    const avg = jaccards.reduce((a, b) => a + b, 0) / jaccards.length

    expect(separateOut).toHaveLength(20)
    expect(min).toBeGreaterThanOrEqual(GOLDEN_REQUEST_PAIN_JACCARD_MIN)
    expect(avg).toBeGreaterThanOrEqual(GOLDEN_REQUEST_PAIN_JACCARD_MIN)
  })

  it('O-golden: unified optimization 非 generic 率 ≥ separate 基线的 90%', async () => {
    /** @type {import('../types.js').FeedbackRecord[]} */
    const separateOut = []
    /** @type {import('../types.js').FeedbackRecord[]} */
    const unifiedOut = []

    for (const { record } of TICKET_LLM_GOLDEN_CASES) {
      const base = /** @type {import('../types.js').FeedbackRecord} */ ({
        ...record,
        themes: ['未分类'],
        sentiment: 'neutral',
      })
      separateOut.push(
        await enrichRecordWithTicketLlm(base, { ...SETTINGS, ticketLlmMode: 'separate' }),
      )
      unifiedOut.push(
        await enrichRecordWithTicketLlm({ ...base }, { ...SETTINGS, ticketLlmMode: 'unified' }),
      )
    }

    const separateRate = optimizationLlmNonGenericRate(separateOut)
    const unifiedRate = optimizationLlmNonGenericRate(unifiedOut)

    expect(separateRate).toBeGreaterThan(0)
    expect(meetsOptimizationGoldenRatio(unifiedRate, separateRate)).toBe(true)
  })

  it('U-10: golden batch optimizationSource=llm rate is measurable', async () => {
    const out = []
    for (const { record } of TICKET_LLM_GOLDEN_CASES) {
      out.push(
        await enrichRecordWithTicketLlm(
          /** @type {import('../types.js').FeedbackRecord} */ ({
            ...record,
            themes: ['未分类'],
            sentiment: 'neutral',
          }),
          { ...SETTINGS, ticketLlmMode: 'unified' },
        ),
      )
    }
    const rate = optimizationLlmNonGenericRate(out)
    expect(rate).toBeGreaterThanOrEqual(0.9)
  })
})
