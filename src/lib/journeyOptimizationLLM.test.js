import { describe, expect, it } from 'vitest'
import {
  isGenericMeasure,
  isGenericRecommendationText,
  isTicketDerivedPlanningText,
  isValidRootCause,
} from './journeyOptimizationLLM.js'

describe('journeyOptimizationLLM text guards', () => {
  it('isValidRootCause rejects placeholders and generic phrases', () => {
    expect(isValidRootCause('待分析')).toBe(false)
    expect(isValidRootCause('安全组未放行导致端口不通')).toBe(true)
  })

  it('isGenericMeasure flags empty and ticket-derived templates', () => {
    expect(isGenericMeasure('')).toBe(true)
    expect(isGenericMeasure('针对根因「端口不通」建立专项修复与验收标准')).toBe(true)
    expect(isGenericMeasure('上线端口连通性一键诊断工具，覆盖常见安全组误配场景')).toBe(false)
  })

  it('isTicketDerivedPlanningText detects handling-note patterns', () => {
    expect(isTicketDerivedPlanningText('目前进展：已协助客户调整安全组')).toBe(true)
    expect(isTicketDerivedPlanningText('完善控制台端口放通引导与预检提示')).toBe(false)
  })

  it('isGenericRecommendationText applies stricter planning templates', () => {
    expect(isGenericRecommendationText('结合旅程热点与问题类型，制定分阶段改进计划')).toBe(true)
    expect(isGenericRecommendationText('优化 EIP 绑定流程中的默认安全组提示文案')).toBe(false)
  })
})
