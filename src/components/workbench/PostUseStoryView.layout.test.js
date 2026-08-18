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

  it('keeps callback recommendation download entry in customer evidence section', () => {
    expect(source).toContain('canUsePostUseCallbackList')
    expect(source).toContain('查看并处理建议回访/溯源清单')
    expect(source).toContain('const callbackDownloadDisabled = !callbackRecommendations.length && !callbackNonTenRecords.length')
    expect(source).toContain('disabled={callbackDownloadDisabled}')
    expect(source).toContain('当前范围内暂无命中“官网问卷类建议回访”或“投诉回访非10分”的记录')
    expect(source).toContain('dataSource={drivers.customers}')
    expect(source).toContain("title: '客户特征'")
    expect(source).toContain("title: '反馈原因'")
    expect(source).toContain('title="高频低分原因"')
    expect(source).toContain('当前范围内暂无命中 高频低分原因规则 的记录')
    expect(source).toContain("dataSource={drivers.highFrequencyLowScoreReasons || []}")
  })

  it('does not restore customer visit or satisfaction as a standalone top-level module', () => {
    expect(source).not.toMatch(/SectionHeading[^>]+title="客服部回访"/)
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

  it('shows internal experience KPIs plus the three-channel yunwang vs company pair', () => {
    expect(source).toContain('title="体验均分"')
    expect(source).toContain('title="体验样本"')
    expect(source).toContain('title="云网均分（三渠道）"')
    expect(source).toContain('title="云网样本量"')
    expect(source).toContain('title="公司均分（三渠道）"')
    expect(source).toContain('title="公司样本量"')
    expect(source).toContain('体验均分使用短信与控制台评价（云网 16 款）')
    expect(source).toContain('公司均分（三渠道）为当期全部产品、主子合并后的记录级平均')
  })
})
