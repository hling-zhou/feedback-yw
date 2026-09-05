import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('TopicBriefView layout', () => {
  const src = readFileSync(
    resolve(import.meta.dirname, 'TopicBriefView.jsx'),
    'utf8',
  )

  function marker(label) {
    const index = src.indexOf(label)
    expect(index, `missing marker: ${label}`).toBeGreaterThan(-1)
    return index
  }

  it('reads as conclusion, sticky toc, question-named chapters, then appendix', () => {
    const board = marker('PRIORITY_STYLES[urgency.level]')
    const sourceMix = marker('data-testid="source-mix"')
    const whatLink = marker('发生了什么 ·')
    const whyLink = marker('为何发生 ·')
    const nav = marker('aria-label="报告章节"')
    const sticky = marker('page-sticky-chrome')
    const quantitative = marker('title="规模与结构"')
    const qualitative = marker('title="发生了什么"')
    const why = marker('title="为什么发生（假设）"')
    const recs = marker('title="建议"')
    const appendix = marker('依据与口径')
    const library = marker('在反馈库查看全部')
    marker('各维度明细')
    marker('交叉核对')
    marker('依据 {sourceIds.length} 条')
    marker('quote-list')
    marker('ensureTopicAnalysis')

    expect(board).toBeLessThan(sourceMix)
    expect(sourceMix).toBeLessThan(whatLink)
    expect(whatLink).toBeLessThan(whyLink)
    expect(whyLink).toBeLessThan(nav)
    expect(nav).toBeLessThan(sticky)
    expect(sticky).toBeLessThan(quantitative)
    expect(quantitative).toBeLessThan(qualitative)
    expect(qualitative).toBeLessThan(why)
    expect(why).toBeLessThan(recs)
    expect(recs).toBeLessThan(appendix)
    expect(appendix).toBeLessThan(library)
    expect(src).toMatch(/className="quote-list"/)
    expect(src).not.toContain('InsightCard')
    expect(src.match(/用户原话/g)?.length || 0).toBe(1)
  })
})
