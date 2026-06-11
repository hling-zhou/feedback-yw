import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  REQUIREMENT_PROGRESS_IMPORT_HEADERS,
  REQUIREMENT_PROGRESS_SHEET_NAME,
} from '../domain/requirementTicketProgress.js'
import {
  buildRequirementProgressTemplateBuffer,
  parseRequirementProgressWorkbook,
} from './requirementTicketProgressImport.js'

describe('requirementTicketProgressImport', () => {
  it('parses new column headers from 需求工单进展 sheet', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      REQUIREMENT_PROGRESS_IMPORT_HEADERS,
      ['REQ-100', '云专线', '2026-05-14', '开发中'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, REQUIREMENT_PROGRESS_SHEET_NAME)
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

    const parsed = parseRequirementProgressWorkbook(buffer)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toEqual([
      {
        ticketId: 'REQ-100',
        product: '云专线',
        scheduleAt: '2026-05-14',
        workflowStatus: '开发中',
      },
    ])
  })

  it('ignores extra columns in import rows', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      [...REQUIREMENT_PROGRESS_IMPORT_HEADERS, '备注', '负责人'],
      ['REQ-200', 'VPC', '2026-06-30', '联调中', '忽略我', '张三'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, REQUIREMENT_PROGRESS_SHEET_NAME)
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

    const parsed = parseRequirementProgressWorkbook(buffer)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].ticketId).toBe('REQ-200')
    expect(parsed.rows[0].workflowStatus).toBe('联调中')
  })

  it('allows empty 操作状态 and invalid schedule reports row error', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      REQUIREMENT_PROGRESS_IMPORT_HEADERS,
      ['REQ-300', 'EIP', '', ''],
      ['REQ-301', 'SLB', 'not-a-date', '暂停'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, REQUIREMENT_PROGRESS_SHEET_NAME)
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

    const parsed = parseRequirementProgressWorkbook(buffer)
    expect(parsed.rows).toEqual([
      {
        ticketId: 'REQ-300',
        product: 'EIP',
        scheduleAt: '',
        workflowStatus: '',
      },
    ])
    expect(parsed.errors.some((err) => err.message.includes('REQ-301'))).toBe(true)
    expect(parsed.errors.some((err) => err.message.includes('计划完成时间'))).toBe(true)
  })

  it('buildRequirementProgressTemplateBuffer uses new headers', () => {
    const buffer = buildRequirementProgressTemplateBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const sheet = wb.Sheets[REQUIREMENT_PROGRESS_SHEET_NAME]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })
    expect(rows[0]).toEqual(REQUIREMENT_PROGRESS_IMPORT_HEADERS)
  })
})
