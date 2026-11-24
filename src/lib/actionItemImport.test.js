import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  normalizeActionItemImportHeader,
  normalizeActionItemImportRow,
  parseActionItemImportRow,
  parseActionItemImportWorkbook,
  parseActionItemSourceCell,
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

  describe('parseActionItemSourceCell（来源列 → 档位，2026-11-24 拍板）', () => {
    it('档名解析为对应 source', () => {
      expect(parseActionItemSourceCell('投诉/咨询')).toBe('ticket')
      expect(parseActionItemSourceCell('用后即评')).toBe('post_use')
      expect(parseActionItemSourceCell('API巡检')).toBe('api_patrol')
      expect(parseActionItemSourceCell('留观问题')).toBe('observation')
    })

    it('旧枚举标签映射到 投诉/咨询 档（用户拍板）', () => {
      expect(parseActionItemSourceCell('投诉工单')).toBe('ticket')
      expect(parseActionItemSourceCell('咨询工单')).toBe('ticket')
    })

    it('其他数据源标签与未知文本落默认 投诉/咨询 档', () => {
      expect(parseActionItemSourceCell('用户调研')).toBe('ticket')
      expect(parseActionItemSourceCell('其他')).toBe('ticket')
      expect(parseActionItemSourceCell('')).toBe('ticket')
      expect(parseActionItemSourceCell('随便写的')).toBe('ticket')
    })

    it('parseActionItemImportRow 将来源列写入 source（linkedDataSources 语义保留）', () => {
      const parsed = parseActionItemImportRow(
        { 举措: '巡检优化', 来源: 'API巡检', 产品名称: 'VPC' },
        { firstProposedAt: '2026-11-24' },
      )
      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        expect(parsed.item.source).toBe('api_patrol')
      }

      const legacy = parseActionItemImportRow(
        { 举措: '旧口径行', 来源: '投诉工单、咨询工单', 产品名称: 'VPC' },
        { firstProposedAt: '2026-11-24' },
      )
      expect(legacy.ok).toBe(true)
      if (legacy.ok) {
        expect(legacy.item.source).toBe('ticket')
        // linkedDataSources 原数据源语义不变（工单关联自动补齐/筛选依赖）
        expect(legacy.item.linkedDataSources).toEqual(['complaint_ticket', 'consultation_ticket'])
      }
    })
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
