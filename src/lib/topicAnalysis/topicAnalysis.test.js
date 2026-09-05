import { describe, expect, it } from 'vitest'
import { Document, Packer, Paragraph } from 'docx'
import * as XLSX from 'xlsx'
import { recommendTopics, topicFromUserQuery } from './recommendTopics.js'
import { collectTopicEvidence, recordMatchesTopic } from './collectEvidence.js'
import { buildTopicBrief } from './buildBrief.js'
import { buildTopicDecision } from './buildDecision.js'
import { applySemanticSplitResult } from './llmQualify.js'
import { buildTopicMarkdown } from './markdown.js'
import { parseTopicSupplementFile } from './parseSupplement.js'
import { extractCustomerIdentity, matchCustomerIdentity } from './customerIdentity.js'
import {
  buildRollingMonthPeriod,
  loadRecordsForTopicPeriod,
  snapshotPeriod,
  periodFromSnapshot,
} from './period.js'
import {
  createTopicReport,
  findReportByRecommendationId,
  loadTopicReports,
  saveTopicReport,
} from './store.js'
import { META_KEY_TOPIC_ANALYSIS_REPORTS, META_KEY_TOPIC_ANALYSIS_RUNS } from './constants.js'

function ticket(overrides = {}) {
  return {
    id: 'r1',
    ticketId: 'T-1',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网IP',
    problemType: '带宽限速',
    painPoint: '带宽经常被限速',
    rawText: '客户反馈弹性公网IP带宽限速',
    sourceColumns: {
      集团名称: '甲公司',
      集团客户编码: 'C001',
    },
    ...overrides,
  }
}

describe('topicAnalysis', () => {
  it('matches customer by code first', () => {
    const identity = extractCustomerIdentity(ticket())
    expect(identity.customerCode).toBe('C001')
    expect(matchCustomerIdentity(identity, { customerCode: 'C001', customerName: '其他' })).toBe('code')
    expect(matchCustomerIdentity(identity, { customerName: '甲公司' })).toBe('name')
    expect(matchCustomerIdentity(identity, { customerName: '甲' })).toBe(null)
    expect(matchCustomerIdentity({ customerName: '甲公司科技' }, { customerName: '甲公司' })).toBe(null)
    expect(recordMatchesTopic(
      ticket({ customerName: '甲公司科技', customerCode: '', sourceColumns: { 集团名称: '甲公司科技' } }),
      { type: 'customer', customerName: '甲公司', query: '甲公司' },
    )).toBe(false)
    expect(recordMatchesTopic(ticket(), { type: 'customer', customerName: '甲公司', query: '甲公司' })).toBe(true)
  })

  it('recommends product, customer and common topics from records', () => {
    const cards = recommendTopics({
      periodLabel: '近9个月',
      toMonth: '2026-08',
      records: [
        ticket(),
        ticket({ id: 'r2', ticketId: 'T-2', product: '云主机', sentiment: 'negative' }),
        ticket({ id: 'r3', ticketId: 'T-3', product: '云主机', problemType: '带宽限速' }),
        ticket({ id: 'r4', ticketId: 'T-4', product: '弹性公网IP', ratingScore: 5, dataSourceType: 'post_use_rating', customerName: '甲公司', customerCode: 'C001' }),
      ],
    })
    expect(cards.some((card) => card.type === 'common_issue')).toBe(true)
    expect(cards.some((card) => card.type === 'customer')).toBe(true)
    expect(cards.some((card) => card.title.includes('弹性公网IP'))).toBe(true)
    expect(cards.find((card) => card.type === 'customer')?.intro).toContain('近9个月')
    expect(cards.find((card) => card.type === 'customer')?.evidenceQuotes?.length).toBeGreaterThan(0)
    expect(cards.find((card) => card.type === 'common_issue')?.whyNow).toMatch(/跨/)
    expect(cards.find((card) => card.title.includes('弹性公网IP'))?.scenarios).toContain('cross_source')
  })

  it('excludes 10-score post-use without negative feedback from recommendations', () => {
    const cards = recommendTopics({
      periodLabel: '近9个月',
      toMonth: '2026-08',
      records: [
        ticket({ id: 't1', importMonth: '2026-07' }),
        ticket({
          id: 'praise',
          ticketId: 'P-10',
          dataSourceType: 'post_use_rating',
          ratingScore: 10,
          commentText: '用着很稳定',
          customerName: '甲公司',
          customerCode: 'C001',
          importMonth: '2026-07',
        }),
        ticket({
          id: 'ten-negative',
          ticketId: 'P-10n',
          dataSourceType: 'post_use_rating',
          ratingScore: 10,
          channel: 'console',
          feedbackReasonTexts: ['功能有缺失'],
          customerName: '甲公司',
          customerCode: 'C001',
          importMonth: '2026-07',
        }),
      ],
    })
    const customer = cards.find((card) => card.type === 'customer')
    expect(customer?.sampleSize).toBe(2)
    expect(customer?.evidenceQuotes?.some((quote) => quote.text?.includes('用着很稳定'))).toBeFalsy()
  })

  it('builds a rolling 9-month period without touching global periods', () => {
    const period = buildRollingMonthPeriod(undefined, new Date('2026-08-14T00:00:00'))
    const snap = snapshotPeriod(period)
    expect(snap.fromMonth).toBe('2025-12')
    expect(snap.toMonth).toBe('2026-08')
    expect(period.label).toContain('2025年')
    expect(periodFromSnapshot(snap).customFromMonth).toBe('2025-12')
  })

  it('builds a rolling 6-month period when monthCount is explicit', () => {
    const period = buildRollingMonthPeriod(6, new Date('2026-08-14T00:00:00'))
    const snap = snapshotPeriod(period)
    expect(snap.fromMonth).toBe('2026-03')
    expect(snap.toMonth).toBe('2026-08')
    expect(period.label).toContain('2026年')
    expect(periodFromSnapshot(snap).customFromMonth).toBe('2026-03')
  })

  it('persists reports and dedupes adopted recommendations', async () => {
    const meta = new Map()
    const adapter = {
      getMeta: async (key) => meta.get(key),
      putMeta: async (key, value) => { meta.set(key, value) },
    }
    const report = createTopicReport({
      title: '客户 · 甲公司',
      origin: 'recommended',
      sourceRecommendationId: 'customer:code:c001',
      status: 'generating',
    })
    await saveTopicReport(adapter, report)
    const list = await loadTopicReports(adapter)
    expect(list).toHaveLength(1)
    expect(findReportByRecommendationId(list, 'customer:code:c001')?.title).toBe('客户 · 甲公司')
    expect(findReportByRecommendationId(list, 'customer:code:c001')?.status).toBe('generating')
  })

  it('keeps createdBy when a later save omits it, and records updatedBy separately', async () => {
    const { preserveTopicReportActors, topicReportCreatedByLabel, topicReportUpdatedByLabel, sortTopicReportsForViewer, canDeleteTopicReport } = await import('./reportActors.js')
    const creator = { userId: 'u1', username: '甲' }
    const other = { userId: 'u2', username: '乙' }
    const created = createTopicReport({ title: '客户专题', createdBy: creator })
    expect(created.createdBy).toEqual(creator)
    expect(created.updatedBy).toBeNull()
    const afterGenerate = preserveTopicReportActors(
      { ...created, createdBy: null, status: 'ready' },
      created,
    )
    expect(afterGenerate.createdBy).toEqual(creator)
    const afterSupplement = preserveTopicReportActors(
      { ...afterGenerate, updatedBy: other },
      afterGenerate,
    )
    expect(afterSupplement.createdBy).toEqual(creator)
    expect(afterSupplement.updatedBy).toEqual(other)
    expect(topicReportCreatedByLabel(afterSupplement, creator)).toBe('我创建的')
    expect(topicReportCreatedByLabel(afterSupplement, other)).toBe('甲 创建')
    expect(topicReportCreatedByLabel({}, creator)).toBe('未知创建人')
    expect(topicReportUpdatedByLabel(afterSupplement, other)).toBe('我上传了补充材料')
    expect(topicReportUpdatedByLabel(afterSupplement, creator)).toBe('乙 上传了补充材料')
    expect(canDeleteTopicReport(afterSupplement, creator)).toBe(true)
    expect(canDeleteTopicReport(afterSupplement, other)).toBe(false)
    expect(canDeleteTopicReport(afterSupplement, { ...other, role: 'admin' })).toBe(true)
    expect(canDeleteTopicReport({ id: 'x', createdBy: null }, creator)).toBe(false)
    expect(canDeleteTopicReport({ id: 'x', createdBy: null }, { ...creator, role: 'admin' })).toBe(true)
    const sorted = sortTopicReportsForViewer([
      { id: 'b', createdBy: other, updatedAt: '2026-08-14T05:00:00.000Z' },
      { id: 'a', createdBy: creator, updatedAt: '2026-08-14T04:00:00.000Z' },
    ], creator)
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('deletes a saved topic report', async () => {
    const { deleteTopicReport } = await import('./store.js')
    const meta = new Map()
    const adapter = {
      getMeta: async (key) => meta.get(key),
      putMeta: async (key, value) => { meta.set(key, value) },
    }
    const report = createTopicReport({ title: '待删', createdBy: { userId: 'u1', username: '甲' } })
    await saveTopicReport(adapter, report)
    expect(await loadTopicReports(adapter)).toHaveLength(1)
    const next = await deleteTopicReport(adapter, report.id)
    expect(next).toHaveLength(0)
    expect(await loadTopicReports(adapter)).toHaveLength(0)
  })

  it('keeps a just-saved generating report when a later empty load arrives', async () => {
    const { mergeTopicReports } = await import('./store.js')
    const local = [{ id: 'r1', title: '安全组', status: 'generating', updatedAt: '2026-08-14T04:00:00.000Z' }]
    expect(mergeTopicReports([], local)).toEqual(local)
    expect(mergeTopicReports([
      { id: 'r1', title: '安全组', status: 'ready', updatedAt: '2026-08-14T04:00:01.000Z' },
    ], local)[0].status).toBe('ready')
  })

  it('rejects save when the report does not round-trip from storage', async () => {
    const adapter = {
      getMeta: async () => ({ reports: [] }),
      putMeta: async () => {},
    }
    await expect(saveTopicReport(adapter, createTopicReport({ title: '丢失' }))).rejects.toThrow(/未能写入存储/)
  })

  it('migrates legacy topic runs into the report list', async () => {
    const meta = new Map([
      [META_KEY_TOPIC_ANALYSIS_RUNS, {
        runs: [{
          id: 'old-1',
          periodLabel: '2026年3月–8月',
          brief: { topic: { title: '旧专题', type: 'common_issue' } },
          savedAt: '2026-08-01T00:00:00.000Z',
        }],
      }],
    ])
    const adapter = {
      getMeta: async (key) => meta.get(key),
      putMeta: async (key, value) => { meta.set(key, value) },
    }
    const list = await loadTopicReports(adapter)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('旧专题')
    expect(list[0].origin).toBe('custom')
    expect(meta.has(META_KEY_TOPIC_ANALYSIS_REPORTS)).toBe(false)
  })

  it('filters records with an in-memory custom period', async () => {
    const period = buildRollingMonthPeriod(6, new Date('2026-08-14T00:00:00'))
    const adapter = {
      init: async () => {},
      listRecords: async () => ({
        records: [
          ticket({ id: 'in', importMonth: '2026-05' }),
          ticket({ id: 'out', importMonth: '2025-01' }),
        ],
        total: 2,
      }),
    }
    const scoped = await loadRecordsForTopicPeriod(adapter, period, {
      products: [{ key: 'eip', name: '弹性公网IP', enabled: true, analysisPostUseRating: true, specs: [] }],
    })
    expect(scoped.map((row) => row.id)).toEqual(['in'])
  })

  it('keeps 10-score post-use praise in the period loader for custom topics', async () => {
    const period = buildRollingMonthPeriod(6, new Date('2026-08-14T00:00:00'))
    const adapter = {
      init: async () => {},
      listRecords: async () => ({
        records: [
          ticket({
            id: 'praise',
            importMonth: '2026-05',
            dataSourceType: 'post_use_rating',
            ratingScore: 10,
            commentText: '用着很稳定',
            product: '弹性公网IP',
            productName: '弹性公网IP',
            productKey: 'eip',
          }),
        ],
        total: 1,
      }),
    }
    const scoped = await loadRecordsForTopicPeriod(adapter, period, {
      products: [{ key: 'eip', name: '弹性公网IP', enabled: true, analysisPostUseRating: true, specs: [] }],
    })
    expect(scoped.map((row) => row.id)).toEqual(['praise'])
  })

  it('drops records whose product is not analysis-enabled', async () => {
    const period = buildRollingMonthPeriod(6, new Date('2026-08-14T00:00:00'))
    const adapter = {
      init: async () => {},
      listRecords: async () => ({
        records: [
          ticket({ id: 'in', importMonth: '2026-05', product: '弹性公网IP', productName: '弹性公网IP', productKey: 'eip' }),
          ticket({ id: 'off', importMonth: '2026-05', product: '未启用产品', productName: '未启用产品', productKey: 'off', sourceColumns: {} }),
          ticket({ id: 'unknown', importMonth: '2026-05', product: '未知云产品', productName: '未知云产品', productKey: '', sourceColumns: {} }),
        ],
        total: 3,
      }),
    }
    const scoped = await loadRecordsForTopicPeriod(adapter, period, {
      products: [
        { key: 'eip', name: '弹性公网IP', enabled: true, analysisPostUseRating: true, specs: [] },
        { key: 'off', name: '未启用产品', enabled: false, analysisPostUseRating: false, specs: [] },
      ],
    })
    expect(scoped.map((row) => row.id)).toEqual(['in'])
    expect(scoped[0].productKey).toBe('eip')
  })

  it('tags chronic, worsening, cross-product and persistent customer scenarios', () => {
    const records = [
      ticket({ id: 'c1', importMonth: '2026-01', sentiment: 'negative' }),
      ticket({ id: 'c2', importMonth: '2026-03', sentiment: 'negative' }),
      ticket({ id: 'c3', importMonth: '2026-07', sentiment: 'negative' }),
      ticket({ id: 'w1', importMonth: '2026-01', product: '云主机', problemType: '控制台卡顿' }),
      ticket({ id: 'w2', importMonth: '2026-07', product: '云主机', problemType: '控制台卡顿', sentiment: 'negative' }),
      ticket({ id: 'w3', importMonth: '2026-07', product: '云主机', problemType: '控制台卡顿', sentiment: 'negative' }),
      ticket({ id: 'w4', importMonth: '2026-08', product: '云主机', problemType: '控制台卡顿', sentiment: 'strong_negative' }),
      ticket({ id: 'w5', importMonth: '2026-08', product: '云主机', problemType: '控制台卡顿' }),
      ticket({ id: 'w6', importMonth: '2026-08', product: '云主机', problemType: '控制台卡顿' }),
      ticket({ id: 'p1', importMonth: '2026-06', product: '弹性公网IP', problemType: '控制台卡顿' }),
    ]
    const cards = recommendTopics({ records, toMonth: '2026-08', periodLabel: '近9个月' })
    const eipLimit = cards.find((card) => card.id === 'product:弹性公网IP:带宽限速')
    const hostLag = cards.find((card) => card.id === 'product:云主机:控制台卡顿')
    const commonLag = cards.find((card) => card.id === 'common:控制台卡顿')
    const customer = cards.find((card) => card.type === 'customer')
    expect(eipLimit?.scenarios).toContain('chronic')
    expect(hostLag?.scenarios).toContain('worsening')
    expect(commonLag?.scenarios).toContain('cross_product')
    expect(customer?.scenarios).toContain('customer_persistent')
  })

  it('collects evidence and builds a brief with sources', () => {
    const topic = topicFromUserQuery('带宽限速', { type: 'common_issue' })
    const evidence = collectTopicEvidence({
      topic,
      periodLabel: '2026年8月',
      records: [ticket(), ticket({ id: 'r2', ticketId: 'T-2', product: '云主机' })],
      visits: [{ id: 'v1', customerName: '甲公司', productName: '弹性公网IP', feedbackSummary: '限速影响业务' }],
      actionItems: [{ id: 'a1', content: '评估带宽限速策略', status: 'in_progress', productName: '弹性公网IP' }],
    })
    expect(evidence.total).toBe(2)
    expect(recordMatchesTopic(ticket(), topic)).toBe(true)
    const brief = buildTopicBrief({
      evidence,
      supplements: [{ id: 's1', fileName: '补充.md', format: 'md', notes: ['产品侧已排期 Q3 扩容'] }],
    })
    expect(brief.demo).toBe(true)
    expect(brief.sources.length).toBeGreaterThan(0)
    expect(brief.signalPack.sample.total).toBe(2)
    expect(brief.analysis.quantitative.sourceMix.length).toBeGreaterThan(0)
    expect(brief.supplementItems[0].text).toContain('扩容')
    const md = buildTopicMarkdown(brief)
    expect(md).toContain('带宽限速')
    expect(md).toContain('信息源')
    expect(md).toContain('补充材料')
    expect(md).toContain('为什么发生')
  })

  it('builds a low-confidence observation for sparse evidence', () => {
    const evidence = collectTopicEvidence({
      topic: topicFromUserQuery('带宽限速', { type: 'common_issue' }),
      records: [ticket({ importMonth: '2026-08', sentiment: 'strong_negative' })],
      period: { fromMonth: '2026-08', toMonth: '2026-08' },
    })
    const decision = buildTopicDecision(evidence)
    expect(decision.attribution.confidence).toBe('low')
    expect(decision.action.type).toBe('observe')
    expect(decision.urgency.level).toBe('P2')
  })

  it('keeps split topics out of repair actions', () => {
    const evidence = {
      topic: { type: 'common_issue', title: '共性问题' },
      evidenceIds: ['r1'],
      signalPack: {
        sample: { total: 8, negative: 4, productCount: 2 },
        analysis: { scenarios: ['worsening'], keyCustomer: true, monthCounts: {}, recentAvg: 2, baselineAvg: 1 },
        dimensions: {
          problem: { rows: [{ name: 'A', count: 4 }, { name: 'B', count: 4 }], total: 8, top: { name: 'A', count: 4 }, headShare: 0.5 },
        },
        inventory: { openCount: 0, doneCount: 0, stoppedCount: 0, open: [] },
        splitSuggested: true,
        window: { all: ['2026-01', '2026-02', '2026-03'] },
      },
    }
    const decision = buildTopicDecision(evidence)
    expect(decision.urgency.level).toBe('P0')
    expect(decision.action.type).toBe('split')
    expect(decision.action.what).toContain('拆')
  })

  it('only adds a semantic split with two independent evidence clusters', () => {
    const evidence = {
      quotes: [
        { id: 'a1', recordId: 'a1', ticketId: 'T-1' },
        { id: 'a2', recordId: 'a2', ticketId: 'T-2' },
        { id: 'b1', recordId: 'b1', ticketId: 'T-3' },
        { id: 'b2', recordId: 'b2', ticketId: 'T-4' },
      ],
      signalPack: { splitSuggested: false },
    }
    const accepted = applySemanticSplitResult(evidence, {
      semanticSplit: {
        suggestSplit: true,
        clusters: [
          { label: '创建失败', sourceIds: ['a1', 'T-2'] },
          { label: '计费疑问', sourceIds: ['b1', 'T-4'] },
        ],
      },
    })
    expect(accepted.signalPack.semanticSplitSuggested).toBe(true)
    expect(accepted.signalPack.semanticClusters).toHaveLength(2)
    const rejected = applySemanticSplitResult(evidence, {
      semanticSplit: { suggestSplit: true, clusters: [{ label: '单一问题', sourceIds: ['a1'] }] },
    })
    expect(rejected.signalPack.semanticSplitSuggested).toBeUndefined()
  })

  it('matches split product and problem tokens without requiring a contiguous phrase', () => {
    const topic = topicFromUserQuery('弹性公网IP带宽限速', { type: 'product_issue' })
    const hit = ticket({
      product: '弹性公网IP',
      problemType: '网络质量',
      painPoint: '高峰时段带宽经常被限速',
      rawText: '客户反馈晚上公网带宽不够用，会被限制',
    })
    const miss = ticket({
      id: 'other',
      product: '云主机',
      problemType: '磁盘容量',
      painPoint: '磁盘写满了',
      rawText: '云主机磁盘告警',
    })
    expect(recordMatchesTopic(hit, topic)).toBe(true)
    expect(recordMatchesTopic(miss, topic)).toBe(false)
    expect(recordMatchesTopic(
      ticket({ product: '弹性公网IP', painPoint: '带宽经常被限制，高峰不够用', problemType: '网络质量' }),
      topicFromUserQuery('带宽限速', { type: 'common_issue' }),
    )).toBe(true)
  })

  it('matches quota tickets from a natural-language common topic title', async () => {
    const { applyInterpretationToTopic, buildRuleInterpretation } = await import('./interpretTopic.js')
    const query = '配额申请与配额不足问题分析'
    const topic = applyInterpretationToTopic(
      topicFromUserQuery(query, { type: 'common_issue' }),
      buildRuleInterpretation(query, 'common_issue'),
    )
    expect(topic.problemKey).toBe('配额申请与配额不足')
    expect(topic.matchQuery).toBe('配额；申请、不足')
    expect(topic.matchLayers).toEqual([
      { terms: ['配额'] },
      { terms: ['申请', '不足'] },
    ])
    const hitApply = ticket({
      problemType: '配额与权限申请',
      painPoint: '申请提升带宽配额上限',
      rawText: '申请将公网IP全局配额从20提升至300',
    })
    const hitShortage = ticket({
      id: 'r2',
      problemType: '配额与权限申请',
      painPoint: '创建IP时提示配额不足',
      rawText: '创建IP时提示配额不足，请提升配额',
    })
    const miss = ticket({
      id: 'r3',
      problemType: '带宽限速',
      painPoint: '高峰时段带宽经常被限速',
      rawText: '客户反馈晚上公网带宽不够用，会被限制',
    })
    expect(recordMatchesTopic(hitApply, topic)).toBe(true)
    expect(recordMatchesTopic(hitShortage, topic)).toBe(true)
    expect(recordMatchesTopic(miss, topic)).toBe(false)
    expect(recordMatchesTopic(hitApply, topicFromUserQuery(query, { type: 'common_issue' }))).toBe(true)
  })

  it('parses markdown and excel supplements including 待补充 columns', async () => {
    const mdFile = new File(['产品已在 JIRA-9 跟进扩容'], 'note.md', { type: 'text/markdown' })
    const md = await parseTopicSupplementFile(mdFile, 'note.md')
    expect(md.text).toContain('JIRA-9')

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      工单号: 'T-1',
      客户名称: '甲公司',
      产品: '弹性公网IP',
      补充说明: '已现场确认限速阈值',
      关联单号: 'JIRA-9',
      内部结论: '需扩容',
    }]), '信息源待补充')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const xlsxFile = new File([buf], 'pack.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const parsed = await parseTopicSupplementFile(xlsxFile, 'pack.xlsx')
    expect(parsed.notes.join(' ')).toContain('JIRA-9')
    expect(parsed.notes.join(' ')).toContain('需扩容')
  })

  it('parses uncompressed pdf text', async () => {
    const pdf = `%PDF-1.1
1 0 obj<<>>endobj
2 0 obj<< /Length 20 >>stream
(JIRA-42 扩容结论) Tj
endstream
endobj
trailer<<>>
%%EOF`
    const parsed = await parseTopicSupplementFile(new Blob([pdf]), 'note.pdf')
    expect(parsed.text).toContain('JIRA-42')
  })

  it('parses docx supplements', async () => {
    const doc = new Document({
      sections: [{ children: [new Paragraph('拜访结论：客户确认晚高峰限速')] }],
    })
    const blob = await Packer.toBlob(doc)
    const parsed = await parseTopicSupplementFile(blob, 'visit.docx')
    expect(parsed.text).toContain('晚高峰限速')
  })

  it('warns when a customer topic is given a problem keyword', async () => {
    const {
      customTopicTypeMismatch,
      parseTopicLabelList,
      topicForPersist,
      topicLabelListFromInput,
      topicLabelListToInput,
      topicRequestErrorMessage,
    } = await import('./customTopic.js')
    expect(customTopicTypeMismatch('customer', '安全组配置不当')).toMatch(/共性问题专题/)
    expect(customTopicTypeMismatch('customer', '甲公司')).toBe('')
    expect(customTopicTypeMismatch('common_issue', '安全组配置不当')).toBe('')
    expect(topicForPersist({ id: 'x', records: [{ id: 'r1' }] })).toEqual({ id: 'x' })
    expect(topicRequestErrorMessage(new Error('Failed to fetch'), '新建专题失败')).toContain('无法连接服务器')
    expect(topicLabelListFromInput('安全组、')).toEqual(['安全组', ''])
    expect(topicLabelListToInput(['安全组', ''])).toBe('安全组、')
    expect(parseTopicLabelList(['安全组', '', '配置不当'])).toEqual(['安全组', '配置不当'])
  })

  it('builds a confirmable interpretation and drops invented products from LLM', async () => {
    const { applyInterpretationToTopic } = await import('./interpretTopic.js')
    const { applyLlmInterpretation, buildRuleInterpretation } = await import('./interpretTopic.js')
    const baseline = buildRuleInterpretation('弹性公网IP带宽限速', 'product_issue')
    expect(baseline.products).toContain('弹性公网IP')
    expect(baseline.problem).toMatch(/带宽|限速/)
    expect(baseline.interpretation).toContain('弹性公网IP')
    const polished = applyLlmInterpretation(baseline, {
      title: '弹性公网IP晚高峰限速',
      products: ['弹性公网IP', '黑洞产品'],
      problem: '带宽限速',
      keywords: ['带宽', '限速'],
      interpretation: '你要看弹性公网IP被限速的反馈。',
      scopeNote: '只看该产品。',
      questions: ['是否包含共享带宽？'],
    }, '弹性公网IP带宽限速')
    expect(polished.source).toBe('llm')
    expect(polished.products).toEqual(['弹性公网IP'])
    expect(polished.title).toBe('弹性公网IP晚高峰限速')
    const topic = applyInterpretationToTopic(
      topicFromUserQuery('弹性公网IP带宽限速', { type: 'product_issue' }),
      polished,
    )
    expect(topic.matchQuery).toContain('弹性公网IP')
    expect(topic.title).toBe('弹性公网IP晚高峰限速')
  })

  it('extracts a customer object from a paragraph for confirmation', async () => {
    const { applyInterpretationToTopic, applyLlmInterpretation, buildRuleInterpretation } = await import('./interpretTopic.js')
    const baseline = buildRuleInterpretation('甲公司最近弹性公网IP一直限速', 'customer')
    expect(baseline.customerName).toBe('甲公司')
    expect(baseline.title).toContain('甲公司')
    expect(baseline.questions.some((item) => item.includes('甲公司'))).toBe(true)
    const polished = applyLlmInterpretation(baseline, {
      title: '客户 · 甲公司',
      customerName: '甲公司',
      customerCode: '',
      products: ['黑洞客户'],
      interpretation: '要看甲公司近几个月的反馈。',
      scopeNote: '按客户编码/名称匹配。',
      questions: [],
    }, '甲公司最近弹性公网IP一直限速')
    expect(polished.customerName).toBe('甲公司')
    const invented = applyLlmInterpretation(baseline, {
      customerName: '乙集团',
      customerCode: 'FAKE-999',
    }, '甲公司最近弹性公网IP一直限速')
    expect(invented.customerName).toBe('甲公司')
    expect(invented.customerCode).toBe('')
    const topic = applyInterpretationToTopic(
      topicFromUserQuery('甲公司最近弹性公网IP一直限速', { type: 'customer' }),
      polished,
    )
    expect(topic.customerName).toBe('甲公司')
    expect(topic.query).toBe('甲公司')
    expect(topic.matchQuery).toBe('甲公司')
    const byCode = buildRuleInterpretation('C001', 'customer')
    expect(byCode.customerCode).toBe('C001')
    expect(byCode.customerName).toBe('')
  })
})
