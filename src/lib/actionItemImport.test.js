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
      expect(parsed.item.linkedRequirementTicketIds).toEqual([])
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
        来源: '',
        '关联反馈(本周期)': '',
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

  it('parseActionItemImportRow reads detail and requirement tickets', () => {
    const parsed = parseActionItemImportRow({
      举措: '补充文档',
      举措详情: '分阶段说明',
      需求工单: 'REQ-1, REQ-2',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.item.detail).toBe('分阶段说明')
      expect(parsed.item.linkedRequirementTicketIds).toEqual(['REQ-1', 'REQ-2'])
      expect(parsed.item.status).toBe('pending_evaluation')
      expect(parsed.item.scheduleAt).toBe('')
    }
  })

  it('parseActionItemImportRow ignores schedule and status when requirement tickets are present', () => {
    const parsed = parseActionItemImportRow({
      举措: '关联需求',
      需求工单: 'REQ-9',
      排期时间: '2026-08-01',
      状态: '进行中',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.item.status).toBe('pending_evaluation')
    expect(parsed.item.scheduleAt).toBe('')
    expect(parsed.warnings).toEqual([
      '已填需求工单，排期时间列已忽略',
      '已填需求工单，状态列已忽略',
    ])
  })

  it('parseActionItemImportWorkbook collects requirement-link warnings', () => {
    const wb = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet([
      {
        举措: '优化项',
        需求工单: 'REQ-1',
        排期时间: '2026-09-01',
        状态: '进行中',
      },
    ])
    XLSX.utils.book_append_sheet(wb, sheet, '举措清单')
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const result = parseActionItemImportWorkbook(buffer, { firstProposedAt: '2026-06-01' })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].linkedRequirementTicketIds).toEqual(['REQ-1'])
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings[0].row).toBe(2)
  })
})
