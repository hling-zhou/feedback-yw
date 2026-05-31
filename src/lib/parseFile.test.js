import { describe, expect, it } from 'vitest'
import {
  applyDefaultTicketIdMapping,
  guessColumnMap,
  resolveTicketIdHeader,
} from './parseFile.js'

describe('parseFile ticketId mapping', () => {
  it('resolveTicketIdHeader prefers 工单展示流水号 over 工单流水号', () => {
    expect(
      resolveTicketIdHeader(['工单流水号', '工单展示流水号', '处理意见']),
    ).toBe('工单展示流水号')
  })

  it('resolveTicketIdHeader uses 工单流水号 when display column absent', () => {
    expect(resolveTicketIdHeader(['工单流水号', '处理意见'])).toBe('工单流水号')
  })

  it('applyDefaultTicketIdMapping sets primary header for complaint import', () => {
    const headers = ['工单展示流水号', '处理意见', '受理内容']
    expect(
      applyDefaultTicketIdMapping(headers, {}, 'complaint_ticket').ticketId,
    ).toBe('工单展示流水号')
  })

  it('applyDefaultTicketIdMapping does not override valid mapping', () => {
    const headers = ['工单展示流水号', '工单流水号', '处理意见']
    expect(
      applyDefaultTicketIdMapping(
        headers,
        { ticketId: '工单流水号' },
        'complaint_ticket',
      ).ticketId,
    ).toBe('工单流水号')
  })

  it('guessColumnMap applies default when only 工单展示流水号 present', () => {
    const headers = ['工单展示流水号', '受理内容', '处理意见']
    const map = guessColumnMap(headers, 'complaint_ticket')
    expect(map.ticketId).toBe('工单展示流水号')
  })

  it('guessColumnMap auto-detects 移动云客户服务等级 column', () => {
    const headers = ['工单展示流水号', '受理内容', '处理意见', '移动云客户服务等级']
    const map = guessColumnMap(headers, 'complaint_ticket')
    expect(map.customerTierCol).toBe('移动云客户服务等级')
  })

  it('guessColumnMap falls back to 客户等级 when standard column absent', () => {
    const headers = ['工单展示流水号', '受理内容', '处理意见', '客户等级']
    const map = guessColumnMap(headers, 'complaint_ticket')
    expect(map.customerTierCol).toBe('客户等级')
  })
})
