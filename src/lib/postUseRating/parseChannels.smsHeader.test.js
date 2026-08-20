import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  parseSmsChannelWorkbook,
  parseOfficialChannelWorkbook,
  normalizeSmsRows,
  normalizeConsoleScoreRows,
  normalizeCallbackRows,
  SMS_SHEET_NAME,
  SMS_STATUS_HEADER,
  WEB_PRODUCT_HEADER,
  WEB_CALLBACK_TICKET_HEADER,
  WEB_SCORE_SHEET,
  WEB_OPTION_SHEET,
  WEB_CALLBACK_SHEET,
} from './parseChannels.js'

function sheetBuffer(sheets) {
  const wb = XLSX.utils.book_new()
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

function smsBuffer(aoa) {
  return sheetBuffer({ [SMS_SHEET_NAME]: aoa })
}

const HEADER = ['产品名称', SMS_STATUS_HEADER, '得分（加权）', '集团客户名称']
const MATCHED = ['弹性公网IP', '客户已反馈', '10', '甲公司']
const SKIPPED = ['云主机 ECS', '未反馈', '9', '乙公司']

describe('parseSmsChannelWorkbook header detection', () => {
  it('finds 调研结果状态 on the first row (xlsx without title rows)', () => {
    const parsed = parseSmsChannelWorkbook(smsBuffer([HEADER, MATCHED, SKIPPED]))
    expect(parsed.error).toBe('')
    expect(parsed.headers).toContain(SMS_STATUS_HEADER)
    expect(normalizeSmsRows(parsed.rows)).toEqual([
      expect.objectContaining({ productName: '弹性公网IP', score: 10, customerName: '甲公司' }),
    ])
  })

  it('still finds 调研结果状态 when it sits on the 3rd row (legacy xls layout)', () => {
    const parsed = parseSmsChannelWorkbook(
      smsBuffer([['短信渠道用后即评明细数据'], ['导出时间：2026-08'], HEADER, MATCHED, SKIPPED]),
    )
    expect(parsed.headers).toContain(SMS_STATUS_HEADER)
    expect(normalizeSmsRows(parsed.rows)).toHaveLength(1)
    expect(normalizeSmsRows(parsed.rows)[0].productName).toBe('弹性公网IP')
  })

  it('finds 调研结果状态 below extra title rows', () => {
    const parsed = parseSmsChannelWorkbook(
      smsBuffer([
        ['标题'],
        ['说明'],
        ['导出信息'],
        HEADER,
        MATCHED,
        ['虚拟私有云', '客户已反馈', '8', '丙公司'],
      ]),
    )
    expect(normalizeSmsRows(parsed.rows).map((row) => row.productName)).toEqual([
      '弹性公网IP',
      '虚拟私有云',
    ])
  })
})

const WEB_SCORE_HEADER = [WEB_PRODUCT_HEADER, '得分', '集团客户名称', '填答时间']
const WEB_SCORE_ROW = ['弹性公网IP', '9', '甲公司', '2026-08-01 10:00:00']

describe('parseOfficialChannelWorkbook header detection', () => {
  it('finds 产品名 on the first row', () => {
    const parsed = parseOfficialChannelWorkbook(
      sheetBuffer({
        [WEB_SCORE_SHEET]: [WEB_SCORE_HEADER, WEB_SCORE_ROW],
        [WEB_CALLBACK_SHEET]: [['回访工单编号', '是否回访成功'], ['T1', '是']],
      }),
    )
    expect(parsed.error).toBe('')
    expect(parsed.score?.headers).toContain(WEB_PRODUCT_HEADER)
    expect(normalizeConsoleScoreRows(parsed.score?.rows || [])).toEqual([
      expect.objectContaining({ productName: '弹性公网IP', score: 9 }),
    ])
  })

  it('finds 产品名 below title rows on 评分类', () => {
    const parsed = parseOfficialChannelWorkbook(
      sheetBuffer({
        [WEB_SCORE_SHEET]: [['官网评分类'], ['导出时间'], WEB_SCORE_HEADER, WEB_SCORE_ROW],
        [WEB_OPTION_SHEET]: [['选项类'], [WEB_PRODUCT_HEADER, '题型', '客户回答'], ['云主机 ECS', '评分题', '10']],
      }),
    )
    expect(parsed.score?.headers).toContain(WEB_PRODUCT_HEADER)
    expect(normalizeConsoleScoreRows(parsed.score?.rows || [])).toHaveLength(1)
    expect(parsed.option?.headers).toContain(WEB_PRODUCT_HEADER)
    expect(parsed.option?.rows[0][WEB_PRODUCT_HEADER]).toBe('云主机 ECS')
  })

  it('finds 回访工单编号 below title rows on 投诉处理-电话回访', () => {
    const parsed = parseOfficialChannelWorkbook(
      sheetBuffer({
        [WEB_CALLBACK_SHEET]: [
          ['投诉处理-电话回访'],
          ['导出时间：2026-08'],
          [
            WEB_CALLBACK_TICKET_HEADER,
            '是否回访成功',
            '具体投诉产品',
            '请您对本次投诉的整体服务情况进行评价',
          ],
          ['T1', '是', '弹性公网IP', '10'],
        ],
      }),
    )
    expect(parsed.callback?.headers).toContain(WEB_CALLBACK_TICKET_HEADER)
    expect(normalizeCallbackRows(parsed.callback?.rows || [])).toEqual([
      expect.objectContaining({ followUpTicketId: 'T1', productName: '弹性公网IP', score: 10 }),
    ])
  })
})
