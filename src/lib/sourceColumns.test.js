import { describe, it, expect } from 'vitest'
import {
  buildSourceColumns,
  getSourceColumnValue,
  hasIncompleteSourceColumns,
} from './sourceColumns.js'
import { CUSTOMER_TIER_SOURCE_COLUMN } from '../domain/customerTier.js'

describe('sourceColumns', () => {
  it('buildSourceColumns from mapped row', () => {
    const cols = buildSourceColumns({
      handlingText: '处理内容',
      problemTypeL1FinalCol: '性能',
      problemTypeL2FinalCol: '慢',
      rootCauseCol: '网络',
      responseText: '已修复',
    })
    expect(cols?.['处理意见']).toBe('处理内容')
    expect(cols?.['投诉原因 一级（终判）']).toBe('性能')
    expect(cols?.['投诉原因 二级（终判）']).toBe('慢')
  })

  it('hasIncompleteSourceColumns when no snapshot', () => {
    expect(hasIncompleteSourceColumns([{ ticketId: '1' }])).toBe(true)
    expect(
      hasIncompleteSourceColumns([
        {
          ticketId: '1',
          sourceColumns: {
            处理意见: 'a',
            '投诉原因 一级（终判）': 'b',
            '投诉原因 二级（终判）': 'c',
            '投诉原因 三级（终判）': 'd',
            '根因（必填）': 'e',
            '解决方案（必填）': 'f',
          },
        },
      ]),
    ).toBe(false)
  })

  it('getSourceColumnValue falls back', () => {
    expect(
      getSourceColumnValue({ handlingText: 'x' }, '处理意见'),
    ).toBe('x')
    expect(getSourceColumnValue({ customerTier: '金牌' }, CUSTOMER_TIER_SOURCE_COLUMN)).toBe('金牌')
  })

  it('buildSourceColumns stores 移动云客户服务等级', () => {
    const cols = buildSourceColumns({ customerTierCol: '银牌' })
    expect(cols?.[CUSTOMER_TIER_SOURCE_COLUMN]).toBe('银牌')
  })
})
