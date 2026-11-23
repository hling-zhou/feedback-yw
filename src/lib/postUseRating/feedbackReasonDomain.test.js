import { describe, expect, it } from 'vitest'
import { getFeedbackReasonValues, recordHasNegativeFeedback } from './callbackRecommendations.js'

/**
 * 11-23 需求一步骤 1 守卫：getFeedbackReasonValues 列位语义分域（forDisplay 过滤）。
 * 真库实证形态（记录 74dd874d）：feedbackReasonTexts 三槽 = [选项串, 占位词, 自由文本]，
 * commentText = 末位自由文本列（槽 3 复读）——展示域必须剔复读与占位词，判负域保持全量。
 */
const realShapedRecord = {
  id: 'r1',
  feedbackReasonTexts: [
    '配置规格不知如何选择;找不到想要的信息',
    '无/不涉及',
    '远程登录的时候，密码一直输入不了。',
  ],
  commentText: '远程登录的时候，密码一直输入不了。',
}

const optionOnlyRecord = {
  id: 'r2',
  feedbackReasonTexts: ['功能有缺失', '无/不涉及'],
  // 客户只填了选项列：comment 回退取选项列（导入链回退设计）——commentText 复读选项
  commentText: '功能有缺失',
}

describe('getFeedbackReasonValues 列位语义分域（11-23 需求一）', () => {
  it('forDisplay 剔除 commentText 复读片段与占位词，reason 段只含选项', () => {
    const display = getFeedbackReasonValues(realShapedRecord, { forDisplay: true })
    expect(display).toEqual(['配置规格不知如何选择;找不到想要的信息'])
    // 复读的自由文本不再进 reason 段（它属于【原话】域）
    expect(display.some((text) => text.includes('远程登录'))).toBe(false)
    // 占位词整值被剔除
    expect(display.some((text) => text === '无/不涉及')).toBe(false)
  })

  it('默认模式（判负等场景）保持全量候选——语义零改动', () => {
    const all = getFeedbackReasonValues(realShapedRecord)
    expect(all).toEqual([
      '配置规格不知如何选择;找不到想要的信息',
      '无/不涉及',
      '远程登录的时候，密码一直输入不了。',
    ])
    // 判负链不受影响：自由文本片段含实质负面（isSubstantiveFeedbackReason 拆片判定）
    expect(recordHasNegativeFeedback(realShapedRecord)).toBe(true)
  })

  it('commentText 复读选项的病态回退记录：forDisplay 后 reason 段保留选项本身', () => {
    // 导入链回退：末位列空 → commentText 取了选项列。展示域过滤只剔「与 commentText 相等」
    // 的整值——选项串保留（它仍在选项列位），【原话】段由拼装层防冒充闸负责不标。
    const display = getFeedbackReasonValues(optionOnlyRecord, { forDisplay: true })
    expect(display).toEqual(['功能有缺失'])
  })

  it('reasons 全空时回退 commentText 的既有行为不变（两模式一致）', () => {
    const noReason = { id: 'r3', commentText: '单独的原话' }
    expect(getFeedbackReasonValues(noReason)).toEqual(['单独的原话'])
    expect(getFeedbackReasonValues(noReason, { forDisplay: true })).toEqual(['单独的原话'])
  })
})

import { buildPostUseCallbackRecommendations } from './callbackRecommendations.js'
import { buildQuestionnaireFollowupFeedback } from './callbackFollowupTables.js'

describe('需求一步骤 2：【原话】段拼装 + 防冒充闸（真链路驱动）', () => {
  const baseRecord = {
    dataSourceType: 'post_use_rating', importMonth: '2026-08', channel: 'console', ratingScore: 1,
    productName: '弹性公网IP', customerName: '测试客户', customerCode: 'C1',
    surveyName: '订购/开通页右侧悬浮组件_2601',
  }

  it('自由文本原话存在：【原话】段拼接（步骤 1+2 链路——reason 段只剩选项）', () => {
    const [item] = buildPostUseCallbackRecommendations([{
      ...baseRecord, id: 'q1',
      feedbackReasonTexts: ['配置规格不知如何选择;找不到想要的信息', '无/不涉及', '远程登录的时候，密码一直输入不了。'],
      commentText: '远程登录的时候，密码一直输入不了。',
    }])
    const line = buildQuestionnaireFollowupFeedback(item)
    expect(line).toContain('反馈原因：配置规格不知如何选择;找不到想要的信息（1）')
    expect(line).toContain('【原话】远程登录的时候，密码一直输入不了。（1）')
    expect(line).not.toContain('反馈原因：远程登录')
    expect(line).not.toContain('反馈原因：无/不涉及')
  })

  it('病态回退（commentText 复读选项）：防冒充闸生效——不标【原话】', () => {
    const [item] = buildPostUseCallbackRecommendations([{
      ...baseRecord, id: 'q2',
      feedbackReasonTexts: ['功能有缺失', '无/不涉及'],
      commentText: '功能有缺失',
    }])
    const line = buildQuestionnaireFollowupFeedback(item)
    expect(line).toContain('反馈原因：功能有缺失（1）')
    expect(line).not.toContain('【原话】')
  })
})
