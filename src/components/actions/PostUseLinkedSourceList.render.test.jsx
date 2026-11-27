import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostUseLinkedSourceList from './PostUseLinkedSourceList.jsx'

/**
 * 2026-11-27 需求：举措详情抽屉的关联反馈对用后即评举措恒空的断裂修复。
 * 喂真实形态 props（trace = normalizeJiraItem 产物字段名、visit = meta 原始记录字段名），
 * 断言溯源/回访分列 + 客户反馈 + 回溯结果 / 回访结果与内部评估均在渲染产物中。
 */
describe('PostUseLinkedSourceList rendering', () => {
  const trace = {
    id: 'trace-1',
    importMonth: '2026-11',
    customerName: '溯源客户A',
    productName: '云专线',
    customerFeedback: '7分以下分布：云专线*1分*1次；反馈原因：功能有缺失（1）',
    progress: '已定位为配额校验缺陷，3 月版本修复',
  }
  const visit = {
    id: 'visit-1',
    importMonth: '2026-11',
    customerName: '回访客户B',
    productName: '弹性公网IP',
    userFeedbackText: '客户反馈原文：批量导出缺入口',
    visitResult: '客户希望尽快支持批量导出',
    internalEvaluationDetail: '内部评估：确认产品缺失，已转需求',
  }

  it('renders trace rows with customer feedback and progress conclusion', () => {
    const html = renderToStaticMarkup(
      <PostUseLinkedSourceList traces={[trace]} visits={[]} />,
    )
    expect(html).toContain('共 1 条溯源、0 条回访')
    expect(html).toContain('产品部溯源')
    expect(html).toContain('溯源客户A')
    expect(html).toContain('【客户反馈】7分以下分布：云专线*1分*1次；反馈原因：功能有缺失（1）')
    expect(html).toContain('回溯结果：')
    expect(html).toContain('已定位为配额校验缺陷，3 月版本修复')
  })

  it('renders visit rows with feedback, visit result and internal evaluation', () => {
    const html = renderToStaticMarkup(
      <PostUseLinkedSourceList traces={[]} visits={[visit]} />,
    )
    expect(html).toContain('省代表回访')
    expect(html).toContain('回访客户B')
    expect(html).toContain('【客户反馈】客户反馈原文：批量导出缺入口')
    // 回访结果与内部评估拼接展示（不同文案用「；」连接）
    expect(html).toContain('回访结果/内部评估：')
    expect(html).toContain('客户希望尽快支持批量导出；内部评估：确认产品缺失，已转需求')
  })

  it('shows em dash when conclusion fields are empty', () => {
    const html = renderToStaticMarkup(
      <PostUseLinkedSourceList
        traces={[{ ...trace, progress: '' }]}
        visits={[{ ...visit, visitResult: '', internalEvaluationDetail: '', internalConclusion: '' }]}
      />,
    )
    // antd Typography.Text 嵌套：label 与值之间隔着 span 标签（>—< 形态），分开断言
    expect(html).toContain('回溯结果：')
    expect(html).toContain('>—<')
    expect(html).toContain('回访结果/内部评估：')
  })

  it('renders the empty state when no traces or visits', () => {
    const html = renderToStaticMarkup(<PostUseLinkedSourceList traces={[]} visits={[]} />)
    expect(html).toContain('暂无关联溯源或回访')
  })
})
