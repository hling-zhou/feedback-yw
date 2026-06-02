import { describe, expect, it } from 'vitest'
import { reprocessFeedbackRecord } from '../lib/pipeline.js'
import {
  buildCustomerRequestManualSavePatch,
  buildCustomerRequestSavePatch,
  buildPainPointManualSavePatch,
  buildPainPointSavePatch,
  CUSTOMER_REQUEST_MANUAL_MAX_LENGTH,
  normalizeManualCustomerRequest,
  normalizeManualPainPoint,
  PAIN_POINT_MANUAL_MAX_LENGTH,
} from './ticketAnalysisManualFields.js'
import {
  getManualTagFields,
  mergeManualTagFieldsOnUserEdit,
  preserveManualTags,
} from '../lib/manualTagFields.js'

const base = {
  id: '1',
  rawText: '公网 IP 无法访问，请协助排查端口与安全组配置。',
  handlingText: '已协助客户调整安全组并复测通过，8085 端口已放行。',
  customerQuote: '公网 IP 无法访问',
  requestScene: '咨询',
  problemType: '配额与权限申请',
  journeyL1: '产品订改续',
  journeyL2: '权限及配额限制',
  sentiment: 'neutral',
  themes: ['权限及配额限制'],
  problemSummary: '',
  solutionSummary: '',
  rootCause: '',
  optimizationSuggestion: '',
  status: 'open',
  importedAt: '2026-01-01',
  dataSourceType: 'complaint_ticket',
}

describe('ticketAnalysisManualFields', () => {
  it('normalizeManualCustomerRequest caps at 120 chars', () => {
    expect(normalizeManualCustomerRequest('  abc  ')).toBe('abc')
    expect(normalizeManualCustomerRequest('x'.repeat(CUSTOMER_REQUEST_MANUAL_MAX_LENGTH + 5)).length).toBe(
      CUSTOMER_REQUEST_MANUAL_MAX_LENGTH,
    )
  })

  it('normalizeManualPainPoint caps at 80 chars', () => {
    expect(normalizeManualPainPoint('x'.repeat(PAIN_POINT_MANUAL_MAX_LENGTH + 3)).length).toBe(
      PAIN_POINT_MANUAL_MAX_LENGTH,
    )
  })

  it('buildCustomerRequestSavePatch marks manual only when content changes', () => {
    const existing = { customerRequest: '原请求', customerRequestSource: 'llm' }
    expect(buildCustomerRequestSavePatch(existing, '原请求')).toEqual({
      customerRequest: '原请求',
    })
    expect(buildCustomerRequestSavePatch(existing, '新请求')).toEqual({
      customerRequest: '新请求',
      customerRequestSource: 'manual',
    })
  })

  it('buildPainPointSavePatch marks manual only when content changes', () => {
    const existing = { painPoint: '原痛点', painPointSource: 'llm' }
    expect(buildPainPointSavePatch(existing, '原痛点')).toEqual({
      painPoint: '原痛点',
      problemSummary: '原痛点',
    })
    expect(buildPainPointSavePatch(existing, '新痛点')).toEqual({
      painPoint: '新痛点',
      problemSummary: '新痛点',
      painPointSource: 'manual',
    })
  })

  it('buildCustomerRequestManualSavePatch always marks source manual', () => {
    expect(buildCustomerRequestManualSavePatch('人工客户请求')).toEqual({
      customerRequest: '人工客户请求',
      customerRequestSource: 'manual',
    })
  })

  it('buildPainPointManualSavePatch syncs problemSummary and marks source manual', () => {
    expect(buildPainPointManualSavePatch('人工痛点')).toEqual({
      painPoint: '人工痛点',
      problemSummary: '人工痛点',
      painPointSource: 'manual',
    })
  })
})

describe('manualTagFields P2-5 customerRequest/painPoint', () => {
  it('mergeManualTagFieldsOnUserEdit marks customerRequest and painPoint dimensions', () => {
    expect(mergeManualTagFieldsOnUserEdit(base, { customerRequest: 'x' })).toContain(
      'customerRequest',
    )
    expect(mergeManualTagFieldsOnUserEdit(base, { painPoint: 'y' })).toContain('painPoint')
    expect(mergeManualTagFieldsOnUserEdit(base, { problemSummary: 'y' })).toContain('painPoint')
  })

  it('preserveManualTags keeps customerRequest and source after retag output', () => {
    const original = {
      ...base,
      manualTagFields: ['customerRequest'],
      customerRequest: '人工复核客户请求内容',
      customerRequestSource: 'manual',
    }
    const processed = {
      ...original,
      customerRequest: '规则重算客户请求',
      customerRequestSource: 'rule',
    }
    const kept = preserveManualTags(original, processed)
    expect(kept.customerRequest).toBe('人工复核客户请求内容')
    expect(kept.customerRequestSource).toBe('manual')
  })

  it('preserveManualTags keeps painPoint and source after retag output', () => {
    const original = {
      ...base,
      manualTagFields: ['painPoint'],
      painPoint: '人工复核痛点',
      problemSummary: '人工复核痛点',
      painPointSource: 'manual',
    }
    const processed = {
      ...original,
      painPoint: '规则重算痛点',
      problemSummary: '规则重算痛点',
      painPointSource: 'rule',
    }
    const kept = preserveManualTags(original, processed)
    expect(kept.painPoint).toBe('人工复核痛点')
    expect(kept.painPointSource).toBe('manual')
  })

  it('reprocessFeedbackRecord preserves manual customerRequest on default retag', () => {
    const fb = {
      ...base,
      product: '虚拟私有云',
      productSpec: '虚拟私有云',
      customerRequest: '人工复核：外网端口不通请加急',
      customerRequestSource: 'manual',
      painPoint: '安全组未放行',
      painPointSource: 'rule',
      manualTagFields: ['customerRequest'],
    }
    const out = reprocessFeedbackRecord(fb, { useRegex: true })
    expect(out).not.toBeNull()
    expect(out.customerRequest).toBe('人工复核：外网端口不通请加急')
    expect(out.customerRequestSource).toBe('manual')
    expect(getManualTagFields(out)).toContain('customerRequest')
  })
})
