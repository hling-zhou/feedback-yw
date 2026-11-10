import { describe, expect, it } from 'vitest'
import {
  executeCustomerVisitImport,
  matchLibraryRecord,
  parseRatingScoreFromText,
  normalizeCustomerVisitRow,
  runCustomerVisitImportDryRun,
  stableVisitRecordId,
} from './customerVisitImport.js'
import { loadVisitRecords, META_KEY_POST_USE_VISITS } from './visitRecords.js'

describe('customerVisitImport', () => {
  it('parseRatingScoreFromText extracts leading score', () => {
    expect(parseRatingScoreFromText('1分*1')).toBe(1)
    expect(parseRatingScoreFromText('10分')).toBe(10)
    expect(parseRatingScoreFromText('8.5分（备注）')).toBe(8.5)
    expect(parseRatingScoreFromText('')).toBeNaN()
  })

  it('matchLibraryRecord soft-matches by channel+product+customer', () => {
    const candidates = [
      {
        id: 'old',
        dataSourceType: 'post_use_rating',
        channel: 'console',
        productName: '弹性公网IP',
        customerName: '甲公司',
        customerCode: 'C001',
        ratingScore: 1,
        importMonth: '2026-05',
        createdAt: '2026-05-01',
      },
      {
        id: 'hit',
        dataSourceType: 'post_use_rating',
        channel: 'console',
        productName: '弹性公网IP',
        customerName: '甲公司',
        customerCode: 'C001',
        ratingScore: 1,
        importMonth: '2026-05',
        createdAt: '2026-05-20',
      },
      {
        id: 'cb',
        dataSourceType: 'post_use_rating',
        channel: 'callback',
        productName: '弹性公网IP',
        customerName: '甲公司',
        ratingScore: 1,
      },
    ]

    const visit = normalizeCustomerVisitRow({
      visitMonth: '2026-05',
      productName: '弹性公网IP',
      customerName: '甲公司',
      customerCode: 'C001',
    })

    const result = matchLibraryRecord(candidates, visit)
    expect(result.record?.id).toBe('hit')
    expect(result.matchedBy).toBe('channel+product+customer')
    expect(result.multiMatch).toBe(true)
    expect(result.skipAttach).toBe(false)

    const callbackVisit = {
      ...visit,
      scoreSource: '投诉回访',
      channel: 'callback',
    }
    const cb = matchLibraryRecord(candidates, callbackVisit)
    expect(cb.skipAttach).toBe(true)
    expect(cb.record).toBeNull()
  })

  it('stableVisitRecordId is deterministic for same keys', () => {
    expect(stableVisitRecordId('2026-05', '云专线', '客户A/C001')).toBe(
      stableVisitRecordId('2026-05', '云专线', '客户A/C001'),
    )
    expect(stableVisitRecordId('2026-05', '云专线', '客户A/C001')).not.toBe(
      stableVisitRecordId('2026-05', '云专线', '客户B/C002'),
    )
  })

  it('normalizes customer visit fields from the new template', () => {
    const row = normalizeCustomerVisitRow({
      数据月份: '2026-06',
      产品名称: '云专线',
      客户名称: '客户A',
      客户编码: 'C001',
      回访结果: '电话已回访',
      内部评估: '待跟进',
      备注: '补充说明',
    })

    expect(row.customerName).toBe('客户A')
    expect(row.customerCode).toBe('C001')
    expect(row.userInfoDetail).toBe('客户A / C001')
    expect(row.feedbackSummary).toBe('电话已回访')
    expect(row.visitFeedbackDetail).toBe('电话已回访')
    expect(row.internalEvaluationDetail).toBe('待跟进')
    expect(row.remark).toBe('补充说明')
  })

  it('2026-11-09 模板对齐：相应投诉工单/经办人/客户反馈 直传列名兜底 + 可选列允许为空', () => {
    const row = normalizeCustomerVisitRow({
      数据月份: '2026-10',
      产品名称: '云监控',
      客户名称: '客户B',
      客户编码: '',      // 允许为空
      回访结果: '这里是回访结果',
      相应投诉工单: 'TS2026100100001',
      经办人: '示例',
      客户反馈: '7分以下分布：控制台*1分*1次',
      内部评估: '',      // 允许为空
    })
    expect(row.originalTicketId).toBe('TS2026100100001')
    expect(row.assigneeName).toBe('示例')
    expect(row.userFeedbackText).toBe('7分以下分布：控制台*1分*1次')
    expect(row.internalEvaluationDetail).toBe('')
    expect(row.customerCode).toBe('')
  })

  it('2026-11-09 回访结果必填：缺回访结果的行进 unmatched，不再入库', async () => {
    const storedMeta = new Map()
    const adapter = {
      getMeta: async (key) => storedMeta.get(key),
      putMeta: async (key, value) => storedMeta.set(key, value),
    }
    const result = await executeCustomerVisitImport({
      adapter,
      rows: [
        {
          数据月份: '2026-10',
          产品名称: '云监控',
          客户名称: '客户B',
          // 回访结果缺失 → 应被拒
          客户编码: 'E001',
        },
        {
          数据月份: '2026-10',
          产品名称: '云监控',
          客户名称: '客户C',
          客户编码: 'E002',
          回访结果: '正常回访',
        },
      ],
      importMonth: '2026-10',
      libraryRecords: [],
      updateRecords: async () => {},
    })
    expect(result.visitRecords).toHaveLength(1)
    // 第 1 行缺回访结果被必填校验拒绝；第 2 行因空库软匹配不到明细进 unmatched（正常路径，原因不同）
    expect(result.unmatched.length).toBeGreaterThanOrEqual(1)
    expect(result.unmatched[0].rowIndex).toBe(1)
    expect(result.unmatched[0].reason).toContain('回访结果')
  })

  it('attaches imported customer visit to the matched post-use rating', async () => {
    const storedMeta = new Map()
    const updates = []
    const libraryRecords = [
      {
        id: 'rating-1',
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        productName: '云专线',
        customerName: '客户A',
        ratingScore: 8,
        importMonth: '2026-06',
      },
    ]
    const result = await executeCustomerVisitImport({
      adapter: {
        getMeta: async (key) => storedMeta.get(key),
        putMeta: async (key, value) => storedMeta.set(key, value),
      },
      rows: [
        {
          数据月份: '2026-06',
          产品名称: '云专线',
          客户名称: '客户A',
          客户编码: 'C001',
          回访结果: '客户确认当前方案无法满足',
          内部评估: '建议进入需求池',
          备注: '下月再联系',
        },
      ],
      importMonth: '2026-06',
      libraryRecords,
      updateRecords: async (records) => updates.push(...records),
    })

    expect(result.matchedCount).toBe(1)
    expect(result.visitRecords[0].importMonth).toBe('2026-06')
    expect(result.detailedFieldMissingCount).toBe(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('rating-1')
    expect(updates[0].customerVisit.feedbackSummary).toBe('客户确认当前方案无法满足')
    expect(updates[0].customerVisit.customerName).toBe('客户A')
    expect(updates[0].customerVisit.customerCode).toBe('C001')
    expect(updates[0].customerVisit.internalEvaluationDetail).toBe('建议进入需求池')
    expect(updates[0].customerVisit.remark).toBe('下月再联系')
    // 2026-11-09：导入时内部评估有值 → 评估状态直接为已评估（两处写入点同口径）
    expect(updates[0].customerVisit.evaluationSubmitted).toBe(true)
    expect(result.visitRecords[0].evaluationSubmitted).toBe(true)
  })

  it('marks evaluationSubmitted=false when 内部评估 column is empty on import', () => {
    const dry = runCustomerVisitImportDryRun({
      rows: [
        {
          数据月份: '2026-10',
          产品名称: '云专线',
          客户名称: '客户B',
          客户编码: 'C002',
          回访结果: '电话已回访',
          内部评估: '',
        },
      ],
      libraryRecords: [],
      importMonth: '2026-10',
    })
    expect(dry.visitRecords[0].evaluationSubmitted).toBe(false)
    expect(dry.visitRecords[0].internalEvaluationDetail).toBe('')
  })

  it('keeps every row for the same customer, product, and month, and reimport does not duplicate them', async () => {
    const storedMeta = new Map()
    const adapter = {
      getMeta: async (key) => storedMeta.get(key),
      putMeta: async (key, value) => storedMeta.set(key, value),
    }
    const rows = [
      {
        数据月份: '2026-06',
        产品名称: '云专线',
        客户名称: '客户A',
        客户编码: 'C001',
        回访结果: '第一次回访',
        内部评估: '需求接纳',
        备注: '甲',
      },
      {
        数据月份: '2026-06',
        产品名称: '云专线',
        客户名称: '客户A',
        客户编码: 'C001',
        回访结果: '第一次回访',
        内部评估: '需求接纳',
        备注: '甲',
      },
      {
        数据月份: '2026-06',
        产品名称: '云专线',
        客户名称: '客户A',
        客户编码: 'C001',
        回访结果: '第二次回访',
        内部评估: '待客户反馈',
        备注: '乙',
      },
    ]
    const first = await executeCustomerVisitImport({
      adapter,
      rows,
      importMonth: '2026-06',
      libraryRecords: [],
      updateRecords: async () => {},
    })

    expect(first.visitRecords).toHaveLength(3)
    expect(new Set(first.visitRecords.map((item) => item.id)).size).toBe(3)
    expect(first.visitRecords.map((item) => item.remark)).toEqual(['甲', '甲', '乙'])

    await executeCustomerVisitImport({
      adapter,
      rows,
      importMonth: '2026-06',
      libraryRecords: [],
      updateRecords: async () => {},
    })
    const saved = await loadVisitRecords(adapter)
    expect(saved).toHaveLength(3)
    expect(saved.map((item) => item.visitResult)).toEqual(['第一次回访', '第一次回访', '第二次回访'])
  })

  it('updates a previously stored single visit and appends additional rows', async () => {
    const legacyId = stableVisitRecordId('2026-06', '云专线', 'C001')
    const storedMeta = new Map([
      [META_KEY_POST_USE_VISITS, {
        records: [{
          id: legacyId,
          importMonth: '2026-06',
          visitMonth: '2026-06',
          productName: '云专线',
          customerName: '客户A',
          customerCode: 'C001',
          visitResult: '旧回访',
          internalConclusion: '待客户反馈',
        }],
      }],
    ])
    const adapter = {
      getMeta: async (key) => storedMeta.get(key),
      putMeta: async (key, value) => storedMeta.set(key, value),
    }
    await executeCustomerVisitImport({
      adapter,
      rows: [
        {
          数据月份: '2026-06',
          产品名称: '云专线',
          客户名称: '客户A',
          客户编码: 'C001',
          回访结果: '更正后的回访',
          内部评估: '需求接纳',
          备注: '甲',
        },
        {
          数据月份: '2026-06',
          产品名称: '云专线',
          客户名称: '客户A',
          客户编码: 'C001',
          回访结果: '第二条回访',
          内部评估: '待客户反馈',
          备注: '乙',
        },
      ],
      importMonth: '2026-06',
      libraryRecords: [],
      updateRecords: async () => {},
    })

    const saved = await loadVisitRecords(adapter)
    expect(saved).toHaveLength(2)
    expect(saved.find((item) => item.id === legacyId)).toMatchObject({
      visitResult: '更正后的回访',
      remark: '甲',
    })
    expect(saved.some((item) => item.id !== legacyId && item.visitResult === '第二条回访')).toBe(true)
  })

  // 2026-11-10 覆盖语义（用户拍板）：身份键 = 同月+同产品+同客户（不含内容/次序）；
  // 同键覆盖消除重复；人工编辑域（manualEditedFields）导入不冲掉。
  it('same identity + changed content reimports overwrite instead of duplicating', async () => {
    const storedMeta = new Map()
    const adapter = {
      getMeta: async (key) => storedMeta.get(key),
      putMeta: async (key, value) => storedMeta.set(key, value),
    }
    await executeCustomerVisitImport({
      adapter,
      rows: [{ 数据月份: '2026-10', 产品名称: '云专线', 客户名称: '客户A', 客户编码: 'C1', 回访结果: '第一次回访' }],
      importMonth: '2026-10',
      libraryRecords: [],
      updateRecords: async () => {},
    })
    // 内容变化（旧 bug：id 含内容与次序 → 再导变第二条）
    await executeCustomerVisitImport({
      adapter,
      rows: [{ 数据月份: '2026-10', 产品名称: '云专线', 客户名称: '客户A', 客户编码: 'C1', 回访结果: '第一次回访（更新）' }],
      importMonth: '2026-10',
      libraryRecords: [],
      updateRecords: async () => {},
    })
    const saved = await loadVisitRecords(adapter)
    expect(saved).toHaveLength(1)
    expect(saved[0].visitResult).toBe('第一次回访（更新）')
  })

  it('manual-edited fields survive reimport; import-origin values get overwritten', async () => {
    const storedMeta = new Map([
      [META_KEY_POST_USE_VISITS, {
        version: 1,
        records: [{
          id: 'manual-id', visitMonth: '2026-10', importMonth: '2026-10', productName: '云专线',
          customerName: '客户A', customerCode: 'C1', visitResult: '旧回访',
          internalEvaluationDetail: '人工评估结论', internalConclusion: '人工评估结论',
          assigneeName: '张三', remark: '人工备注', actionId: 'act-1',
          evaluationSubmitted: true, manualEditedFields: ['internalEvaluation', 'assigneeName', 'remark'],
        }, {
          id: 'plain-id', visitMonth: '2026-10', importMonth: '2026-10', productName: '云专线',
          customerName: '客户B', customerCode: 'C2', visitResult: '旧回访B',
          internalEvaluationDetail: '导入来源的评估', assigneeName: '导入来源的经办人',
        }],
      }],
    ])
    const adapter = {
      getMeta: async (key) => storedMeta.get(key),
      putMeta: async (key, value) => storedMeta.set(key, value),
    }
    await executeCustomerVisitImport({
      adapter,
      rows: [
        { 数据月份: '2026-10', 产品名称: '云专线', 客户名称: '客户A', 客户编码: 'C1', 回访结果: '新回访A', 内部评估: '导入的评估A', 经办人: '李四', 备注: '导入的备注A' },
        { 数据月份: '2026-10', 产品名称: '云专线', 客户名称: '客户B', 客户编码: 'C2', 回访结果: '新回访B' },
      ],
      importMonth: '2026-10',
      libraryRecords: [],
      updateRecords: async () => {},
    })
    const saved = await loadVisitRecords(adapter)
    const a = saved.find((item) => item.id === 'manual-id')
    // 人工域：库值保留
    expect(a).toMatchObject({
      visitResult: '新回访A',
      internalEvaluationDetail: '人工评估结论',
      assigneeName: '张三',
      remark: '人工备注',
      actionId: 'act-1',
      evaluationSubmitted: true,
    })
    // 导入来源域：导入值（空）覆盖清空
    const b = saved.find((item) => item.id === 'plain-id')
    expect(b).toMatchObject({
      visitResult: '新回访B',
      internalEvaluationDetail: '',
      assigneeName: '',
    })
    expect(saved).toHaveLength(2)
  })
})
