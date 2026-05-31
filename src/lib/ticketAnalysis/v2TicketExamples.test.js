import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  V2_CUSTOMER_REQUEST_EXAMPLES,
  V2_PAIN_POINT_EXAMPLES,
  buildCustomerRequestTicketInput,
} from './fixtures/v2TicketExamples.js'
import { extractCustomerRequestRule } from './customerRequestExtract.js'
import { extractPainPoint } from './painPointExtract.js'
import { validateTicketAnalysisPair } from './validateTicketAnalysisPair.js'
import {
  assertLlmGoldenSimilarity,
  assertRuleLayerCustomerRequest,
  assertRuleLayerPainPoint,
  V2_GOLDEN_JACCARD_MIN,
} from './v2TicketGolden.js'
import { enrichRecordWithTicketLlm, recordToTicketAnalysisInput } from './ticketLlmEnrichment.js'
import { buildTicketAnalysisCorpus } from './ticketAnalysisCorpus.js'

/** @type {Map<string, { customerRequest: string; painPoint: string }>} */
const v2GoldenByTaggingText = new Map()

function rebuildV2GoldenMap() {
  v2GoldenByTaggingText.clear()
  for (const c of V2_CUSTOMER_REQUEST_EXAMPLES) {
    const input = buildCustomerRequestTicketInput(c)
    const corpus = buildTicketAnalysisCorpus(
      recordToTicketAnalysisInput({
        id: c.id,
        product: '弹性公网 IP',
        productKey: 'eip',
        dataSourceType: 'complaint_ticket',
        ...input,
      }),
    )
    v2GoldenByTaggingText.set(corpus.taggingText, {
      customerRequest: c.expectedCustomerRequest,
      painPoint: '',
    })
  }
  for (const p of V2_PAIN_POINT_EXAMPLES) {
    const body = `详细内容：客户反馈${p.customerUtterance}`
    const corpus = buildTicketAnalysisCorpus(
      recordToTicketAnalysisInput({
        id: p.id,
        product: '弹性公网 IP',
        productKey: 'eip',
        dataSourceType: 'complaint_ticket',
        rawText: body,
        handlingText: body,
      }),
    )
    const existing = v2GoldenByTaggingText.get(corpus.taggingText)
    v2GoldenByTaggingText.set(corpus.taggingText, {
      customerRequest: existing?.customerRequest || p.customerUtterance.slice(0, 80),
      painPoint: p.expectedPainPoint,
    })
  }
}

rebuildV2GoldenMap()

vi.mock('./ticketAnalysisUnifiedLLM.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    extractTicketAnalysisUnifiedWithLLM: vi.fn(async ({ taggingText, ruleFallback }) => {
      const g = v2GoldenByTaggingText.get(taggingText)
      if (!g?.painPoint && !g?.customerRequest) {
        return {
          ...ruleFallback,
          customerRequestSource: 'rule',
          painPointSource: 'rule',
          optimizationSource: 'rule',
        }
      }
      return {
        customerRequest: g.customerRequest || ruleFallback.customerRequest,
        customerRequestSource: 'llm',
        painPoint: g.painPoint || ruleFallback.painPoint,
        painPointSource: g.painPoint ? 'llm' : 'rule',
        optimizationProduct: '控制台增加诊断引导。',
        optimizationService: '',
        optimizationSuggestion: '控制台增加诊断引导。',
        optimizationSource: 'llm',
      }
    }),
  }
})

const SETTINGS = { llmApiKey: 'sk-test', ticketLlmMode: 'unified', themeMatchMode: 'hybrid' }

describe('V2 ticket examples §1.4 — customer request rule layer', () => {
  it.each(V2_CUSTOMER_REQUEST_EXAMPLES.map((c) => [c.id, c]))(
    'TAG-CR rule %s captures core keywords within length',
    (_id, example) => {
      const input = buildCustomerRequestTicketInput(example)
      const actual = extractCustomerRequestRule(input)
      assertRuleLayerCustomerRequest(actual, example)
    },
  )
})

describe('V2 ticket examples §2.4 — pain point rule layer', () => {
  it.each(V2_PAIN_POINT_EXAMPLES.map((p) => [p.id, p]))(
    'TAG-PP rule %s captures essence without leading phrase',
    (_id, example) => {
      const actual = extractPainPoint({
        customerRequest: example.customerUtterance,
        taggingText: example.customerUtterance,
      })
      assertRuleLayerPainPoint(actual, example)
    },
  )
})

describe('V2 ticket examples — LLM golden validation', () => {
  it.each(V2_CUSTOMER_REQUEST_EXAMPLES.map((c) => [c.id, c]))(
    'TAG-CR LLM %s validates and matches golden Jaccard',
    (_id, example) => {
      const validated = validateTicketAnalysisPair(
        example.expectedCustomerRequest,
        '',
        example.rawSnippet.slice(0, 80),
        '',
      )
      assertLlmGoldenSimilarity(validated.customerRequest, example.expectedCustomerRequest)
      expect(validated.customerRequest.length).toBeLessThanOrEqual(120)
    },
  )

  it.each(V2_PAIN_POINT_EXAMPLES.map((p) => [p.id, p]))(
    'TAG-PP LLM %s validates and matches golden Jaccard',
    (_id, example) => {
      const validated = validateTicketAnalysisPair(
        example.customerUtterance.slice(0, 60),
        example.expectedPainPoint,
        '',
        example.customerUtterance,
      )
      assertLlmGoldenSimilarity(validated.painPoint, example.expectedPainPoint)
      expect(validated.painPoint).not.toMatch(/^用户希望/)
      expect(validated.painPoint.length).toBeLessThanOrEqual(80)
    },
  )
})

describe('V2 ticket examples — unified LLM enrichment mock', () => {
  beforeEach(() => {
    rebuildV2GoldenMap()
  })

  it('TAG-CR/PP: enrichRecordWithTicketLlm returns V2 golden customerRequest for §1.4 cases', async () => {
    for (const example of V2_CUSTOMER_REQUEST_EXAMPLES) {
      const input = buildCustomerRequestTicketInput(example)
      const record = /** @type {import('../types.js').FeedbackRecord} */ ({
        id: example.id,
        product: '弹性公网 IP',
        productKey: 'eip',
        dataSourceType: 'complaint_ticket',
        themes: ['未分类'],
        sentiment: 'neutral',
        ...input,
      })
      const out = await enrichRecordWithTicketLlm(record, SETTINGS)
      expect(out.customerRequestSource).toBe('llm')
      assertLlmGoldenSimilarity(out.customerRequest, example.expectedCustomerRequest)
    }
  })

  it('TAG-PP: enrichRecordWithTicketLlm returns V2 golden painPoint for §2.4 cases', async () => {
    for (const example of V2_PAIN_POINT_EXAMPLES) {
      const body = `详细内容：客户反馈${example.customerUtterance}`
      const record = /** @type {import('../types.js').FeedbackRecord} */ ({
        id: example.id,
        product: '弹性公网 IP',
        productKey: 'eip',
        dataSourceType: 'complaint_ticket',
        rawText: body,
        handlingText: body,
        themes: ['未分类'],
        sentiment: 'neutral',
      })
      const out = await enrichRecordWithTicketLlm(record, SETTINGS)
      expect(out.painPointSource).toBe('llm')
      assertLlmGoldenSimilarity(out.painPoint, example.expectedPainPoint)
    }
  })

  it('fixture count matches V2 spec tables (11 + 10)', () => {
    expect(V2_CUSTOMER_REQUEST_EXAMPLES).toHaveLength(11)
    expect(V2_PAIN_POINT_EXAMPLES).toHaveLength(10)
    expect(V2_GOLDEN_JACCARD_MIN).toBeGreaterThanOrEqual(0.85)
  })
})
