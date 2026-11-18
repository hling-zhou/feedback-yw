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
    expect(REPORT_V2_CSS).not.toMatch(/v2-chart-wrap--compact svg \{[^}]*width:\d+px/)
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
      { name: '长期低分原因', type: 'low', count: 1, lowestScore: 1, isNew: false, previousCount: 1, products: [{ name: 'NAT网关', count: 1 }], memberThemes: [{ theme: '长期低分原因', count: 1 }], monthCounts: { '2026-10': 1 } },
      { name: '新增低分原因', type: 'low', count: 1, lowestScore: 7, isNew: true, previousCount: 0, products: [{ name: 'NAT网关', count: 1 }], memberThemes: [{ theme: '新增低分原因', count: 1 }], monthCounts: { '2026-10': 1 } },
      { name: '十分选项原因', type: 'ten-option', count: 1, lowestScore: 10, isNew: true, previousCount: 0, products: [{ name: 'NAT网关', count: 1 }], memberThemes: [{ theme: '十分选项原因', count: 1 }], monthCounts: { '2026-10': 1 } },
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

  it('aligns the department reason summary with the prototype (grouping, subtitle, products×N, footnote)', () => {
    // 2026.10 原型对照：功能缺失 3 + 功能缺失/不完善 1 → 归并一行；低分组行名带「类」后缀与成员括注
    const records = [
      { id: 'eip-a', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: '弹性公网IP', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' },
      { id: 'eip-b', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: '弹性公网IP', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能缺失/不完善' },
      { id: 'nat-a', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' },
      { id: 'eip-opt', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: '弹性公网IP', channel: 'option', ratingScore: 10, feedbackReasonPrimary: '购买时参数/配置选择错误' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll todoItems={[]} />)
    expect(html).toContain('部门低分原因汇总（按严重度排序）')
    const grouped = tableRowFor(html, '部门低分原因汇总', '功能缺失/不完善')
    expect(grouped).toContain('功能缺失/不完善类')
    expect(grouped).toContain('（功能有缺失、功能缺失/不完善）')
    expect(grouped).toContain('<b>3</b>')
    expect(grouped).toContain('弹性公网IP×2、NAT网关×1')
    expect(grouped).toContain('class="v2-row-danger"')
    const optionRow = tableRowFor(html, '部门低分原因汇总', '10 分反馈选项类')
    expect(optionRow).toContain('低风险')
    expect(optionRow).toContain('v2-option-text')
    expect(optionRow).toContain('（购买时参数/配置选择错误 1）')
    expect(html).toContain('不构成低分风险')
    expect(html).toContain('同记录多标签的产品已在分产品模块标注')
    expect(html).not.toContain('有效正反馈')
  })

  it('renders quarter-only reason columns: month distribution with peak highlight and lifecycle badge', () => {
    // 季报原型对照：月度分布 7月 0 / 8月 2 / 9月 0 → 单月事件（8月）黄底徽章；NEW 0→N 数字格式
    const records = [
      { id: 'q1', dataSourceType: 'post_use_rating', importMonth: '2026-08', product: '弹性公网IP', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' },
      { id: 'q2', dataSourceType: 'post_use_rating', importMonth: '2026-08', product: '弹性公网IP', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' },
      { id: 'q3', dataSourceType: 'post_use_rating', importMonth: '2026-09', product: '云监控', channel: 'console', ratingScore: 3, feedbackReasonPrimary: '稳定性不足故障频发' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-Q3', reportKind: 'quarter', reportPeriod: { startDate: '2026-07-01', endDate: '2026-09-30', label: '2026年Q3' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll todoItems={[]} />)
    expect(html).toContain('部门低分原因汇总（按严重度 + 季度生命周期排序）')
    const grouped = tableRowFor(html, '部门低分原因汇总', '功能缺失/不完善')
    expect(grouped).toContain('v2-tag v2-tag--warning">NEW 0→2</span>')
    expect(grouped).toContain('7月 0 /')
    expect(grouped).toContain('8月 2 /')
    expect(grouped).toContain('9月 0')
    expect(grouped).toContain('单月（8月）')
    expect(grouped).toContain('v2-tag--lc-single')
    const stableRow = tableRowFor(html, '部门低分原因汇总', '稳定性不足故障频发')
    expect(stableRow).toContain('NEW 0→1')
    expect(stableRow).toContain('v2-tag--lc-single')
    expect(html).toContain('生命周期判定：贯穿全季=3 个月均出现（根因治理）')
    expect(html).not.toContain('有效正反馈')
  })

  it('keeps monthly NEW badge plain and sorts the ten-option row last', () => {
    const records = [
      { id: 'm1', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '稳定性不足故障频发' },
      { id: 'm2', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', channel: 'option', ratingScore: 10, feedbackReasonPrimary: '购买时参数/配置选择错误' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll todoItems={[]} />)
    const tableStart = html.indexOf('<table', html.indexOf('部门低分原因汇总'))
    const table = html.slice(tableStart, html.indexOf('</table>', tableStart))
    const optionIndex = table.indexOf('10 分反馈选项类')
    const lowIndex = table.indexOf('稳定性不足故障频发')
    expect(optionIndex).toBeGreaterThan(lowIndex)
    expect(table).toContain('NEW</span>')
    expect(table).not.toContain('NEW 0→')
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
    expect(table).toContain('操作与帮助文档')
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

  it('renders the 11-18 todo module: no progress column, two-source caption, and platform links', () => {
    const records = [{ id: 'rating', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' }]
    const traces = [{ id: 't-open', importMonth: '2026-10', productName: 'NAT网关', status: '待处理', customerName: '彭红松', customerFeedback: 'API 不完善', assigneeName: '刘浩' }]
    const visits = [{ id: 'v-pending', importMonth: '2026-10', productName: 'NAT网关', customerName: '王五', visitResult: '客户表示不满' }]
    const actionItems = [{ id: 'a-new', source: 'post_use', status: 'pending_evaluation', firstProposedAt: '2026-10-15', productName: 'NAT网关', content: '核实批量导出诉求' }]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records, visits, traces, actionItems,
    })
    const todoItems = model.todoCandidates.map((candidate) => ({
      id: candidate.id, productName: candidate.productName, content: candidate.fallbackContent,
      owner: candidate.owner, team: candidate.team, status: candidate.status, source: 'auto',
    }))
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll todoItems={todoItems} />)
    // 4 列、无进展列（11-18 需求 2）
    expect(html).toContain('<th>序号</th><th>事项</th><th>责任人</th><th>班组</th>')
    expect(html).not.toContain('<th>进展</th>')
    // 新口径说明（11-18 需求 1 的呈现）
    expect(html).toContain('口径说明：本月待办来自两部分——反馈库中本周期产品部溯源未完结 1 条、省代表回访未评估 1 条；问题与举措中用后即评 tab 本周期首次提出的待办 1 条')
    // 平台链接行（11-18 需求 3）
    expect(html).toContain('历史待办及进展 详见 用户反馈分析平台')
    expect(html).toContain('href="http://10.64.3.250:81/feedbacks?source=post_use_rating&amp;lane=post_use&amp;view=trace"')
    expect(html).toContain('href="http://10.64.3.250:81/actions?tab=product"')
    // 待办行带【产品名】前缀 + 脱敏客户
    expect(html).toContain('<b>【NAT网关】</b>跟进产品部回溯闭环')
    expect(html).toContain('彭****松')
  })

  it('applies the 11-18 display masking policy: customer names plain, personal names and phones masked', () => {
    // 11-18 用户口径：客户名（企业/机构/账号）明文；客户姓名（聚类标记）、省代表/内部员工姓名、电话号码脱敏；LLM 输入侧另行保持。
    const records = [{ id: 'rating', dataSourceType: 'post_use_rating', importMonth: '2026-09', product: 'NAT网关', productName: 'NAT网关', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' }]
    const visits = [{
      id: 'prev-visit', importMonth: '2026-09', productName: 'NAT网关',
      customerName: '2000546349-（聚类客户）周英雯',
      visitResult: '已回访客户 13812345678，问题已解释',
      internalConclusion: '客户 13987654321 表示认可方案',
    }]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records, visits,
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll todoItems={[]} />)
    // 上期回访表：企业客户名明文、聚类人名脱敏、正文手机号打码
    const visitRow = tableRowFor(html, '上期省代表回访结果补充', '2000546349')
    expect(visitRow).toContain('2000546349-（聚类客户）周****雯')
    expect(visitRow).not.toContain('周英雯')
    expect(visitRow).toContain('138****5678')
    expect(visitRow).not.toContain('13812345678')
    expect(visitRow).toContain('139****4321')
    expect(visitRow).not.toContain('13987654321')
  })

  it('masks internal trace assignee names in evidence blocks', () => {
    // 省代表/内部员工姓名脱敏：产品部溯源经办人两处展示（摘要括注 + 折叠明细行首）
    const records = [{ id: 'low', dataSourceType: 'post_use_rating', importMonth: '2026-10', product: 'NAT网关', channel: 'console', ratingScore: 1, feedbackReasonPrimary: '功能有缺失' }]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: { startDate: '2026-10-01', endDate: '2026-10-31' },
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      traces: [{ id: 't1', importMonth: '2026-10', productName: 'NAT网关', assigneeName: '刘浩', recommendedReason: '已定位路由异常' }],
    })
    const html = renderToStaticMarkup(<PostUseHtmlReportV2Document model={model} printAll />)
    expect(html).toContain('产品部溯源（刘****）：')
    expect(html).not.toContain('（刘浩）')
    expect(html).toContain('产品部溯源记录（1 条）')
  })
})
