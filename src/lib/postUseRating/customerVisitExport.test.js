import { describe, expect, it } from 'vitest'
import { buildPostUseCustomerVisitRows } from './customerVisitExport.js'

describe('customerVisitExport', () => {
  it('merges imported customer visit rows with callback recommendation fields', () => {
    /** @type {any[]} 评价记录运行时字段（userFeedbackText 等导入链保证有值，VisitRecord 类型未声明为既有欠账） */
    const visits = [
      {
        importMonth: '2026-05',
        customerName: '中国铁塔',
        customerCode: 'C001',
        productName: '云主机',
        userFeedbackText: '希望增加导出功能',
        visitResult: '已回访',
        internalConclusion: '建议跟进',
      },
    ]
    const rows = buildPostUseCustomerVisitRows(
      visits,
      [
        {
          customerName: '中国铁塔',
          customerCode: 'C001',
          productName: '云主机',
          triggerType: '7分以下重点客户',
          lowScoreLt7Count: 2,
          scoreBreakdown: '6分1次；5分1次',
          quoteCount: 2,
          reasonCount: 1,
          latestFeedbackAt: '2026-05-21 10:00:00',
          channels: ['短信', '控制台'],
          recommendedReason: '建议省代表回访',
          quotes: ['原话A', '原话B'],
          reasons: ['原因A'],
        },
      ],
    )

    const row = rows[0]
    // 2026-11-10 用户拍板：导出列 =《省代表回访-导出字段.xlsx》21 列（按键序断言）
    expect(Object.keys(row)).toEqual([
      '数据月份', '客户名称', '客户编码', '登录账号名称', '产品名称', '相应投诉工单',
      '客户反馈', '回访结果', '内部评估', '经办人', '备注', '确立举措', '举措详情', '排期',
      '建议触发类型', '7分以下总次数', '7分以下分布', '原话命中条数', '低分原因命中条数',
      '最近反馈时间', '涉及渠道',
    ])
    expect(row.数据月份).toBe('2026-05')
    expect(row.客户名称).toBe('中国铁塔')
    expect(row.产品名称).toBe('云主机')
    // 客户反馈列内容 = 导入列表中的客户反馈列（userFeedbackText）
    expect(row.客户反馈).toBe('希望增加导出功能')
    expect(row.回访结果).toBe('已回访')
    expect(row.内部评估).toBe('建议跟进')
    expect(row.建议触发类型).toBe('7分以下重点客户')
    expect(row['7分以下总次数']).toBe(2)
    expect(row['涉及渠道']).toBe('短信；控制台')
    expect(row['最近反馈时间']).toBe('2026-05-21 10:00:00')
    // 已移除列（需求文件无）不得回潮
    expect(row).not.toHaveProperty('集团名称')
    expect(row).not.toHaveProperty('建议回访原因')
    expect(row).not.toHaveProperty('客户原话1')
    expect(row).not.toHaveProperty('低分原因1')
  })

  it('相应投诉工单仅在评分来源=投诉回访时有值', () => {
    const rows = buildPostUseCustomerVisitRows([
      { importMonth: '2026-05', customerName: '甲', productName: '云主机', scoreSource: '投诉回访', originalTicketId: 'T-100' },
      { importMonth: '2026-05', customerName: '乙', productName: '云主机', originalTicketId: 'T-200' },
    ], [])
    expect(rows[0].相应投诉工单).toBe('T-100')
    expect(rows[1].相应投诉工单).toBe('')
  })

  it('keeps multiple visit actions aligned in the existing export columns', () => {
    const rows = buildPostUseCustomerVisitRows(
      [{ actionIds: ['v1', 'v2'], actionId: 'v1' }],
      [],
      new Map([
        ['v1', { content: '补充指引', detail: '先做文档', scheduleAt: '' }],
        ['v2', { content: '联系客户', detail: '', scheduleAt: '2026-12-02' }],
      ]),
    )
    expect(rows[0].确立举措).toBe('1. 补充指引\n2. 联系客户')
    expect(rows[0].举措详情).toBe('1. 先做文档\n2. —')
    expect(rows[0].排期).toBe('1. —\n2. 2026-12-02')
  })
})
