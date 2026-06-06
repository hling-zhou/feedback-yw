import { describe, expect, it } from 'vitest'
import {
  aggregateComplaintCauseL1Insights,
  assignComplaintCauseFieldsForImport,
  countComplaintCauseL1,
  getComplaintCauseL1Display,
  getComplaintCauseFinalDisplay,
  isCustomerExperienceComplaint,
  isCustomerExperienceComplaintCauseL1,
} from './complaintCause.js'

describe('complaintCause', () => {
  it('reads L1 from structured field or sourceColumns', () => {
    expect(
      getComplaintCauseL1Display({
        dataSourceType: 'complaint_ticket',
        complaintCauseL1Final: '性能类',
      }),
    ).toBe('性能类')
    expect(
      getComplaintCauseL1Display({
        dataSourceType: 'complaint_ticket',
        sourceColumns: { '投诉原因 一级（终判）': '计费类' },
      }),
    ).toBe('未填写')
    expect(
      getComplaintCauseL1Display({
        dataSourceType: 'consultation_ticket',
        sourceColumns: { '投诉原因 一级（终判）': '计费类' },
      }),
    ).toBe('未填写')
  })

  it('joins final complaint cause levels on one line', () => {
    expect(
      getComplaintCauseFinalDisplay({
        dataSourceType: 'complaint_ticket',
        complaintCauseL1Final: '客户体验类投诉',
        complaintCauseL2Final: '客户其他问题',
        complaintCauseL3Final: '客户自身其他问题',
      }),
    ).toBe('客户体验类投诉 / 客户其他问题 / 客户自身其他问题')
    expect(
      getComplaintCauseFinalDisplay({
        dataSourceType: 'complaint_ticket',
        complaintCauseL1Final: '性能类',
      }),
    ).toBe('性能类')
    expect(
      getComplaintCauseFinalDisplay({
        dataSourceType: 'complaint_ticket',
      }),
    ).toBe('未填写')
  })

  it('assigns import fields for complaint tickets only', () => {
    expect(
      assignComplaintCauseFieldsForImport(
        { problemTypeL1FinalCol: ' 性能类 ' },
        'complaint_ticket',
      ).complaintCauseL1Final,
    ).toBe('性能类')
    expect(
      assignComplaintCauseFieldsForImport(
        { problemTypeL1FinalCol: '性能类' },
        'consultation_ticket',
      ).complaintCauseL1Final,
    ).toBeUndefined()
  })

  it('aggregates complaint cause distribution', () => {
    const items = [
      { id: '1', dataSourceType: 'complaint_ticket', complaintCauseL1Final: 'A', sentiment: 'negative' },
      { id: '2', dataSourceType: 'complaint_ticket', complaintCauseL1Final: 'A', sentiment: 'neutral' },
      { id: '3', dataSourceType: 'consultation_ticket', problemType: 'X' },
    ]
    expect(countComplaintCauseL1(items)).toEqual([
      { name: 'A', count: 2 },
    ])
    const agg = aggregateComplaintCauseL1Insights(items)
    expect(agg[0]).toMatchObject({ label: 'A', count: 2, negative: 1 })
  })

  it('detects customer experience complaint cause L1', () => {
    expect(isCustomerExperienceComplaintCauseL1('客户体验类')).toBe(true)
    expect(isCustomerExperienceComplaintCauseL1('客户体验类投诉')).toBe(true)
    expect(isCustomerExperienceComplaintCauseL1('性能类')).toBe(false)
    expect(
      isCustomerExperienceComplaint({
        dataSourceType: 'complaint_ticket',
        complaintCauseL1Final: '客户体验类',
      }),
    ).toBe(true)
    expect(
      isCustomerExperienceComplaint({
        dataSourceType: 'consultation_ticket',
        complaintCauseL1Final: '客户体验类',
      }),
    ).toBe(false)
  })
})
