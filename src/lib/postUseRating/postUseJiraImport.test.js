import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  POST_USE_JIRA_IMPORT_HEADERS,
  parsePostUseJiraImportWorkbook,
  postUseJiraImportItemKey,
} from './postUseJiraImport.js'
import { buildPostUseJiraExportRows } from './postUseJiraExport.js'

function workbook(rows, headers = POST_USE_JIRA_IMPORT_HEADERS) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), '产品部溯源')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

const row = (overrides = {}) => ({
  数据月份: '2026-10',
  客户名称: '测试客户',
  客户编码: 'C-101',
  登录账号名称: '',
  产品名称: '弹性公网IP',
  客户反馈: '客户反馈内容',
  建议回访原因: '低分',
  相应投诉工单: '',
  经办人: 'operator',
  状态: '已处理',
  回溯结果: '处理完毕',
  确立举措: '',
  举措详情: '',
  排期: '',
  ...overrides,
})

function asCells(record) {
  return POST_USE_JIRA_IMPORT_HEADERS.map((header) => record[header])
}

describe('产品部溯源导出表回导解析', () => {
  it('reads the existing 14-column export and uses the production item key', () => {
    const exported = buildPostUseJiraExportRows([{
      importMonth: '2026-09、2026-10', customerName: '测试客户', customerCode: 'C-101',
      productName: '弹性公网IP', customerFeedback: '反馈', assigneeName: 'operator',
      status: '已处理', progress: '处理完毕',
    }])
    expect(Object.keys(exported[0])).toEqual(POST_USE_JIRA_IMPORT_HEADERS)
    const result = parsePostUseJiraImportWorkbook(workbook(exported.map(asCells)))
    expect(result.errors).toEqual([])
    expect(result.items).toHaveLength(1)
    expect(postUseJiraImportItemKey(result.items[0])).toBe('q:C-101:弹性公网IP:2026-09|2026-10')
  })

  it('parses numbered multi-actions and complaint ticket identity', () => {
    const result = parsePostUseJiraImportWorkbook(workbook([asCells(row({
      相应投诉工单: 'T-100',
      确立举措: '1. 校验配置\n2. 增加告警',
      举措详情: '1. 检查端口\n2. —',
      排期: '1. 2026-12-01\n2. —',
    }))]))
    expect(result.errors).toEqual([])
    expect(postUseJiraImportItemKey(result.items[0])).toBe('c:T-100')
    expect(result.items[0].actions).toEqual([
      { content: '校验配置', detail: '检查端口', scheduleAt: '2026-12-01' },
      { content: '增加告警', detail: '', scheduleAt: '' },
    ])
  })

  it('blocks the whole file when a header, status, or identity is invalid', () => {
    const missingHeader = parsePostUseJiraImportWorkbook(workbook([asCells(row())], POST_USE_JIRA_IMPORT_HEADERS.slice(0, -1)))
    expect(missingHeader.errors[0].message).toContain('缺少表头')
    const invalid = parsePostUseJiraImportWorkbook(workbook([
      asCells(row()),
      asCells(row({ 状态: '不明' })),
      asCells(row()),
    ]))
    expect(invalid.items).toHaveLength(1)
    expect(invalid.errors.map((item) => item.row)).toEqual([3, 4])
  })
})
