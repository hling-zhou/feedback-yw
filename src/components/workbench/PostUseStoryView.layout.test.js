import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PostUseStoryView narrative hierarchy', () => {
  const source = fs.readFileSync(new URL('./PostUseStoryView.jsx', import.meta.url), 'utf8')

  it('keeps the decision story in the required order', () => {
    const headings = [
      '综合结论',
      '体验现状',
      '趋势与变化',
      '原因与用户需求',
      '客户与证据',
      '行动',
      '效果验证',
      '分析附录',
    ]
    const indexes = headings.map((heading) => source.indexOf(`title="${heading}"`))
    expect(indexes.every((index) => index >= 0)).toBe(true)
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
  })

  it('does not restore customer visit or satisfaction as a standalone top-level module', () => {
    expect(source).not.toMatch(/SectionHeading[^>]+title="客服回访"/)
    expect(source).not.toMatch(/SectionHeading[^>]+title="投诉回访满意度"/)
  })

  it('uses unnumbered section headings for arbitrary time ranges', () => {
    expect(source).not.toContain('number="')
    expect(source).not.toContain('本期结论')
    expect(source).toContain("title: '上一对比周期'")
    expect(source).toContain("title: '当前范围'")
  })

  it('keeps only score distribution as an online detail panel', () => {
    expect(source).not.toContain("label: '整体得分情况'")
    expect(source).toContain("label: '得分分布详情'")
    expect(source).toContain('title="产品体验总览"')
    expect(source).not.toContain('title="月报口径产品得分表"')
    expect(source).not.toContain('title="非10分产品评分分布"')
  })
})
