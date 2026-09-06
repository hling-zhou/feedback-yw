import { describe, expect, it } from 'vitest'
import {
  formatListOptimizationPreview,
  getDisplayCustomerRequest,
  getDisplayPainPoint,
  getAutoOptimizationSource,
  getOptimizationSource,
  getOptimizationSourceLabel,
  getPainPointSource,
  getCustomerRequestSource,
  getRootCauseSource,
  getJourneyDisplaySource,
  getRuleManualDimensionSource,
  getTicketAnalysisSourceLabel,
  normalizeTicketAnalysisFieldSource,
  recordHasFullTicketLlmEnrichment,
  recordHasManualTicketAnalysisPair,
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
    expect(getAutoOptimizationSource({ optimizationSource: 'llm' })).toBe('llm')
    expect(getRootCauseSource({ rootCauseSource: 'llm' })).toBe('llm')
    expect(getRootCauseSource({})).toBe('rule')
    expect(getRootCauseSource({ rootCauseSource: 'import' })).toBe('manual')
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

  describe('source tag rules', () => {
    it('established action does not change auto optimization source tag', () => {
      expect(
        getAutoOptimizationSource({
          establishedAction: '增加端口预检',
          optimizationSource: 'llm',
        }),
      ).toBe('llm')
      expect(getOptimizationSource({
        establishedAction: '增加端口预检',
        optimizationSource: 'llm',
      })).toBe('llm')
    })

    it('maps optimizationSource import to 人工 for auto tag', () => {
      expect(
        getAutoOptimizationSource({
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

    it('journey display source prefers manualTagFields over journeySource', () => {
      expect(
        getJourneyDisplaySource({
          journeySource: 'llm',
          manualTagFields: ['journey'],
        }),
      ).toBe('manual')
      expect(getJourneyDisplaySource({ journeySource: 'llm' })).toBe('llm')
      expect(getJourneyDisplaySource({})).toBe('rule')
    })

    it('rule/manual dimensions have no llm state', () => {
      expect(getRuleManualDimensionSource({}, 'requestScene')).toBe('rule')
      expect(
        getRuleManualDimensionSource(
          { lastAutoTags: { overlayHits: ['requestScene'] } },
          'requestScene',
        ),
      ).toBe('learned')
      expect(
        getRuleManualDimensionSource({ manualTagFields: ['sentiment'] }, 'sentiment'),
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

  it('recordNeedsTicketLlmEnrichment only checks customerRequest and painPoint', () => {
    const ticket = { dataSourceType: 'complaint_ticket' }
    expect(recordNeedsTicketLlmEnrichment(ticket)).toBe(true)
    expect(
      recordNeedsTicketLlmEnrichment({
        ...ticket,
        customerRequestSource: 'llm',
        painPointSource: 'llm',
      }),
    ).toBe(false)
    expect(
      recordNeedsTicketLlmEnrichment({
        ...ticket,
        customerRequestSource: 'llm',
        painPointSource: 'rule',
      }),
    ).toBe(true)
    expect(
      recordNeedsTicketLlmEnrichment({
        ...ticket,
        customerRequestSource: 'llm',
        painPointSource: 'llm',
        manualReviewOptimization: '人工',
        establishedAction: '举措',
      }),
    ).toBe(false)
    expect(
      recordNeedsTicketLlmEnrichment({
        ...ticket,
        customerRequestSource: 'manual',
        painPointSource: 'llm',
      }),
    ).toBe(true)
    expect(recordNeedsTicketLlmEnrichment({ dataSourceType: 'user_survey' })).toBe(false)
    expect(
      recordHasFullTicketLlmEnrichment({
        ...ticket,
        customerRequestSource: 'llm',
        painPointSource: 'llm',
      }),
    ).toBe(true)
  })

  it('recordHasManualTicketAnalysisPair when request and pain display sources are manual', () => {
    const ticket = { dataSourceType: 'complaint_ticket' }
    expect(recordHasManualTicketAnalysisPair(ticket)).toBe(false)
    expect(
      recordHasManualTicketAnalysisPair({
        ...ticket,
        customerRequestSource: 'import',
        painPointSource: 'import',
      }),
    ).toBe(true)
    expect(
      recordHasManualTicketAnalysisPair({
        ...ticket,
        customerRequest: '人工请求',
        customerRequestSource: 'manual',
        painPoint: '人工痛点',
        painPointSource: 'manual',
      }),
    ).toBe(true)
    expect(
      recordHasManualTicketAnalysisPair({
        ...ticket,
        customerRequestSource: 'llm',
        painPointSource: 'import',
      }),
    ).toBe(false)
    expect(recordHasManualTicketAnalysisPair({ dataSourceType: 'user_survey' })).toBe(false)
  })

  it('manual pair and full llm filters are mutually exclusive', () => {
    const fullLlm = {
      dataSourceType: 'complaint_ticket',
      customerRequestSource: 'llm',
      painPointSource: 'llm',
    }
    const manualPair = {
      dataSourceType: 'complaint_ticket',
      customerRequestSource: 'import',
      painPointSource: 'import',
    }
    expect(recordHasFullTicketLlmEnrichment(fullLlm)).toBe(true)
    expect(recordHasManualTicketAnalysisPair(fullLlm)).toBe(false)
    expect(recordHasFullTicketLlmEnrichment(manualPair)).toBe(false)
    expect(recordHasManualTicketAnalysisPair(manualPair)).toBe(true)
  })

  it('recordNeedsJourneyLlmEnrichment respects journeySource, gating skip, and manual journey', () => {
    const ticket = { dataSourceType: 'complaint_ticket' }
    expect(recordNeedsJourneyLlmEnrichment(ticket)).toBe(true)
    expect(
      recordNeedsJourneyLlmEnrichment({
        ...ticket,
        manualTagFields: ['journey'],
        journeySource: 'rule',
      }),
    ).toBe(false)
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
