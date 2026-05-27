import { describe, it, expect } from 'vitest'
import {
  buildJourneyLlmPrompts,
  catalogHasJourneyOptions,
  isLlmProposedJourney,
  mergeJourneyResult,
  recordTaxonomyKey,
  recordsNeedJourneyLlmProposal,
} from './journeySemantic.js'

const journeys = [
  {
    id: 'buy',
    label: '购买',
    children: [{ id: 'order', label: '下单', keywords: ['下单'] }],
  },
]

describe('journeySemantic', () => {
  it('catalogHasJourneyOptions', () => {
    expect(catalogHasJourneyOptions(journeys)).toBe(true)
    expect(catalogHasJourneyOptions([])).toBe(false)
    expect(catalogHasJourneyOptions([{ id: 'x', label: '空', children: [] }])).toBe(false)
  })

  it('isLlmProposedJourney detects out-of-catalog labels', () => {
    expect(
      isLlmProposedJourney({ journeyL1: '购买', journeyL2: '下单' }, journeys),
    ).toBe(false)
    expect(
      isLlmProposedJourney({ journeyL1: '新环节', journeyL2: '子环节' }, journeys),
    ).toBe(true)
    expect(
      isLlmProposedJourney({ journeyL1: '未识别环节', journeyL2: '未识别子环节' }, journeys),
    ).toBe(false)
  })

  it('mergeJourneyResult prefers proposed llm labels over local unknown', () => {
    const local = { journeyL1: '未识别环节', journeyL2: '未识别子环节' }
    const llm = { journeyL1: '新环节', journeyL2: '子环节' }
    expect(mergeJourneyResult(local, llm, journeys)).toEqual(llm)
  })

  it('mergeJourneyResult prefers llm when catalog empty', () => {
    const local = { journeyL1: '未识别环节', journeyL2: '未识别子环节' }
    const llm = { journeyL1: '开通', journeyL2: '勘查' }
    expect(mergeJourneyResult(local, llm, [])).toEqual(llm)
  })

  it('buildJourneyLlmPrompts uses proposal mode when catalog empty', () => {
    const { systemPrompt, userPrompt } = buildJourneyLlmPrompts({
      catalog: [],
      productName: '测试产品',
      hasHints: false,
      texts: ['客户无法绑定公网IP'],
    })
    expect(systemPrompt).toContain('尚未配置')
    expect(systemPrompt).toContain('待复核')
    expect(userPrompt).toContain('当前为空')
  })

  it('buildJourneyLlmPrompts allows new labels when catalog non-empty', () => {
    const catalog = [
      {
        journeyL1: '购买',
        journeyL2: '下单',
        l1Description: '',
        l2Description: '',
        keywords: '',
      },
    ]
    const { systemPrompt } = buildJourneyLlmPrompts({
      catalog,
      productName: '测试',
      hasHints: false,
      texts: ['test'],
    })
    expect(systemPrompt).toContain('无合适项')
    expect(systemPrompt).not.toContain('不可编造')
  })

  it('recordTaxonomyKey prefers productKey on record', () => {
    expect(
      recordTaxonomyKey({ product: '云专线', productKey: 'dc' }),
    ).toBe('dc')
  })

  it('recordsNeedJourneyLlmProposal when product has empty catalog', () => {
    const records = [
      {
        id: '1',
        product: '新产品',
        productKey: 'newprod',
        handlingText: 'test',
      },
    ]
    expect(recordsNeedJourneyLlmProposal(records)).toBe(true)
  })
})
