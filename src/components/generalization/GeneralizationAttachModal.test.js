import { describe, expect, it } from 'vitest'

import {
  buildGeneralizationSummaryDraft,
  buildGeneralizationTitleDraft,
  generalizationKeywordsWarning,
} from './GeneralizationAttachModal.jsx'
import { GENERALIZATION_SUMMARY_MAX_LENGTH } from '../../domain/generalizationIssue.js'

/** @typedef {import('../../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * 测试字面量是 Partial——cast 绕过全量字段检查。
 * @param {Record<string, unknown>} v
 * @returns {FeedbackRecord}
 */
function asRecord(v) {
  return /** @type {FeedbackRecord} */ (/** @type {unknown} */ (v))
}

describe('buildGeneralizationTitleDraft（痛点首句截 30 字）', () => {
  it('取痛点首句', () => {
    expect(
      buildGeneralizationTitleDraft(
        asRecord({ painPoint: '批量删除安全组只成功一半。开发已修复事务问题。' }),
      ),
    ).toBe('批量删除安全组只成功一半')
  })

  it('超长截 30 字', () => {
    expect(buildGeneralizationTitleDraft(asRecord({ painPoint: '退'.repeat(50) }))).toHaveLength(30)
  })

  it('problemSummary 兜底', () => {
    expect(
      buildGeneralizationTitleDraft(asRecord({ problemSummary: '续费入口找不到' })),
    ).toBe('续费入口找不到')
  })

  it('空记录返回空串', () => {
    expect(buildGeneralizationTitleDraft(null)).toBe('')
  })
})

describe('buildGeneralizationSummaryDraft（场景+痛点，兜底链同留观口径）', () => {
  it('scene + painPoint', () => {
    expect(
      buildGeneralizationSummaryDraft(
        asRecord({ requestScene: '资源退订', painPoint: '控制台找不到退订入口' }),
      ),
    ).toBe('资源退订：控制台找不到退订入口')
  })

  it('无场景仅痛点', () => {
    expect(buildGeneralizationSummaryDraft(asRecord({ painPoint: '共享带宽无法取消' }))).toBe(
      '共享带宽无法取消',
    )
  })

  it('兜底客户请求节选', () => {
    const cr = '想退订共享带宽但找不到入口，麻烦处理一下，谢谢'
    expect(buildGeneralizationSummaryDraft(asRecord({ customerRequest: cr }))).toBe(cr.slice(0, 60))
  })

  it('最终兜底处理意见首句', () => {
    expect(
      buildGeneralizationSummaryDraft(
        asRecord({ handlingText: '经核实已引导客户完成退订。客户认可。' }),
      ),
    ).toBe('经核实已引导客户完成退订')
  })

  it('超长截 100 字', () => {
    expect(
      buildGeneralizationSummaryDraft(asRecord({ painPoint: '退'.repeat(200) })),
    ).toHaveLength(GENERALIZATION_SUMMARY_MAX_LENGTH)
  })
})

describe('generalizationKeywordsWarning（极短/极通用轻提示，不强制）', () => {
  it('单字关键词提示', () => {
    expect(generalizationKeywordsWarning(['退'])).toContain('过短')
  })

  it('极通用关键词提示', () => {
    expect(generalizationKeywordsWarning(['报错', '退订'])).toContain('通用')
  })

  it('正常关键词无提示', () => {
    expect(generalizationKeywordsWarning(['批量删除', '事务回滚'])).toBeNull()
  })

  it('空数组无提示', () => {
    expect(generalizationKeywordsWarning([])).toBeNull()
  })
})
