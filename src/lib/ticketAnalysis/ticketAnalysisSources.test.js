import { describe, expect, it } from 'vitest'
import {
  formatListOptimizationPreview,
  getDisplayCustomerRequest,
  getDisplayPainPoint,
  getOptimizationSource,
  getAutoOptimizationSource,
  getOptimizationSourceLabel,
  getPainPointSource,
  getCustomerRequestSource,
  getTicketAnalysisSourceLabel,
  normalizeTicketAnalysisFieldSource,
  recordHasFullTicketLlmEnrichment,
  recordNeedsTicketLlmEnrichment,
  recordNeedsJourneyLlmEnrichment,
  recordHasJourneyLlmEnrichment,
  countRecordsNeedingJourneyLlmEnrichment,
  computeJourneyEnrichmentDelta,
} from './ticketAnalysisSources.js'

describe('ticketAnalysisSources', () => {
  it('detects llm vs rule sources', () => {
    expect(getPainPointSource({ painPointSource: 'llm' })).toBe('llm')
    expect(getPainPointSource({})).toBe('rule')
    expect(getCustomerRequestSource({ customerRequestSource: 'llm' })).toBe('llm')
    expect(getCustomerRequestSource({})).toBe('rule')
    expect(getOptimizationSource({ optimizationSource: 'llm' })).toBe('llm')
    expect(getOptimizationSource({ manualReviewOptimization: '人工建议' })).toBe('manual')
  })

  it('labels optimization source for UI', () => {
    expect(getOptimizationSourceLabel('manual')).toBe('人工')
    expect(getOptimizationSourceLabel('import')).toBe('人工')
    expect(getOptimizationSourceLabel('llm')).toBe('大模型')
  })

  it('maps import/manual sources to 人工 for request and pain point tags', () => {
    expect(getCustomerRequestSource({ customerRequestSource: 'import' })).toBe('manual')
    expect(getPainPointSource({ painPointSource: 'manual' })).toBe('manual')
    expect(getTicketAnalysisSourceLabel('import')).toBe('人工')
  })

  describe('P2-6 source tag rules', () => {
    it('shows 人工 for optimization when establishedAction is set', () => {
      expect(
        getOptimizationSource({
          establishedAction: '增加端口预检',
          manualReviewOptimization: '',
          optimizationSource: 'llm',
        }),
      ).toBe('manual')
      expect(getOptimizationSourceLabel(getOptimizationSource({
        establishedAction: '增加端口预检',
        optimizationSource: 'llm',
      }))).toBe('人工')
    })

    it('auto optimization source ignores established action', () => {
      expect(
        getAutoOptimizationSource({
          establishedAction: '增加端口预检',
          optimizationSource: 'llm',
        }),
      ).toBe('llm')
      expect(
        getAutoOptimizationSource({
          optimizationSource: 'import',
        }),
      ).toBe('manual')
    })

    it('falls back to legacy manualReviewOptimization for optimization source', () => {
      expect(
        getOptimizationSource({
          establishedAction: '',
          manualReviewOptimization: 'legacy 人工举措',
          optimizationSource: 'rule',
        }),
      ).toBe('manual')
    })

    it('maps optimizationSource import to 人工 without established action text', () => {
      expect(
        getOptimizationSource({
          optimizationSource: 'import',
          optimizationProduct: '导入的产品优化',
        }),
      ).toBe('manual')
    })

    it('shows manual for customerRequest when manualTagFields marks dimension', () => {
      expect(
        getCustomerRequestSource({
          customerRequest: '人工客户请求',
          customerRequestSource: 'rule',
          manualTagFields: ['customerRequest'],
        }),
      ).toBe('manual')
    })

    it('normalizeTicketAnalysisFieldSource maps import to manual', () => {
      expect(normalizeTicketAnalysisFieldSource('import')).toBe('manual')
      expect(normalizeTicketAnalysisFieldSource('llm')).toBe('llm')
      expect(normalizeTicketAnalysisFieldSource(undefined)).toBe('rule')
    })
  })

  it('prefers structured display fields', () => {
    const record = {
      customerRequest: '端口不通',
      painPoint: '安全组未放行端口',
      problemSummary: '旧摘要',
      optimizationProduct: '产品优化A',
      optimizationService: '流程优化B',
    }
    expect(getDisplayCustomerRequest(record)).toBe('端口不通')
    expect(getDisplayPainPoint(record)).toBe('安全组未放行端口')
    expect(formatListOptimizationPreview(record)).toMatch(/产品优化A/)
    expect(formatListOptimizationPreview(record)).toMatch(/流程优化B/)
  })

  it('recordNeedsTicketLlmEnrichment detects partial or missing llm fields', () => {
    const ticket = { dataSourceType: 'complaint_ticket' }
    expect(recordNeedsTicketLlmEnrichment(ticket)).toBe(true)
    expect(
      recordNeedsTicketLlmEnrichment({
        ...ticket,
        customerRequestSource: 'llm',
        painPointSource: 'llm',
        optimizationSource: 'llm',
      }),
    ).toBe(false)
    expect(
      recordNeedsTicketLlmEnrichment({
        ...ticket,
        customerRequestSource: 'llm',
        painPointSource: 'rule',
        optimizationSource: 'llm',
      }),
    ).toBe(true)
    expect(
      recordNeedsTicketLlmEnrichment({
        ...ticket,
        customerRequestSource: 'llm',
        painPointSource: 'llm',
        manualReviewOptimization: '人工',
      }),
    ).toBe(false)
    expect(recordNeedsTicketLlmEnrichment({ dataSourceType: 'user_survey' })).toBe(false)
    expect(
      recordHasFullTicketLlmEnrichment({
        ...ticket,
        customerRequestSource: 'llm',
        painPointSource: 'llm',
        optimizationSource: 'llm',
      }),
    ).toBe(true)
  })

  it('R-03: recordNeedsJourneyLlmEnrichment respects journeySource and gating skip', () => {
    const ticket = { dataSourceType: 'complaint_ticket' }
    expect(recordNeedsJourneyLlmEnrichment(ticket)).toBe(true)
    expect(
      recordNeedsJourneyLlmEnrichment({
        ...ticket,
        journeySource: 'llm',
        journeyL1: '购买',
        journeyL2: '下单',
      }),
    ).toBe(false)
    expect(
      recordNeedsJourneyLlmEnrichment({
        ...ticket,
        journeySource: 'rule',
        journeyMatchScore: 3,
        journeyL1: '购买',
        journeyL2: '下单',
      }),
    ).toBe(false)
    expect(
      recordNeedsJourneyLlmEnrichment({
        ...ticket,
        journeySource: 'rule',
        journeyL1: '未识别环节',
        journeyL2: '未识别子环节',
      }),
    ).toBe(true)
    expect(recordNeedsJourneyLlmEnrichment({ dataSourceType: 'user_survey' })).toBe(false)
    expect(recordHasJourneyLlmEnrichment({ ...ticket, journeySource: 'llm' })).toBe(true)
  })

  it('computeJourneyEnrichmentDelta counts llm and gating skip', () => {
    const before = [
      { dataSourceType: 'complaint_ticket', journeyL1: '未识别环节', journeyL2: '未识别子环节' },
      { dataSourceType: 'complaint_ticket', journeyL1: '未识别环节', journeyL2: '未识别子环节' },
    ]
    const after = [
      {
        dataSourceType: 'complaint_ticket',
        journeySource: 'llm',
        journeyL1: '购买',
        journeyL2: '下单',
      },
      {
        dataSourceType: 'complaint_ticket',
        journeySource: 'rule',
        journeyMatchScore: 4,
        journeyL1: '购买',
        journeyL2: '下单',
      },
    ]
    expect(computeJourneyEnrichmentDelta(before, after)).toEqual({
      journeyLlmCompleted: 1,
      journeySkippedByGating: 1,
    })
    expect(countRecordsNeedingJourneyLlmEnrichment(after)).toBe(0)
  })
})
