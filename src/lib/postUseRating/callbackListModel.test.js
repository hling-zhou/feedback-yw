import { describe, expect, it } from 'vitest'
import { buildPostUseCallbackLists } from './callbackListModel.js'
import { buildPostUseStoryModel } from './storyModel.js'

/**
 * 口径对拍守卫（T7，2026-11-21 平铺需求）：
 * 工作台弹窗数据链（buildPostUseStoryModel → callbackRecommendations/callbackNonTenRecords）
 * 与反馈库 tab 数据链（buildPostUseCallbackLists 直调）必须同输入同产出——
 * 任何一侧口径漂移（改 build 函数只同步一处、参数错位等）即红。
 * 并存期纪律：两壳操作同一服务端真源，UI 侧清单口径由本测试锚定。
 */

/** storyModel.test.js「builds callback recommendations…」同款 fixture */
const consoleRecords = [
  {
    id: 'r1',
    dataSourceType: 'post_use_rating',
    productName: '弹性公网IP',
    ratingScore: 6,
    channel: 'console',
    importMonth: '2026-06',
    commentText: '控制台原话1',
    rawText: '控制台原话1',
    lowScoreReason: '功能有缺失',
    feedbackReasonTexts: ['满意原因A', '建议A'],
    customerName: '中国铁塔某省公司',
    customerCode: 'C1',
    createdAt: '2026-06-03T10:00:00.000Z',
    surveyName: '旧问卷',
    touchpointPageName: '旧页面',
  },
  {
    id: 'r2',
    dataSourceType: 'post_use_rating',
    productName: '弹性公网IP',
    ratingScore: 5,
    channel: 'console',
    importMonth: '2026-06',
    commentText: '控制台原话2',
    rawText: '控制台原话2',
    lowScoreReason: '功能有缺失',
    feedbackReasonTexts: ['满意原因B', '建议B'],
    customerName: '中国铁塔某省公司',
    customerCode: 'C1',
    createdAt: '2026-06-05T10:00:00.000Z',
    surveyName: '控制台用后即评',
    touchpointPageName: '弹性公网IP详情页',
  },
  {
    id: 'r3',
    dataSourceType: 'post_use_rating',
    productName: '弹性公网IP',
    ratingScore: 4,
    channel: 'console',
    importMonth: '2026-06',
    commentText: '普通客户原话1',
    rawText: '普通客户原话1',
    lowScoreReason: '流程复杂',
    feedbackReasonTexts: ['满意原因C'],
    customerName: '普通客户',
    customerCode: 'C2',
    createdAt: '2026-06-06T10:00:00.000Z',
  },
  {
    id: 'r4',
    dataSourceType: 'post_use_rating',
    productName: '弹性公网IP',
    ratingScore: 5,
    channel: 'console',
    importMonth: '2026-06',
    commentText: '普通客户原话2',
    rawText: '普通客户原话2',
    lowScoreReason: '流程复杂',
    feedbackReasonTexts: ['满意原因D', '建议D'],
    customerName: '普通客户',
    customerCode: 'C2',
    createdAt: '2026-06-07T10:00:00.000Z',
  },
  {
    id: 'r5',
    dataSourceType: 'post_use_rating',
    productName: '弹性公网IP',
    ratingScore: 4,
    channel: 'sms',
    importMonth: '2026-06',
    commentText: '短信不应命中',
    rawText: '短信不应命中',
    customerName: '普通客户',
    customerCode: 'C2',
    createdAt: '2026-06-08T10:00:00.000Z',
  },
  {
    id: 'r6',
    dataSourceType: 'post_use_rating',
    productName: '弹性公网IP',
    channel: 'option',
    importMonth: '2026-06',
    customerName: '中国铁塔某省公司',
    customerCode: 'C1',
    createdAt: '2026-06-09T10:00:00.000Z',
    surveyName: '选项类问卷',
    touchpointPageName: '选项类触点页',
  },
]

const keyCustomers = ['中国铁塔']
const productNames = ['弹性公网IP']

const ticketRecords = [
  {
    id: 't1',
    dataSourceType: 'complaint_ticket',
    ticketId: 'TS-1001',
    customerName: '中国铁塔某省公司',
    customerRequest: '请尽快修复弹性公网IP的问题',
    handlingText: '处理意见：已定位网络抖动根因并修复',
  },
]

const callbackRecords = [
  {
    id: 'cb1',
    dataSourceType: 'post_use_rating',
    channel: 'callback',
    importMonth: '2026-06',
    productName: '弹性公网IP',
    ratingScore: 8,
    originalTicketId: 'TS-1001',
    customerName: '中国铁塔某省公司',
    customerCode: 'C1',
    lowScoreReason: '处理太慢',
    createdAt: '2026-06-10T10:00:00.000Z',
  },
]

describe('buildPostUseCallbackLists 口径对拍（弹窗链 vs tab 链）', () => {
  // fixture 为字面对象（测试与 storyModel.test.js 同形态）；FeedbackRecord 类型局部放宽
  const allRecords = /** @type {any} */ ([...consoleRecords, ...callbackRecords])

  const viaStoryModel = buildPostUseStoryModel({
    records: allRecords,
    allRecords: [],
    productNames,
    settings: { postUseKeyCustomers: keyCustomers },
    ticketRecords,
  })
  const viaListModel = buildPostUseCallbackLists({
    records: allRecords,
    productNames,
    keyCustomers,
    ticketRecords: /** @type {any} */ (ticketRecords),
  })

  it('官网问卷类建议回访清单：itemKey 级一致', () => {
    expect(viaListModel.recommendations.map((r) => r.itemKey)).toEqual(
      viaStoryModel.callbackRecommendations.map((r) => r.itemKey),
    )
    // 深对拍：完整对象一致（字段级漂移即红）
    expect(viaListModel.recommendations).toEqual(viaStoryModel.callbackRecommendations)
  })

  it('投诉回访非10分清单：itemKey 级一致', () => {
    expect(viaListModel.nonTenRecords.map((r) => r.itemKey)).toEqual(
      viaStoryModel.callbackNonTenRecords.map((r) => r.itemKey),
    )
    expect(viaListModel.nonTenRecords).toEqual(viaStoryModel.callbackNonTenRecords)
    // 工单关查表生效：客户请求/问题原因来自工单记录
    expect(viaListModel.nonTenRecords[0].customerRequest).toContain('弹性公网IP')
  })

  it('基准断言：fixture 命中已知产出（防止两侧同空导致的假一致）', () => {
    expect(viaListModel.recommendations.length).toBeGreaterThanOrEqual(2)
    expect(viaListModel.nonTenRecords.length).toBeGreaterThanOrEqual(1)
    expect(viaListModel.recommendations[0].customerName).toBe('中国铁塔某省公司')
  })
})
