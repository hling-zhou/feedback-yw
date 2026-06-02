import { describe, expect, it } from 'vitest'
import { isValidLlmCustomerRequest } from './customerRequestLLM.js'

describe('isValidLlmCustomerRequest', () => {
  it('rejects LLM output that mixes platform solution outcome into customer request', () => {
    const bad =
      '客户咨询云专线变更机房地址的解决方案，但未提供具体信息导致离线处理。'
    const rule = '云专线变更机房地址'
    expect(isValidLlmCustomerRequest(bad, rule)).toBe(false)
  })

  it('accepts valid consult-style customer request', () => {
    expect(isValidLlmCustomerRequest('咨询云专线变更机房地址方案。', '云专线变更机房地址')).toBe(
      true,
    )
  })
})
