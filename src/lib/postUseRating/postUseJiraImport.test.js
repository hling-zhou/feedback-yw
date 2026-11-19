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
  // 2026-11-19 导出新增优化建议两列（末位）：回导按必需表头取值，额外列天然跳过。
  // 模拟真实回导场景——导出表原样回传，含全部 16 列。
  return [...POST_USE_JIRA_IMPORT_HEADERS, '产品/技术优化（自动）', '服务/流程改进（自动）']
    .map((header) => record[header])
}

describe('产品部溯源导出表回导解析', () => {
  it('reads the existing 14-column export and uses the production item key', () => {
    const exported = buildPostUseJiraExportRows([/** @type {any} */ ({
      importMonth: '2026-09、2026-10', customerName: '测试客户', customerCode: 'C-101',
      productName: '弹性公网IP', customerFeedback: '反馈', assigneeName: 'operator',
      status: '已处理', progress: '处理完毕',
      optimizationProduct: '建议P', optimizationService: '建议S',
    })])
    // 2026-11-19 起导出 = 14 必需表头 + 优化建议两列（末位）
    expect(Object.keys(exported[0])).toEqual([
      ...POST_USE_JIRA_IMPORT_HEADERS,
      '产品/技术优化（自动）',
      '服务/流程改进（自动）',
    ])
    expect(exported[0]['产品/技术优化（自动）']).toBe('建议P')
    expect(exported[0]['服务/流程改进（自动）']).toBe('建议S')
    const result = parsePostUseJiraImportWorkbook(workbook(exported.map(asCells)))
    expect(result.errors).toEqual([])
    expect(result.items).toHaveLength(1)
    expect(postUseJiraImportItemKey(result.items[0])).toBe('q:C-101:弹性公网IP:2026-09|2026-10')
  })

  it('2026-11-19 守卫：导出表带优化建议两列直接回导——不报错、不回写、不影响行校验', () => {
    const rowWithOpt = row()
    const cells = asCells(rowWithOpt)
    // 尾部两列塞入手改建议（导出表被人工编辑的形态）
    cells[cells.length - 2] = '表里手改的建议P'
    cells[cells.length - 1] = '表里手改的建议S'
    const result = parsePostUseJiraImportWorkbook(workbook([cells]))
    // 不报错、行校验不受影响
    expect(result.errors).toEqual([])
    expect(result.items).toHaveLength(1)
    // 解析产物不含优化建议（HEADER_FIELDS 白名单映射，额外列不进产物）——
    // 库内建议只能由生成链路更新，导出表手改不回写
    const item = result.items[0]
    expect(item).not.toHaveProperty('optimizationProduct')
    expect(item).not.toHaveProperty('optimizationService')
    expect(item.customerFeedback).toBe('客户反馈内容')
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
