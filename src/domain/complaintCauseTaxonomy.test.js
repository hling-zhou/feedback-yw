import { describe, expect, it } from 'vitest'
import {
  COMPLAINT_CAUSE_TAXONOMY,
  getComplaintCauseCascaderOptions,
  isValidComplaintCausePath,
  listComplaintCauseL2Options,
  listComplaintCauseL3Options,
} from './complaintCauseTaxonomy.js'

describe('complaintCauseTaxonomy', () => {
  it('loads three L1 roots from attachment', () => {
    expect(COMPLAINT_CAUSE_TAXONOMY.map((n) => n.label)).toEqual([
      '云能问题',
      '外单位问题',
      '客户体验类投诉',
    ])
  })

  it('lists linked L2/L3 options', () => {
    expect(listComplaintCauseL2Options('云能问题')).toContain('产品原因')
    expect(listComplaintCauseL3Options('云能问题', '产品原因')).toContain('计算部原因')
  })

  it('validates cascader path', () => {
    expect(isValidComplaintCausePath({ l1: '云能问题', l2: '产品原因', l3: '计算部原因' })).toBe(true)
    expect(isValidComplaintCausePath({ l1: '云能问题', l2: '产品原因', l3: '不存在' })).toBe(false)
    expect(isValidComplaintCausePath({ l1: '云能问题', l2: '', l3: '' })).toBe(false)
  })

  it('builds cascader options with value===label', () => {
    const opts = getComplaintCauseCascaderOptions()
    expect(opts[0].value).toBe('云能问题')
    expect(opts[0].children?.[0]?.children?.[0]?.value).toBeTruthy()
  })
})
