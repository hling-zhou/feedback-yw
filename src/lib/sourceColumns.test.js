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
            '问题原因': 'e',
            '优化举措/建议': 'f',
          },
        },
      ]),
    ).toBe(false)
  })

  it('consultation tickets do not require 终判 snapshot columns', () => {
    expect(
      hasIncompleteSourceColumns([
        {
          dataSourceType: 'consultation_ticket',
          ticketId: 'z-1',
          sourceColumns: {
            处理意见: 'a',
            问题原因: 'e',
            '优化举措/建议': 'f',
          },
        },
      ]),
    ).toBe(false)
    expect(
      hasIncompleteSourceColumns([
        {
          dataSourceType: 'complaint_ticket',
          ticketId: 'c-1',
          sourceColumns: {
            处理意见: 'a',
            问题原因: 'e',
            '优化举措/建议': 'f',
          },
        },
      ]),
    ).toBe(true)
  })

  it('getSourceColumnValue falls back', () => {
    expect(
      getSourceColumnValue({ handlingText: 'x' }, '处理意见'),
    ).toBe('x')
    expect(getSourceColumnValue({ customerTier: '金牌' }, CUSTOMER_TIER_SOURCE_COLUMN)).toBe('金牌')
  })

  it('does not use problemType as 终判 fallback for consultation tickets', () => {
    const consultation = {
      dataSourceType: 'consultation_ticket',
      problemType: '计费与账单',
      complaintCauseL1Final: '不应出现',
    }
    expect(getSourceColumnValue(consultation, '投诉原因 一级（终判）')).toBe('')
    expect(getSourceColumnValue(consultation, '投诉原因 二级（终判）')).toBe('')
    expect(getSourceColumnValue(consultation, '投诉原因 三级（终判）')).toBe('')
  })

  it('reads 终判 from complaintCause fields or snapshot, not problemType', () => {
    expect(
      getSourceColumnValue(
        { dataSourceType: 'complaint_ticket', problemType: '打标问题类型', complaintCauseL1Final: '终判一级' },
        '投诉原因 一级（终判）',
      ),
    ).toBe('终判一级')
    expect(
      getSourceColumnValue(
        { dataSourceType: 'complaint_ticket', problemType: '打标问题类型' },
        '投诉原因 一级（终判）',
      ),
    ).toBe('')
  })

  it('buildSourceColumns stores 移动云客户服务等级', () => {
    const cols = buildSourceColumns({ customerTierCol: '银牌' })
    expect(cols?.[CUSTOMER_TIER_SOURCE_COLUMN]).toBe('银牌')
  })
})
