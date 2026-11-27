import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostUseProblemFaces from './PostUseProblemFaces.jsx'
import { buildPostUseActionProblemScope } from '../../domain/postUseActionProblemScope.js'

/**
 * 渲染测试走完整构建函数（04 §2：守卫锚定在链路层）——喂 buildPostUseActionProblemScope
 * 产出而非手写 face fixture，防"测试与实现共享同一错误假设"。
 */
describe('PostUseProblemFaces rendering', () => {
  const scope = buildPostUseActionProblemScope(
    /** @type {any} */ ({ id: 'a1', source: 'post_use', status: 'in_progress', scheduleAt: '2026-03-01', completedAt: '' }),
    {
      traces: [
        { productName: '云专线', importMonth: '2026-01', customerFeedback: '溯源反馈原文', sourceType: 'questionnaire', status: '处理中' },
        { productName: '云专线', importMonth: '2026-09、2026-10', customerFeedback: '跨月溯源', sourceType: 'callback_non_ten', status: '已处理' },
      ],
      visits: [
        { productName: '弹性公网IP', importMonth: '2026-02', userFeedbackText: '回访反馈原文', evaluationSubmitted: true },
      ],
    },
  )

  it('renders source tags, counts, status and month range per face', () => {
    const html = renderToStaticMarkup(<PostUseProblemFaces problems={scope.problems} />)
    expect(html).toContain('产品部溯源')
    expect(html).toContain('省代表回访')
    expect(html).toContain('2 条')
    expect(html).toContain('1 条')
    expect(html).toContain('已评估') // 回访评估状态 Tag（拍板展示）
    expect(html).toContain('溯源反馈原文') // 最长反馈样例（6 字 > 跨月溯源 4 字，最长判据）
    expect(html).toContain('2026-01 ~ 2026-10') // 跨月区间（多月份拆分后的首末月）
  })

  it('renders nothing for empty problems', () => {
    const html = renderToStaticMarkup(<PostUseProblemFaces problems={[]} />)
    expect(html).toBe('')
  })
})
