import { describe, expect, it } from 'vitest'

import {
  buildGeneralizationRecallText,
  deriveGeneralizationFtsQueries,
  generalizationKeywordsMatch,
  recallGeneralizationCandidates,
  resolveGeneralizationScanTargets,
} from './recall.js'

/**
 * 举一反三召回单测——TASKS G2-1 验收：
 * 同产品/跨产品召回均可触发；dismissed/confirmed 组合正确过滤（组合过滤由调用方预过滤 + putLink 矩阵，
 * 本层验证召回本身不因产品差异而漏）。
 */

const makeRecord = (overrides = {}) => ({
  id: 'rec-1',
  dataSourceType: 'complaint_ticket',
  productKey: 'eip',
  product: '弹性公网IP',
  ticketId: 'T100',
  painPoint: '批量删除安全组只成功一半',
  customerRequest: '想批量删除失败的那些',
  ...overrides,
})

const makeIssue = (overrides = {}) => ({
  issueId: 'gi-1',
  productKey: 'eip',
  title: '批量删除接口部分失败',
  summary: '批量操作部分成功无回滚',
  keywords: [],
  confirmedTicketIds: ['T100'],
  confirmedRecordIds: ['rec-1'],
  ...overrides,
})

/** searchRange 完整返回结构（对齐 server/assistantSearchIndex 返回类型） */
const makeFtsResult = (rows) => ({
  total: rows.length,
  results: rows.map((r) => ({
    recordId: r.recordId,
    ticketId: r.ticketId || 'T9',
    product: r.product || 'EIP',
    dataSourceType: r.dataSourceType || 'complaint_ticket',
    importMonth: r.importMonth || '2026-10',
    matchedField: r.matchedField || 'painPoint',
    snippet: r.snippet || '',
  })),
  truncated: false,
})

describe('resolveGeneralizationScanTargets（候选池只判投诉/咨询工单）', () => {
  it('投诉/咨询入选，评价与其他类型排除', () => {
    const targets = resolveGeneralizationScanTargets({
      records: [
        makeRecord(),
        makeRecord({ id: 'r2', dataSourceType: 'consultation_ticket' }),
        makeRecord({ id: 'r3', dataSourceType: 'post_use_rating', commentText: '不好用' }),
        makeRecord({ id: 'r4', dataSourceType: 'something_else' }),
        { id: '', dataSourceType: 'complaint_ticket' },
        null,
      ],
    })
    expect(targets).toHaveLength(2)
    expect(targets[0].recordDataSource).toBe('complaint_ticket')
    expect(targets[1].recordDataSource).toBe('consultation_ticket')
  })
})

describe('buildGeneralizationRecallText（工单画像：痛点 + 客户请求）', () => {
  it('两段拼接', () => {
    expect(buildGeneralizationRecallText(makeRecord())).toBe(
      '批量删除安全组只成功一半\n想批量删除失败的那些',
    )
  })

  it('problemSummary 兜底 + 空记录空串', () => {
    expect(buildGeneralizationRecallText({ problemSummary: '续费入口找不到' })).toBe(
      '续费入口找不到',
    )
    expect(buildGeneralizationRecallText(null)).toBe('')
  })
})

describe('generalizationKeywordsMatch / deriveGeneralizationFtsQueries', () => {
  it('关键词子串命中', () => {
    expect(generalizationKeywordsMatch('批量删除失败', ['批量删除'])).toBe(true)
    expect(generalizationKeywordsMatch('无关文本', ['批量删除'])).toBe(false)
    expect(generalizationKeywordsMatch('', ['x'])).toBe(false)
    expect(generalizationKeywordsMatch('text', ['', ' '])).toBe(false)
  })

  it('FTS 查询词取最长 4 个', () => {
    const queries = deriveGeneralizationFtsQueries('短词。批量删除安全组失败！客户想批量删除失败的那些')
    expect(queries.length).toBeLessThanOrEqual(4)
    expect(queries[0].length).toBeGreaterThanOrEqual(queries[queries.length - 1].length)
  })

  it('空文本空数组', () => {
    expect(deriveGeneralizationFtsQueries('  ')).toEqual([])
  })
})

describe('recallGeneralizationCandidates（两通道 + 全库召回）', () => {
  const target = {
    recordId: 'rec-1',
    recordDataSource: 'complaint_ticket',
    productKey: 'eip',
    ticketId: 'T100',
  }

  it('keywords 通道命中（同产品）', () => {
    const hits = recallGeneralizationCandidates({
      target,
      record: makeRecord(),
      issues: [makeIssue({ keywords: ['批量删除'] })],
      deps: { searchRange: () => makeFtsResult([]) },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ issueId: 'gi-1', channel: 'keywords', confidence: 'medium' })
    expect(hits[0].excerpt).toContain('批量删除')
  })

  it('跨产品召回：不同 productKey 的 issue 照样命中（v3.2 全库）', () => {
    const crossProductIssue = makeIssue({
      issueId: 'gi-vpn',
      productKey: 'vpn', // 与记录产品 eip 不同
      keywords: ['批量删除'],
    })
    const hits = recallGeneralizationCandidates({
      target,
      record: makeRecord(),
      issues: [crossProductIssue],
      deps: { searchRange: () => makeFtsResult([]) },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].issueId).toBe('gi-vpn')
  })

  it('FTS 通道：命中记录反查 confirmed issue（无 keywords 时兜底）', () => {
    const hits = recallGeneralizationCandidates({
      target,
      record: makeRecord(),
      issues: [makeIssue({ keywords: [], confirmedRecordIds: ['rec-9'] })],
      deps: {
        searchRange: () => makeFtsResult([{ recordId: 'rec-9', snippet: '批量删除安全组只成功一半' }]),
      },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ issueId: 'gi-1', channel: 'fts', confidence: 'medium' })
    expect(hits[0].excerpt).toContain('字面命中')
  })

  it('keywords 优先于 fts（同 issue 双通道命中时保留 keywords）', () => {
    const hits = recallGeneralizationCandidates({
      target,
      record: makeRecord(),
      issues: [makeIssue({ keywords: ['批量删除'], confirmedRecordIds: ['rec-9'] })],
      deps: {
        searchRange: () => makeFtsResult([{ recordId: 'rec-9', snippet: '字面' }]),
      },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].channel).toBe('keywords')
  })

  it('FTS 检索异常静默降级（不炸整批）', () => {
    const hits = recallGeneralizationCandidates({
      target,
      record: makeRecord(),
      issues: [makeIssue({ keywords: [] })],
      deps: {
        searchRange: () => {
          throw new Error('fts down')
        },
      },
    })
    expect(hits).toEqual([])
  })

  it('无 issue / 无画像文本 → 空数组', () => {
    expect(recallGeneralizationCandidates({ target, record: makeRecord(), issues: [] })).toEqual([])
    expect(
      recallGeneralizationCandidates({
        target,
        record: { id: 'r', dataSourceType: 'complaint_ticket' },
        issues: [makeIssue()],
        deps: { searchRange: () => makeFtsResult([]) },
      }),
    ).toEqual([])
  })

  it('无锚点通道：originalTicketId 不参与（gen 与留观的差异点）', () => {
    const hits = recallGeneralizationCandidates({
      target: /** @type {any} */ ({ ...target, originalTicketId: 'T100' }), // 即便传了也忽略
      record: makeRecord(),
      issues: [makeIssue({ keywords: [], confirmedTicketIds: ['T100'] })],
      deps: { searchRange: () => makeFtsResult([]) },
    })
    expect(hits).toEqual([]) // 锚点不命中（留观版此处会 high）
  })
})
