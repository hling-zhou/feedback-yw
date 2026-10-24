import { describe, it, expect } from 'vitest'
import { buildPostUseJiraExportRows } from './postUseJiraExport.js'

describe('buildPostUseJiraExportRows', () => {
  it('builds 14-column rows from jira items', () => {
    const items = [
      {
        id: 'j1',
        importMonth: '2026-10',
        customerName: '测试客户',
        customerCode: 'C001',
        loginAccountName: 'user001',
        productName: '云专线',
        customerFeedback: '带宽不够',
        recommendedReason: '低分反馈',
        originalTicketId: 'TS001',
        scoreSource: '投诉回访',
        assigneeName: '张三',
        status: '进行中',
        progress: '已确认问题',
        actionId: 'act1',
      },
    ]
    const actionMap = new Map([
      ['act1', { content: '扩容带宽', detail: '从100M升级到500M', scheduleAt: '2026-11-01' }],
    ])
    const rows = buildPostUseJiraExportRows(items, actionMap)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row['数据月份']).toBe('2026-10')
    expect(row['客户名称']).toBe('测试客户')
    expect(row['客户编码']).toBe('C001')
    expect(row['登录账号名称']).toBe('user001')
    expect(row['产品名称']).toBe('云专线')
    expect(row['客户反馈']).toBe('带宽不够')
    expect(row['建议回访原因']).toBe('低分反馈')
    expect(row['相应投诉工单']).toBe('TS001')
    expect(row['经办人']).toBe('张三')
    expect(row['状态']).toBe('进行中')
    expect(row['进展']).toBe('已确认问题')
    expect(row['确立举措']).toBe('扩容带宽')
    expect(row['举措详情']).toBe('从100M升级到500M')
    expect(row['排期']).toBe('2026-11-01')
  })

  it('hides originalTicketId when scoreSource is not 投诉回访', () => {
    const items = [
      {
        originalTicketId: 'TS002',
        scoreSource: '官网问卷',
      },
    ]
    const rows = buildPostUseJiraExportRows(items, new Map())
    expect(rows[0]['相应投诉工单']).toBe('')
  })

  it('shows originalTicketId when scoreSource is 投诉回访', () => {
    const items = [
      {
        originalTicketId: 'TS003',
        scoreSource: '投诉回访',
      },
    ]
    const rows = buildPostUseJiraExportRows(items, new Map())
    expect(rows[0]['相应投诉工单']).toBe('TS003')
  })

  it('leaves action item fields empty when actionId is missing', () => {
    const items = [{ actionId: '' }]
    const rows = buildPostUseJiraExportRows(items, new Map())
    expect(rows[0]['确立举措']).toBe('')
    expect(rows[0]['举措详情']).toBe('')
    expect(rows[0]['排期']).toBe('')
  })

  it('leaves action item fields empty when actionItem not in map', () => {
    const items = [{ actionId: 'act_missing' }]
    const rows = buildPostUseJiraExportRows(items, new Map())
    expect(rows[0]['确立举措']).toBe('')
  })

  it('handles empty items array', () => {
    const rows = buildPostUseJiraExportRows([], new Map())
    expect(rows).toEqual([])
  })

  it('handles items with all empty fields', () => {
    const rows = buildPostUseJiraExportRows([{}], new Map())
    expect(rows[0]['数据月份']).toBe('')
    expect(rows[0]['客户名称']).toBe('')
    expect(rows[0]['经办人']).toBe('')
    expect(rows[0]['确立举措']).toBe('')
  })
})
