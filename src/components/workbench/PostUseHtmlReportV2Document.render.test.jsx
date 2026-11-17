// @vitest-environment node
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildPostUseReportV2Model } from '../../lib/postUseRating/reportV2Model.js'
import { REPORT_V2_CSS } from '../../lib/postUseRating/reportV2Styles.js'
import PostUseHtmlReportV2Document from './PostUseHtmlReportV2Document.jsx'

function chartAfter(html, title) {
  const start = html.indexOf(title)
  const svgStart = html.indexOf('<svg', start)
  return html.slice(svgStart, html.indexOf('</svg>', svgStart) + 6)
}

function tableRowFor(html, title, label) {
  const tableStart = html.indexOf('<table', html.indexOf(title))
  const table = html.slice(tableStart, html.indexOf('</table>', tableStart) + 8)
  const rowStart = table.lastIndexOf('<tr', table.indexOf(label))
  return table.slice(rowStart, table.indexOf('</tr>', rowStart) + 5)
}

describe('V2 offline document', () => {
  it('prints every product and expands every detail section', () => {
    const records = [
      { id: 'eip', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: '弹性公网IP', productName: '弹性公网IP', evidence: { productName: '共享带宽' }, channel: 'console', ratingScore: 10 },
      { id: 'nat', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', productName: 'NAT网关', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month',
      reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll todoItems={[]} />)
    expect(html).toContain('data-product-panel-name="弹性公网IP"')
    expect(html).toContain('data-product-panel-name="NAT网关"')
    expect(html).not.toContain('来源规格：共享带宽')
    expect(html).toContain('附录 E：弹性公网 IP 中包含的共享带宽记录（1 条）')
    expect(html).toContain('1 条计入评分样本')
    expect(html).toContain('v2-mark-new')
    expect((html.match(/<details/g) || []).length).toBeGreaterThan(4)
    expect((html.match(/<details[^>]*open/g) || []).length).toBe((html.match(/<details/g) || []).length)
    expect(html).not.toContain('class="report-toc')
  })

  it('shows low scores without a theme as uncertain and retains visit evidence', () => {
    const records = [
      { id: 'small-low', dataSourceType: 'post_use_rating', importMonth: '2026-08', product: '弹性负载均衡', productName: '弹性负载均衡', channel: 'console', ratingScore: 4 },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-Q3', reportKind: 'quarter',
      reportPeriod: { startDate: '2026-07-01', endDate: '2026-09-30', label: '2026年Q3' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      visits: [{ id: 'small-visit', product: '弹性负载均衡', importMonth: '2026-08', visitResult: '客户已回访' }],
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll todoItems={[]} />)
    expect(html).toContain('样本不足，波动暂不下结论')
    expect(html).toContain('省代表回访：</b><span class="">客户已回访</span>')
    expect(html).not.toContain('✓ 无有效低分问题')
  })

  it('applies saved section visibility to the document and offline output', () => {
    const records = [{ id: 'rating', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', productName: 'NAT网关', channel: 'console', ratingScore: 10 }]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll hiddenSectionIds={['products', 'appendix']} />)
    expect(html).toContain('report-v2-overview')
    expect(html).not.toContain('id="report-v2-products"')
    expect(html).not.toContain('id="report-v2-appendix"')
    expect(html).toContain('id="report-v2-todo"')
  })

  it('uses the shared score axis domain and readable system chart text in both overview charts', () => {
    const records = [{ id: 'rating', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', productName: 'NAT网关', channel: 'console', ratingScore: 10 }]
    const base = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const model = {
      ...base,
      departmentTrend: [{ month: '2026-09', value: 9.4 }, { month: '2026-10', value: 9.6 }],
      companyTrend: [{ month: '2026-09', value: 8.8 }, { month: '2026-10', value: 9.1 }],
    }
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll />)
    const scoreChart = chartAfter(html, '部门与公司均分趋势')
    const rateChart = chartAfter(html, '投诉回访满意度（10 分满意度）')
    const axisTicks = [...scoreChart.matchAll(/<text[^>]*text-anchor="end"[^>]*>(\d+)<\/text>/g)].map((match) => match[1])
    expect(axisTicks).toEqual(['7', '8', '9', '10'])
    expect(scoreChart).toContain('viewBox="0 0 400 245"')
    expect(rateChart).toContain('viewBox="0 0 400 245"')
    expect(REPORT_V2_CSS).toMatch(/\.v2-svg-label \{ font-size:11px;/)
    expect(REPORT_V2_CSS).toMatch(/\.v2-chart-legend \{[^}]*font-size:12px;/)
    expect(REPORT_V2_CSS).toContain('grid-template-columns:repeat(2,minmax(426px,1fr))')
    expect(REPORT_V2_CSS).not.toMatch(/\.v2-chart-grid \{[^}]*grid-template-columns:1fr/)
    expect(REPORT_V2_CSS).toContain('.v2-chart-wrap--compact svg { width:400px; max-width:100%')
  })

  it('applies the documented row tones while keeping option rows neutral and blue', () => {
    const records = [{ id: 'rating', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', productName: 'NAT网关', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' }]
    const base = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const theme = (name, options = {}) => ({ key: name, theme: name, type: 'low', count: 1, segmentCount: 1,
      recordIds: ['rating'], customerKeys: ['customer'], lowestScore: 1, priority: 'P0', isNew: false,
      monthCounts: { '2026-10': 1 }, ...options })
    const themes = [
      theme('长期高风险'),
      theme('本期新增风险', { isNew: true }),
      theme('普通低分问题', { priority: 'P1' }),
      theme('十分反馈选项', { type: 'ten-option', lowestScore: 10, priority: 'P2', isNew: true }),
    ]
    const model = { ...base, products: [{ ...base.products[0], themes }], reasons: [
      { name: '长期低分原因', type: 'low', count: 1, lowestScore: 1, isNew: false, products: ['NAT网关'] },
      { name: '新增低分原因', type: 'low', count: 1, lowestScore: 1, isNew: true, products: ['NAT网关'] },
      { name: '十分选项原因', type: 'ten-option', count: 1, lowestScore: 10, isNew: true, products: ['NAT网关'] },
    ] }
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll />)
    expect(tableRowFor(html, '问题主题分布', '长期高风险')).toContain('class="v2-row-danger"')
    expect(tableRowFor(html, '问题主题分布', '本期新增风险')).toContain('class="v2-row-warning"')
    expect(tableRowFor(html, '问题主题分布', '普通低分问题')).not.toMatch(/v2-row-(danger|warning)/)
    expect(tableRowFor(html, '问题主题分布', '十分反馈选项')).toContain('class="v2-option-text"')
    expect(tableRowFor(html, '问题主题分布', '十分反馈选项')).not.toMatch(/v2-row-(danger|warning)/)
    expect(tableRowFor(html, '部门低分原因汇总', '长期低分原因')).toContain('class="v2-row-danger"')
    expect(tableRowFor(html, '部门低分原因汇总', '新增低分原因')).toContain('class="v2-row-warning"')
    expect(tableRowFor(html, '部门低分原因汇总', '十分选项原因')).toContain('class="v2-option-text"')
    expect(tableRowFor(html, '部门低分原因汇总', '十分选项原因')).not.toMatch(/v2-row-(danger|warning)/)
    expect(tableRowFor(html, '附录 A：整体得分表', 'NAT网关')).toContain('class="v2-row-danger"')
  })

  it('groups the EIP issue rows like the prototype and renders the documented columns', () => {
    const records = [
      { id: 'feature-a', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: '弹性公网IP', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' },
      { id: 'feature-b', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: '弹性公网IP', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能缺失/不完善' },
      { id: 'bandwidth', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: '弹性公网IP', channel: 'console', ratingScore: 1, commentText: '普通共享带宽不能升级成双栈带宽' },
      { id: 'help', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: '弹性公网IP', channel: 'console', ratingScore: 5, feedbackReasonPrimary: '内容/帮助说明不充分' },
      { id: 'option', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: '弹性公网IP', channel: 'option', ratingScore: 10, feedbackReasonPrimary: '购买时参数/配置选择错误' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll />)
    const tableStart = html.indexOf('<table', html.indexOf('问题主题分布'))
    const table = html.slice(tableStart, html.indexOf('</table>', tableStart))
    expect(table).toContain('<th>问题主题</th><th>条数</th><th>分布</th><th>最低分</th><th>优先级</th>')
    expect(table).toContain('功能缺失/不完善')
    expect(tableRowFor(html, '问题主题分布', '功能缺失/不完善')).toContain('<b>2</b>')
    expect(table).toContain('共享带宽能力限制')
    expect(table).toContain('配置选择与帮助文档')
  })

  it('shows only representative visit and trace conclusions in the product body', () => {
    const records = [{ id: 'low', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' }]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      visits: [
        { id: 'v1', importMonth: '2026-10', productName: 'NAT网关', visitResult: '问题仍未解决' },
        { id: 'v2', importMonth: '2026-10', productName: 'NAT网关', visitResult: '补充回访结论' },
      ],
      traces: [
        { id: 't1', importMonth: '2026-10', productName: 'NAT网关', recommendedReason: '已定位路由异常' },
        { id: 't2', importMonth: '2026-10', productName: 'NAT网关', recommendedReason: '补充溯源结论' },
      ],
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll />)
    const summaryStart = html.indexOf('v2-evidence-summary')
    const summary = html.slice(summaryStart, html.indexOf('</div>', summaryStart))
    expect(summary).toContain('问题仍未解决')
    expect(summary).toContain('已定位路由异常')
    expect(summary).toContain('其余 1 条见折叠明细')
    expect(summary).not.toContain('补充回访结论')
    expect(summary).not.toContain('补充溯源结论')
    expect(html).toContain('省代表回访记录（2 条）')
    expect(html).toContain('产品部溯源记录（2 条）')
  })
})
