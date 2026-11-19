import { describe, expect, it } from 'vitest'
import { buildPostUseRatingRecord } from './buildRecords.js'
import { buildPostUseReportV2Model, reportV2QuoteCategory, validatePostUseReportV2 } from './reportV2Model.js'

const period = (kind) => kind === 'quarter'
  ? { startDate: '2026-07-01', endDate: '2026-09-30', label: '2026年Q3' }
  : { startDate: '2026-10-01', endDate: '2026-10-31', label: '2026年10月' }

function rating(id, month, score, reason, product = '弹性公网IP', channel = 'console') {
  return {
    id, dataSourceType: 'post_use_rating', importMonth: month, createdAt: `${month}-12`,
    product, productName: product, channel, ratingScore: score,
    feedbackReasonPrimary: reason, customerCode: `C-${id}`,
  }
}

describe('V2 report facts', () => {
  it('preserves the imported shared-bandwidth spec under the EIP product', () => {
    const record = buildPostUseRatingRecord({
      channel: 'console', productName: '共享带宽', score: 10,
      customerName: '', customerCode: '', answeredAt: '2026-10-12',
    }, {
      importMonth: '2026-10', importBatchId: 'batch',
      catalogProducts: [{ key: 'eip', name: '弹性公网IP', enabled: true, analysisPostUseRating: true, taxonomyKey: 'eip', acceptParentName: true, specs: [{ name: '共享带宽', match: ['共享带宽'] }] }],
    })
    expect(record).toMatchObject({ product: '弹性公网IP', productName: '弹性公网IP', sourceProductName: '共享带宽' })
  })

  it('calculates report scores from records and keeps 10-point options out of actions', () => {
    const records = [
      { ...rating('low', '2026-10', 8, '功能有缺失', '共享带宽'), sourceProductName: '共享带宽' },
      rating('ten', '2026-10', 10, '', '弹性公网IP'),
      rating('option', '2026-10', 10, '购买时参数/配置选择错误', '弹性公网IP', 'option'),
      rating('praise-option', '2026-10', 10, '满意', '弹性公网IP', 'option'),
      rating('low-option', '2026-10', 1, '功能有缺失', '弹性公网IP', 'option'),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      statusTrends: {
        combined: { data: [{ date: '2026-10', department: 9, company: 9, departmentRate: null }] },
        productScores: [
          { date: '2026-09', productName: '弹性公网IP', avgScore: 8.5, sampleSize: 4 },
          { date: '2026-09', productName: '共享带宽', avgScore: 10, sampleSize: 1 },
        ],
      },
    })
    expect(model.kpis).toMatchObject({ avg: 9, companyAvg: 9, totalSample: 2 })
    expect(model.products[0]).toMatchObject({ name: '弹性公网IP', sample: 2, avg: 9 })
    expect(model.quoteRegistry.find((row) => row.recordId === 'low')).toMatchObject({ productName: '弹性公网IP', sourceProductName: '共享带宽' })
    expect(model.products[0].distribution['10']).toBe(1)
    expect(model.products[0].trend.find((row) => row.month === '2026-09')).toEqual({ month: '2026-09', value: 8.8, sample: 5 })
    expect(model.satisfactionTrend.at(-1).value).toBeNull()
    expect(model.departmentTrend).toHaveLength(6)
    expect(model.companyTrend).toHaveLength(6)
    expect(model.satisfactionTrend).toHaveLength(6)
    expect(model.positiveCount).toBe(0)
    expect(reportV2QuoteCategory(model.quoteRegistry.find((row) => row.recordId === 'low-option'))).toBe('负反馈')
    const optionTheme = model.themes.find((row) => row.type === 'ten-option')
    expect(optionTheme).toBeTruthy()
    expect(model.actions.some((row) => row.id === optionTheme.key)).toBe(false)
    expect(validatePostUseReportV2(model).filter((error) => !error.includes('责任人'))).toEqual([])
  })

  it('shows an original spec from existing evidence for scored and option records', () => {
    const records = [
      { ...rating('spec-scored', '2026-10', 8, '功能有缺失'), evidence: { productName: '共享带宽' } },
      { ...rating('spec-option', '2026-10', 10, '购买时参数/配置选择错误', '弹性公网IP', 'option'), evidence: { productName: '共享带宽' } },
      rating('eip', '2026-10', 10, ''),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    expect(model.kpis).toMatchObject({ productCount: 1, totalSample: 2, avg: 9 })
    expect(model.products[0].sourceSpecRecords).toMatchObject([
      { sourceProductName: '共享带宽', countedInScore: true },
      { sourceProductName: '共享带宽', countedInScore: false },
    ])
    expect(model.quoteRegistry.find((row) => row.recordId === 'spec-scored'))
      .toMatchObject({ sourceProductName: '共享带宽', productName: '弹性公网IP' })
    expect(validatePostUseReportV2(model).filter((error) => !error.includes('责任人'))).toEqual([])
  })

  it('builds the appendix, previous visits, and follow-up count directly from records', () => {
    const records = [{ ...rating('low', '2026-10', 8, '功能有缺失'), customerName: '测试客户' }]
    const visits = [
      { id: 'previous', importMonth: '2026-09', customerName: '上期客户', productName: '弹性公网IP', visitResult: '需要优化', internalConclusion: '专项优化中' },
      { id: 'current', importMonth: '2026-10', customerName: '测试客户', customerCode: 'C-low', productName: '弹性公网IP', visitResult: '问题仍在' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records, visits,
    })
    expect(model.customers).toMatchObject([{ customerName: '测试客户', nonTenCount: 1, products: ['弹性公网IP'] }])
    expect(model.previousVisits).toMatchObject([{ id: 'previous', category: '专项优化' }])
    expect(model.recommendedFeedbackCount).toBe(1)
    expect(model.todoRows).toEqual([])
  })

  it('collects todo candidates only from open in-period traces, unevaluated visits, and new in-period post-use actions (11-18 口径)', () => {
    const records = [rating('nat-low', '2026-10', 1, '功能有缺失', 'NAT网关')]
    const traces = [
      { id: 't-open', importMonth: '2026-10', productName: 'NAT网关', status: '待处理', customerName: '彭红松', customerFeedback: 'API 不完善', assigneeName: '刘浩' },
      { id: 't-legacy-done', importMonth: '2026-10', productName: 'NAT网关', status: '已完成', customerName: '李四', customerFeedback: '旧枚举完成态须排除' },
      { id: 't-done', importMonth: '2026-10', productName: 'NAT网关', status: '已处理', customerName: '王五', customerFeedback: '新枚举完成态须排除' },
      { id: 't-old-month', importMonth: '2026-09', productName: 'NAT网关', status: '待处理', customerName: '赵六', customerFeedback: '上周期遗留不收' },
    ]
    const visits = [
      { id: 'v-pending', importMonth: '2026-10', productName: 'NAT网关', customerName: '钱七', visitResult: '客户表示不满' },
      { id: 'v-drafting', importMonth: '2026-10', productName: 'NAT网关', customerName: '孙八', visitResult: '已回访', internalEvaluationDetail: '评估中', evaluationSubmitted: false },
      { id: 'v-done', importMonth: '2026-10', productName: 'NAT网关', customerName: '周九', visitResult: '无实际不满', internalEvaluationDetail: '无需优改', evaluationSubmitted: true },
      { id: 'v-old', importMonth: '2026-08', productName: 'NAT网关', customerName: '吴十', visitResult: '上周期不收' },
    ]
    const actionItems = [
      { id: 'a-new-pending', source: 'post_use', status: 'pending_evaluation', firstProposedAt: '2026-10-15', productName: 'NAT网关', content: '核实批量导出诉求' },
      { id: 'a-new-progress', source: 'post_use', status: 'in_progress', firstProposedAt: '2026-10-16', productName: 'NAT网关', content: '推进排期' },
      { id: 'a-done', source: 'post_use', status: 'completed', firstProposedAt: '2026-10-17', productName: 'NAT网关', content: '已完成不收' },
      { id: 'a-old', source: 'post_use', status: 'in_progress', firstProposedAt: '2026-09-01', productName: 'NAT网关', content: '上周期提出不收' },
      { id: 'a-ticket', source: 'ticket', status: 'in_progress', firstProposedAt: '2026-10-18', productName: 'NAT网关', content: '非用后即评来源不收' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      visits, traces, actionItems,
    })
    expect(model.todoCandidateCounts).toEqual({ trace: 1, visit: 2, action: 2, mergedVisit: 0 })
    const ids = model.todoCandidates.map((row) => row.id)
    expect(ids).toEqual(['todo-trace:t-open', 'todo-visit:v-pending', 'todo-visit:v-drafting', 'todo-action:a-new-pending', 'todo-action:a-new-progress'])
    // 脱敏（11-18 拍板）：客户姓不进事实文本
    expect(model.todoCandidates[0].customerMaskedName).toBe('彭****松')
    expect(model.todoCandidates[0].fallbackContent).toContain('跟进产品部回溯闭环')
    expect(model.todoCandidates[1].fallbackContent).toContain('完成省代表回访评估')
    expect(model.todoCandidates[3].fallbackContent).toContain('推进举措落地')
  })

  it('merges a same-customer visit todo into its trace todo as one row (11-18 拍板)', () => {
    const records = [rating('nat-low', '2026-10', 1, '功能有缺失', 'NAT网关')]
    const traces = [{ id: 't1', importMonth: '2026-10', productName: 'NAT网关', status: '待处理', customerName: '彭红松', customerFeedback: 'API 不完善', assigneeName: '刘浩' }]
    const visits = [
      { id: 'v-merge', importMonth: '2026-10', productName: 'NAT网关', customerName: '彭红松', visitResult: '客户表示不满', assigneeName: '省代表张三' },
      { id: 'v-solo', importMonth: '2026-10', productName: 'NAT网关', customerName: '王五', visitResult: '无对应溯源的回访' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      visits, traces,
    })
    // 合并后：trace 行 1（含回访）+ 独立回访行 1；visit 计数只含未合并行
    expect(model.todoCandidateCounts).toEqual({ trace: 1, visit: 1, action: 0, mergedVisit: 1 })
    expect(model.todoCandidates.map((row) => row.id)).toEqual(['todo-trace:t1', 'todo-visit:v-solo'])
    const merged = model.todoCandidates[0]
    expect(merged.mergedVisit).toMatchObject({ id: 'todo-visit:v-merge', evaluationState: '待评估' })
    // owner 取溯源经办人优先，回访经办人兜底
    expect(merged.owner).toBe('刘浩')
    expect(merged.fallbackContent).toContain('跟进回溯闭环并完成回访评估')
    expect(merged.fallbackContent).toContain('省代表回访：客户表示不满')
    // 空客户键（无 code 无 name）不参与匹配，两行保持独立（11-18 修复验证）
    const model2 = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      visits: [{ importMonth: '2026-10', productName: 'NAT网关', visitResult: 'x' }],
      traces: [{ importMonth: '2026-10', productName: 'NAT网关', status: '待处理' }],
    })
    expect(model2.todoCandidates).toHaveLength(2)
    expect(model2.todoCandidates.every((row) => !row.id.includes('undefined'))).toBe(true)
    expect(model2.todoCandidateCounts.mergedVisit).toBe(0)
  })

  it('uses a uniquely matched customer visit for the focus action label and fact line', () => {
    const records = [rating('monitor-low', '2026-10', 1, '不支持批量导出', '云监控')]
    const visits = [{ id: 'visit-monitor', importMonth: '2026-10', productName: '云监控', customerCode: 'C-monitor-low', visitResult: '反馈还没改，很不满意' }]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records, visits,
    })
    expect(model.focus[0].actionType).toBe('回访跟进')
    expect(model.focus[0].title).toContain('客户回访明确不满')
    expect(model.focus[0].detail).toContain('同客户省代表回访')
  })

  it('labels a product-level route fault as repair while stating it is background evidence', () => {
    const records = [rating('nat-low', '2026-10', 1, '功能缺失/不完善', 'NAT网关')]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      traces: [{ id: 'trace-nat', importMonth: '2026-10', productName: 'NAT网关', recommendedReason: '订购第二个 NAT 网关后路由不通，待回访确认' }],
    })
    expect(model.focus[0].actionType).toBe('缺陷修复')
    expect(model.focus[0].detail).toContain('产品部溯源背景')
  })

  it('separates neutral remarks from the positive reply registered by the October prototype', () => {
    const records = [
      { ...rating('neutral', '2026-10', 10, ''), commentText: '退订' },
      { ...rating('thanks', '2026-10', 10, ''), commentText: '需订购其他服务，谢谢！' },
      { ...rating('unscored-neutral', '2026-10', null, '', '弹性公网IP', 'option'), commentText: '已开通新专线' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    expect(model.products[0].neutralCount).toBe(2)
    expect(model.positiveCount).toBe(1)
    expect(reportV2QuoteCategory(model.quoteRegistry[0])).toBe('中性备注')
    expect(reportV2QuoteCategory(model.quoteRegistry[1])).toBe('正反馈')
    expect(reportV2QuoteCategory(model.quoteRegistry.find((row) => row.recordId === 'unscored-neutral'))).toBe('中性备注')
    expect(reportV2QuoteCategory({ score: null, kind: 'quote', text: '使用完毕' })).toBe('中性备注')
    expect(model.themes).toEqual([])
  })

  it('counts one record only once per theme and marks a theme spanning a quarter', () => {
    const records = ['2026-07', '2026-08', '2026-09'].map((month, index) =>
      rating(`q-${index}`, month, 5, '功能有缺失'))
    const model = buildPostUseReportV2Model({
      reportKey: '2026-Q3', reportKind: 'quarter', reportPeriod: period('quarter'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const theme = model.themes.find((row) => row.theme === '功能有缺失')
    expect(theme).toMatchObject({ count: 3, lifecycle: '贯穿全季', priority: 'P0' })
    expect(Object.values(theme.monthCounts)).toEqual([1, 1, 1])
    expect(model.products[0].monthly.map((row) => row.sample)).toEqual([1, 1, 1])
    expect(model.departmentTrend).toHaveLength(6)
    expect(model.companyTrend).toHaveLength(6)
    expect(model.satisfactionTrend).toHaveLength(6)
    expect(model.products[0].trend).toHaveLength(14)
    expect(validatePostUseReportV2(model, Object.fromEntries(model.focus.map((row) => [row.id, { owner: '负责人' }])))).toEqual([])
  })

  // 11-18 部门低分原因汇总对齐原型：归并、组级 NEW、排序、产品计数契约
  // 11-18 晚信息密度改造：lowestQuotes 选录——console 渠道 occurrence 文本恒等于主题名，
  // 典型原话只取最低分记录的 commentText（客户自由原话列）；reason 标签成员无 commentText 时为空。
  it('picks the lowest-score representative quote for theme rows', () => {
    const records = [
      { ...rating('q-label', '2026-10', 1, '功能有缺失') },
      { ...rating('q-label-comment', '2026-10', 1, '无法绑定', 'NAT网关'), commentText: '绑定一直转圈失败' },
      { ...rating('q-low', '2026-10', 1, '', '云监控'), commentText: '不能批量退订非要移除共享带宽才可以批量五个退' },
      { ...rating('q-low2', '2026-10', 1, '', 'NAT网关'), commentText: '短原话' },
      { ...rating('q-mid', '2026-10', 5, '', '云监控'), commentText: '五分记录的原话不应入选' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const feature = model.themes.find((row) => row.theme === '功能有缺失')
    expect(feature.lowestQuotes).toEqual([])
    // 标签成员的最低分记录带 commentText → 典型原话取 commentText（标签本身无信息增量）
    const bindTheme = model.themes.find((row) => row.theme === '无法绑定')
    expect(bindTheme.lowestQuotes).toEqual(['绑定一直转圈失败'])
    const longQuote = model.themes.find((row) => row.theme === '不能批量退订非要移除共享带宽才可以批量五个退')
    expect(longQuote.lowestQuotes).toEqual(['不能批量退订非要移除共享带宽才可以批量五个退'])
    // 组行成员账本携带 quotes（部门表典型原话来源）；LLM 归类后原话并入组，典型原话仍可追溯
    const merged = model.reasons.find((row) => row.name === '功能缺失/不完善')
    const member = merged.memberThemes.find((m) => m.theme === '功能有缺失')
    expect(member.quotes).toEqual([])
  })

  it('merges alias reasons into one department row with member/period facts', () => {
    const records = [
      rating('eip-a', '2026-10', 1, '功能有缺失'),
      rating('eip-b', '2026-10', 1, '功能缺失/不完善'),
      rating('nat-a', '2026-10', 1, '功能有缺失', 'NAT网关'),
      rating('opt', '2026-10', 10, '购买时参数/配置选择错误', '弹性公网IP', 'option'),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const merged = model.reasons.find((row) => row.name === '功能缺失/不完善')
    expect(merged).toBeTruthy()
    expect(merged.count).toBe(3)
    expect(merged.previousCount).toBe(0)
    expect(merged.isNew).toBe(true)
    expect(merged.memberThemes.map((member) => member.theme)).toEqual(['功能有缺失', '功能缺失/不完善'])
    expect(merged.products).toEqual([{ name: '弹性公网IP', count: 2 }, { name: 'NAT网关', count: 1 }])
    const option = model.reasons.find((row) => row.type === 'ten-option')
    expect(option.name).toBe('10 分反馈选项类')
    // 11-18 晚：成员对象新增 quotes（典型原话）——断言锁定关键字段而非全对象
    expect(option.memberThemes).toEqual([expect.objectContaining({ theme: '购买时参数/配置选择错误', count: 1, lowestScore: 10 })])
    // 排序拍板：10 分选项殿后
    expect(model.reasons.at(-1).type).toBe('ten-option')
  })

  it('marks a department group NEW only when every member record is new (prototype 0→N semantics)', () => {
    const allRecords = [
      rating('old-a', '2026-09', 1, '功能有缺失'),
      rating('new-a', '2026-10', 1, '功能有缺失'),
      rating('new-b', '2026-10', 1, '功能缺失/不完善'),
    ]
    const records = allRecords.filter((row) => row.importMonth === '2026-10')
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords, allCompanyRecords: allRecords,
    })
    const merged = model.reasons.find((row) => row.name === '功能缺失/不完善')
    // 组内含上期已有记录（old-a）→ 组级不打 NEW（原型月报 EIP 功能缺失组同场景无 NEW）
    expect(merged.isNew).toBe(false)
    expect(merged.previousCount).toBe(1)
    expect(merged.count).toBe(2)
  })

  // 11-18 晚重新分类拍板：购买参数/配置选择错误 ← 配置规格；操作与帮助文档 ← 任务操作流程/界面布局/帮助类；安全类 ← 网络安全；功能缺失/不完善 ← 多线BGP
  // 11-19 L1/L2 体系改版：旧 7 组名 → 新 L1 名（购买参数/配置选择错误→购买与配置决策、
  // 操作与帮助文档→操作与帮助体验、安全类→安全与合规）；多线BGP 归功能缺失/不完善。
  it('maps the reclassified reason groups exactly as approved', () => {
    const records = [
      rating('cfg', '2026-10', 5, '配置规格不知道如何选择'),
      rating('bgp', '2026-10', 5, '多线BGP'),
      rating('sec', '2026-10', 5, '网络安全'),
      rating('flow', '2026-10', 5, '任务操作流程复杂'),
      rating('doc', '2026-10', 5, '内容/帮助说明不充分'),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const names = model.reasons.map((row) => row.name)
    expect(names).toContain('购买与配置决策')
    expect(names).toContain('安全与合规')
    expect(names).toContain('操作与帮助体验')
    const feature = model.reasons.find((row) => row.name === '功能缺失/不完善')
    expect(feature).toBeTruthy()
    expect(feature.memberThemes.map((member) => member.theme)).toContain('多线BGP')
    const ops = model.reasons.find((row) => row.name === '操作与帮助体验')
    expect(ops.memberThemes.map((member) => member.theme).sort()).toEqual(['任务操作流程复杂', '内容/帮助说明不充分'])
    expect(names).not.toContain('配置选择与帮助文档')
    expect(names).not.toContain('操作与安全类')
  })

  it('applies LLM theme group overrides from the overlay before regex fallback', () => {
    const records = [
      rating('vague-a', '2026-10', 1, '垃圾云电脑,不用就关机'),
      rating('vague-b', '2026-10', 1, '烂到极致，我要退款'),
    ]
    const base = { reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records }
    const plain = buildPostUseReportV2Model(base)
    // 无 overlay：未命中正则按原文自成一档（回退语义）
    expect(plain.reasons.map((row) => row.name)).toEqual(['垃圾云电脑,不用就关机', '烂到极致，我要退款'])
    const overridden = buildPostUseReportV2Model({
      ...base,
      overlay: { narratives: { themeGroupLabels: { '烂到极致，我要退款': '操作与帮助体验' } } },
    })
    const grouped = overridden.reasons.find((row) => row.name === '操作与帮助体验')
    expect(grouped.memberThemes.map((member) => member.theme)).toEqual(['烂到极致，我要退款'])
    expect(overridden.reasons.find((row) => row.name === '垃圾云电脑,不用就关机')).toBeTruthy()
    expect(overridden.themeGroupLabels).toEqual({ '烂到极致，我要退款': '操作与帮助体验' })
  })

  // 11-19 P1：focus 标题按生命周期分支措辞——数量+时点+低点影响三要素（原型洞察句式）
  it('writes focus titles with count, peak month, and quarter low-point impact', () => {
    const allRecords = [
      rating('q1', '2026-07', 1, '功能有缺失'),
      rating('q2', '2026-08', 1, '功能有缺失'),
      rating('q3', '2026-09', 1, '功能有缺失'),
      rating('q4', '2026-08', 2, '稳定性不足故障频发'),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-Q3', reportKind: 'quarter', reportPeriod: period('quarter'),
      records: allRecords, companyRecords: allRecords, allRecords, allCompanyRecords: allRecords,
    })
    const spanRow = model.focus.find((row) => row.theme === '功能有缺失')
    expect(spanRow.title).toContain('贯穿全季（3 条，最低 1 分），需根因治理')
    const singleRow = model.focus.find((row) => row.theme === '稳定性不足故障频发')
    expect(singleRow.title).toContain('本季新增 1 条（最低 2 分），8 月集中出现')
    // 低点拖累：低分记录拉低产品季内均分 → detail 附低点线索（低点月与爆发月可能不同月）
    const singleProduct = model.products.find((row) => row.name === singleRow.productName)
    const lowMonth = singleProduct?.monthly.filter((row) => row.value != null).sort((a, b) => a.value - b.value)[0]
    if (lowMonth && lowMonth.value < 9) {
      expect(singleRow.detail).toContain(`${Number(lowMonth.month.slice(5))} 月均分`)
      expect(singleRow.detail).toContain('为季内低点')
    }
  })

  it('computes department reason month distribution and lifecycle for the quarter', () => {
    const allRecords = [
      rating('q1', '2026-07', 1, '功能有缺失'),
      rating('q2', '2026-08', 1, '功能有缺失'),
      rating('q3', '2026-09', 1, '功能有缺失'),
      rating('m1', '2026-08', 1, '稳定性不足故障频发'),
      rating('m2', '2026-08', 3, '稳定性不足故障频发'),
      rating('c1', '2026-07', 5, '配置规格不知道如何选择'),
      rating('c2', '2026-08', 5, '配置规格不知道如何选择'),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-Q3', reportKind: 'quarter', reportPeriod: period('quarter'),
      records: allRecords, companyRecords: allRecords, allRecords, allCompanyRecords: allRecords,
    })
    const merged = model.reasons.find((row) => row.name === '功能缺失/不完善')
    expect(merged.monthCounts).toEqual({ '2026-07': 1, '2026-08': 1, '2026-09': 1 })
    expect(merged.lifecycle).toBe('贯穿全季')
    const burst = model.reasons.find((row) => row.name === '服务资源性能/稳定性不足')
    // [0,2,0] 判单月事件（8月），不误判已收敛（11-18 对照季报原型 MOP 行拍板）
    expect(burst.monthCounts).toEqual({ '2026-07': 0, '2026-08': 2, '2026-09': 0 })
    expect(burst.lifecycle).toBe('单月（8月）')
    const faded = model.reasons.find((row) => row.name === '购买与配置决策')
    // [1,1,0] 两个月出现末月消失 → 已收敛
    expect(faded.lifecycle).toBe('已收敛（末月无）')
  })

  // 11-19 两档剔除（用户拍板）：档 1 回访"无实际不满"五模块全不进；
  // 档 2 内部评估/溯源"无需优改"类进定量（部门低分原因汇总/主题分布）不进定性（关注项/核心结论素材）。
  it('excludes tier-1 no-dissatisfaction issues from all five modules', () => {
    const records = [
      rating('nd-1', '2026-10', 1, '功能有缺失'),
      rating('nd-2', '2026-10', 2, '页面打开慢', '云监控'),
    ]
    const visits = [
      { id: 'v-nd', importMonth: '2026-10', productName: '弹性公网IP', customerCode: 'C-nd-1', visitResult: '经省代表回访，客户无实际不满，系误操作' },
    ]
    // rating fixture 的 customerCode 是 'C-' + id；回访必须同客户码命中
    visits[0].customerCode = 'C-nd-1'
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records, visits,
    })
    // 档 1：弹性公网IP 的问题全剔除——themes/reasons/focus 全无
    expect(model.themes.filter((row) => row.productName === '弹性公网IP')).toHaveLength(0)
    expect(model.reasons.find((row) => row.memberThemes?.some((m) => m.theme === '功能有缺失'))).toBeUndefined()
    expect(model.focus.find((row) => row.theme === '功能有缺失')).toBeUndefined()
    // 云监控不受影响
    expect(model.themes.find((row) => row.productName === '云监控')).toBeTruthy()
  })

  it('keeps tier-2 no-action issues in quantitative stats but out of focus', () => {
    const records = [
      rating('na-1', '2026-10', 1, '功能有缺失'),
      rating('na-2', '2026-10', 1, '无法绑定', '云监控'),
    ]
    const visits = [
      { id: 'v-na', importMonth: '2026-10', productName: '弹性公网IP', customerCode: 'C-na-1',
        visitResult: '客户反馈功能缺失', internalConclusion: '无需优改（客户误操作/账户异常/极小概率场景）' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records, visits,
    })
    // 档 2：进定量——themes/reasons 仍在
    const theme = model.themes.find((row) => row.productName === '弹性公网IP' && row.theme === '功能有缺失')
    expect(theme).toBeTruthy()
    expect(theme.noAction).toBe(true)
    expect(model.reasons.find((row) => row.name === '功能缺失/不完善')).toBeTruthy()
    // 不进定性——focus 无该主题
    expect(model.focus.find((row) => row.theme === '功能有缺失')).toBeUndefined()
    // 未判定的云监控正常进定性
    expect(model.focus.find((row) => row.theme === '无法绑定')).toBeTruthy()
  })

  it('assigns an owner only when the trace is linked to that issue', () => {
    const records = [
      rating('missing-feature', '2026-10', 5, '功能有缺失'),
      rating('slow-page', '2026-10', 5, '页面打开慢'),
    ]
    const traces = [{
      id: 'trace-feature', productName: '弹性公网IP', importMonth: '2026-10',
      customerCode: 'C-missing-feature', customerFeedback: '功能有缺失',
      assigneeName: '经办甲', recommendedReason: '核查缺失能力',
    }]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      traces,
    })
    expect(model.actions.find((row) => row.theme === '功能有缺失')).toMatchObject({ owner: '经办甲', text: '核查缺失能力' })
    // 11-19 撤销兜底（用户拍板）：无溯源经办人回退"待指派"，由 v2Validation 阻断保存/导出/发邮件
    expect(model.actions.find((row) => row.theme === '页面打开慢')).toMatchObject({ owner: '待指派', text: '核查「页面打开慢」并明确处理结论' })
  })

  it('puts a dissatisfied customer first and keeps the focus across products', () => {
    const records = [
      rating('eip-a', '2026-10', 1, '功能有缺失'),
      rating('eip-b', '2026-10', 1, '功能有缺失'),
      rating('nat-a', '2026-10', 1, '功能有缺失', 'NAT网关'),
      rating('monitor-a', '2026-10', 1, '功能有缺失', '云监控'),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      visits: [{ productName: '云监控', importMonth: '2026-10', customerCode: 'C-monitor-a', visitResult: '客户表示还没改，挺不满意' }],
    })
    expect(model.focus.map((row) => row.productName)).toEqual(['云监控', '弹性公网IP', 'NAT网关'])
  })

  it('caps each product at five actions while retaining every focus action', () => {
    const reasons = [
      '功能有缺失', '稳定性不足故障频发', '页面打开慢', '界面布局不合理',
      '缺乏操作指引', '内容/帮助说明不易懂', '自助解决支撑不足',
    ]
    const records = reasons.map((reason, index) => rating(`action-${index}`, '2026-10', 5, reason))
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const actions = model.actions.filter((row) => row.productName === '弹性公网IP')
    expect(actions).toHaveLength(5)
    expect(actions.some((row) => row.mergedThemeCount > 1)).toBe(true)
    expect(model.focus.every((row) => actions.some((action) => action.id === row.id))).toBe(true)
    // 11-19 责任人未指定阻断：本用例关注 cap 逻辑，过滤新旧两版责任人提示后应无其他差异
    expect(validatePostUseReportV2(model).filter((error) => !error.includes('责任人'))).toEqual([])
  })

  // 11-19 拍板：责任人未指定（空/待指派）阻断保存/导出/发邮件——关注项与页面编辑中待办同判
  it('blocks on unassigned owners for focus actions and pending todo rows', () => {
    const records = [rating('own-1', '2026-10', 5, '功能有缺失')]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    // 关注项 owner=待指派（无溯源经办人）→ 阻断
    expect(validatePostUseReportV2(model)).toContain('弹性公网IP「功能有缺失」责任人未指定，请补齐经办人')
    // 补齐经办人后放行；页面编辑中待办 owner 空 → 阻断，补齐后放行
    const fixed = validatePostUseReportV2(model, { [model.focus[0].id]: { owner: '张三' } })
    expect(fixed.filter((error) => error.includes('责任人未指定'))).toEqual([])
    const todoPending = validatePostUseReportV2(model, { [model.focus[0].id]: { owner: '张三' } },
      [{ id: 'todo-1', productName: '云监控', content: '跟进回访评估', owner: '' }])
    expect(todoPending).toContain('待办「云监控」责任人未指定，请补齐经办人')
    expect(validatePostUseReportV2(model, { [model.focus[0].id]: { owner: '张三' } },
      [{ id: 'todo-1', productName: '云监控', content: '跟进回访评估', owner: '李四' }])
      .filter((error) => error.includes('责任人未指定'))).toEqual([])
  })
})
