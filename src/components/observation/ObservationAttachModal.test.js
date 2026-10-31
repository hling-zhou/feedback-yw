import { describe, expect, it } from 'vitest'
import { buildObservationSummaryDraft } from './ObservationAttachModal.jsx'
import { OBSERVATION_SUMMARY_MAX_LENGTH } from '../../domain/observationIssue.js'

describe('buildObservationSummaryDraft', () => {
  it('ticket: scene + painPoint', () => {
    const draft = buildObservationSummaryDraft(
      { requestScene: '资源退订', painPoint: '控制台找不到退订入口' },
      'complaint_ticket',
    )
    expect(draft).toBe('资源退订：控制台找不到退订入口')
  })

  it('ticket: no scene falls to painPoint only', () => {
    const draft = buildObservationSummaryDraft(
      { painPoint: '共享带宽无法取消' },
      'consultation_ticket',
    )
    expect(draft).toBe('共享带宽无法取消')
  })

  it('ticket: no painPoint falls to customerRequest excerpt', () => {
    const draft = buildObservationSummaryDraft(
      { customerRequest: '想退订共享带宽但找不到入口，麻烦处理一下，谢谢' },
      'complaint_ticket',
    )
    expect(draft).toBe('想退订共享带宽但找不到入口，麻烦处理一下，谢谢'.slice(0, 60))
  })

  it('ticket: last resort takes first sentence of handlingText', () => {
    const draft = buildObservationSummaryDraft(
      { handlingText: '经核实已在控制台引导客户完成退订。客户表示认可。' },
      'complaint_ticket',
    )
    expect(draft).toBe('经核实已在控制台引导客户完成退订')
  })

  it('rating: reason label + excerpt', () => {
    const draft = buildObservationSummaryDraft(
      { lowScoreReason: '页面打开慢', commentText: '控制台转圈半天才出来' },
      'post_use_rating',
    )
    expect(draft).toBe('页面打开慢：控制台转圈半天才出来')
  })

  it('rating: reason 其他 uses excerpt only', () => {
    const draft = buildObservationSummaryDraft(
      { lowScoreReason: '其他', commentText: '想退退不了' },
      'post_use_rating',
    )
    expect(draft).toBe('想退退不了')
  })

  it('caps at 100 chars', () => {
    const draft = buildObservationSummaryDraft(
      { painPoint: '退'.repeat(200) },
      'complaint_ticket',
    )
    expect(draft.length).toBe(OBSERVATION_SUMMARY_MAX_LENGTH)
  })

  it('empty record yields empty draft', () => {
    expect(buildObservationSummaryDraft(null, 'complaint_ticket')).toBe('')
  })
})
