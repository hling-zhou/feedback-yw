import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('TicketStoryView narrative hierarchy', () => {
  const source = fs.readFileSync(new URL('./TicketStoryView.jsx', import.meta.url), 'utf8')

  it('keeps the complete ticket decision story in order', () => {
    const headings = ['综合结论', '规模与体验现状', '趋势与变化', '问题发生位置', '原因与用户需求', '影响与证据', '行动与效果验证', '分析附录']
    const indexes = headings.map((heading) => source.indexOf(`title="${heading}"`))
    expect(indexes.every((index) => index >= 0)).toBe(true)
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
  })

  it('keeps complaint-only metrics conditional and consultation opportunities available', () => {
    expect(source).toContain("const complaint = scope.sourceType === 'complaint_ticket'")
    expect(source).toContain('客户体验类万投比趋势')
    expect(source).toContain('咨询优化机会')
    expect(source).toContain('投诉原因（终判）')
  })

  it('provides evidence, action and quality operations in the same tab', () => {
    expect(source).toContain('onOpenFeedback?.(row)')
    expect(source).toContain('创建举措')
    expect(source).toContain('下载异常工单')
  })
})
