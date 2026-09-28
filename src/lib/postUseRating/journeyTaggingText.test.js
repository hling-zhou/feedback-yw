import { describe, expect, it } from 'vitest'
import { buildPostUseJourneyTaggingText } from './journeyTaggingText.js'

describe('buildPostUseJourneyTaggingText', () => {
  it('keeps scene, page, survey, answers, low-score reason, then the free comment', () => {
    const text = buildPostUseJourneyTaggingText({
      scene: '资源创建后',
      touchpointPageName: '弹性公网IP控制台',
      surveyName: '用后即评',
      feedbackReasonTexts: ['功能有缺失', '无/不涉及', '缺乏操作指引'],
      lowScoreReason: '页面打开慢',
      commentText: '创建后找不到带宽入口',
      rawText: '创建后找不到带宽入口',
      customerQuote: '创建后找不到带宽入口',
    })
    expect(text).toBe(
      [
        '资源创建后',
        '弹性公网IP控制台',
        '用后即评',
        '功能有缺失',
        '缺乏操作指引',
        '页面打开慢',
        '创建后找不到带宽入口',
      ].join('\n'),
    )
  })

  it('drops placeholders and does not use ticket request or problem fields', () => {
    const text = buildPostUseJourneyTaggingText({
      scene: '无',
      originalScene: '未提供',
      touchpointPageName: '其他',
      surveyName: '',
      feedbackReasonTexts: ['无/不涉及', '/'],
      lowScoreReason: '其他',
      commentText: '无',
      rawText: '',
      requestScene: '开通',
      problemType: '费用',
      handlingText: '已处理',
    })
    expect(text).toBe('')
  })

  it('falls back to structured reason columns when the answer list is absent', () => {
    expect(
      buildPostUseJourneyTaggingText({
        scene: '业务使用完毕',
        feedbackReasonPrimary: '稳定性不足故障频发',
        commentText: '偶尔中断',
      }),
    ).toBe(['稳定性不足故障频发', '偶尔中断'].join('\n'))
  })
})
