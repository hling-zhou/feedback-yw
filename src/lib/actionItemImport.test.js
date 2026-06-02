import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  normalizeActionItemImportHeader,
  normalizeActionItemImportRow,
  parseActionItemImportRow,
  parseActionItemImportWorkbook,
  parseLinkedDataSourcesCell,
  parseLinkedTicketIdsCell,
} from './actionItemImport.js'
import { ACTION_ITEM_IMPORT_TEMPLATE_HEADERS } from './actionItemImportTemplate.js'

describe('actionItemImport', () => {
  it('parseLinkedTicketIdsCell splits by newline and comma', () => {
    expect(parseLinkedTicketIdsCell('T-1\nT-2,T-3')).toEqual(['T-1', 'T-2', 'T-3'])
  })

  it('parseLinkedDataSourcesCell maps labels', () => {
    expect(parseLinkedDataSourcesCell('投诉工单、咨询工单')).toEqual([
      'complaint_ticket',
      'consultation_ticket',
    ])
  })

  it('parseActionItemImportRow allows empty optional fields', () => {
    const parsed = parseActionItemImportRow(
      { 举措: '补充文档', 产品名称: 'VPC' },
      { firstProposedAt: '2026-05-10' },
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.item.content).toBe('补充文档')
      expect(parsed.item.problemTypeSnapshot).toBe('')
      expect(parsed.item.journeyL1Snapshot).toBe('')
      expect(parsed.item.linkedTicketIds).toEqual([])
      expect(parsed.item.linkedDataSources).toEqual([])
      expect(parsed.item.firstProposedAt).toBe('2026-05-10')
    }
  })

  it('parseActionItemImportWorkbook reads 举措清单 sheet', () => {
    const wb = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet([
      {
        产品名称: 'VPC',
        举措: '优化控制台',
        问题类型: '',
        用户旅程一级: '',
        来源: '',
        '关联工单(本周期)': '',
      },
    ])
    XLSX.utils.book_append_sheet(wb, sheet, '举措清单')
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const result = parseActionItemImportWorkbook(buffer, { firstProposedAt: '2026-05-11' })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].content).toBe('优化控制台')
    expect(result.rows[0].firstProposedAt).toBe('2026-05-11')
  })

  it('normalizeActionItemImportHeader strips template suffixes', () => {
    expect(normalizeActionItemImportHeader('举措*（必填）')).toBe('举措')
    expect(normalizeActionItemImportHeader('问题（可选）')).toBe('问题')
  })

  it('parseActionItemImportRow accepts template headers and empty 问题', () => {
    const row = normalizeActionItemImportRow(
      Object.fromEntries(ACTION_ITEM_IMPORT_TEMPLATE_HEADERS.map((h) => [h, ''])),
    )
    row['举措'] = '补充文档说明'
    const parsed = parseActionItemImportRow(row, { firstProposedAt: '2026-06-01' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.item.content).toBe('补充文档说明')
      expect(parsed.item.painPointSnapshot).toBe('')
    }
  })
})
