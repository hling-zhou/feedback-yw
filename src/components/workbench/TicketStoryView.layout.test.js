import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('TicketStoryView narrative hierarchy', () => {
  const source = fs.readFileSync(new URL('./TicketStoryView.jsx', import.meta.url), 'utf8')

  it('keeps the complete ticket decision story in order', () => {
    const headings = ['综合结论', '规模与体验现状', '趋势与变化', '问题发生位置', '原因与用户需求', '影响与证据', '行动与效果验证', '分析附录']
    const indexes = headings.map((heading) => source.indexOf(heading))
    expect(indexes.every((index) => index >= 0)).toBe(true)
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
  })

  it('keeps complaint-only metrics conditional and consultation opportunities available', () => {
    expect(source).toContain("const complaint = scope.sourceType === 'complaint_ticket'")
    expect(source).toContain('客户体验类万投比趋势')
    expect(source).toContain('客户体验类万投比')
    expect(source).toContain('环比')
    expect(source).toContain('在反馈库查看')
    expect(source).toContain('formatClusterEvidenceLinkLabel')
    expect(source).toContain('高风险抽样')
    expect(source).toContain('复制工单号')
    expect(source).toContain('展开全部')
    expect(source).toContain('咨询优化机会')
    expect(source).toContain('负担与机会现状')
    expect(source).toContain('主机会类型')
    expect(source).toContain('规模')
    expect(source).toContain('体验质量')
    expect(source).toContain('风险与闭环')
    expect(source).toContain('无回访')
    expect(source).toContain('TicketJourneyMap')
    expect(source).toContain('getEffectiveRootCauseReview')
    expect(source).not.toContain('全部反馈')
    expect(source).not.toContain('投诉原因（终判）')
    expect(source).not.toContain('客户体验类投诉')
    expect(source).not.toContain('高频主题')
    expect(source).not.toContain("title: '解决方案'")
    expect(source).not.toContain('请求场景 → 用户旅程 → 问题类型')
    expect(source).not.toContain('title="问题变化"')
    expect(source).not.toContain("title: '根因', dataIndex: 'rootCause'")
  })

  it('provides evidence, action and quality operations in the same tab', () => {
    expect(source).toContain('onOpenFeedback?.(row)')
    expect(source).toContain('创建举措')
    expect(source).toContain('下载异常工单')
  })
})
