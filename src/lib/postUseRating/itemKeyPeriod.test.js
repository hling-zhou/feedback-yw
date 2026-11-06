import { describe, expect, it } from 'vitest'
import {
  allMatchingKeys,
  extractItemKeyMonths,
  itemKeySubsetMatches,
  lookupBySubset,
} from './itemKeyPeriod.js'

describe('itemKeyPeriod（周期包含语义，2026-11-06 拍板）', () => {
  it('extractItemKeyMonths：q: 键月份段提取与排序；旧格式/非 q: 键返回空', () => {
    expect(extractItemKeyMonths('q:C1:弹性公网IP:2026-07')).toEqual(['2026-07'])
    expect(extractItemKeyMonths('q:C1:弹性公网IP:2026-08|2026-07')).toEqual(['2026-07', '2026-08'])
    // 旧格式（无月份段）
    expect(extractItemKeyMonths('q:C1:弹性公网IP')).toEqual([])
    // c: 工单键无月份
    expect(extractItemKeyMonths('c:T-001')).toEqual([])
  })

  it('itemKeySubsetMatches：存储键月份 ⊆ 行键月份 即匹配（7 月勾选对 Q3 行可见）', () => {
    const q3 = 'q:C1:弹性公网IP:2026-07|2026-08|2026-09'
    // 被包含：单月/双月子集
    expect(itemKeySubsetMatches(q3, 'q:C1:弹性公网IP:2026-07')).toBe(true)
    expect(itemKeySubsetMatches(q3, 'q:C1:弹性公网IP:2026-08|2026-09')).toBe(true)
    // 精确相等
    expect(itemKeySubsetMatches(q3, q3)).toBe(true)
    // 不被包含：月份超出（9 月键对 7|8 行不可见——反向不含，拍板 2）
    expect(itemKeySubsetMatches('q:C1:弹性公网IP:2026-07|2026-08', 'q:C1:弹性公网IP:2026-09')).toBe(false)
    // 旧格式键（无月份段）视为任意周期可见（迁移残留兼容）
    expect(itemKeySubsetMatches(q3, 'q:C1:弹性公网IP')).toBe(true)
    // 不同客户/产品不匹配（前缀不同）
    expect(itemKeySubsetMatches(q3, 'q:C2:弹性公网IP:2026-07')).toBe(false)
    // 行键为旧格式（无月份段）→ 除精确相等外不匹配
    expect(itemKeySubsetMatches('q:C1:弹性公网IP', 'q:C1:弹性公网IP:2026-07')).toBe(false)
  })

  it('lookupBySubset：任一月勾选 → Q3 行命中（合并规则：hits.some）', () => {
    const decisions = new Map([
      ['q:C1:弹性公网IP:2026-07', { needCustomerVisit: true, needInternalTrace: false }],
      ['q:C1:弹性公网IP:2026-08', { needCustomerVisit: false, needInternalTrace: true }],
    ])
    const q3 = 'q:C1:弹性公网IP:2026-07|2026-08|2026-09'
    const hits = lookupBySubset(decisions, q3)
    expect(hits).toHaveLength(2)
    // decisionOf 同款合并语义：任一月勾选 → 显示勾选
    expect(hits.some((d) => d.needCustomerVisit)).toBe(true)
    expect(hits.some((d) => d.needInternalTrace)).toBe(true)
  })

  it('lookupBySubset：7 月行看不到 8 月勾选（反向不包含，按月独立保留）', () => {
    const decisions = new Map([
      ['q:C1:弹性公网IP:2026-08', { needCustomerVisit: true, needInternalTrace: false }],
    ])
    const july = 'q:C1:弹性公网IP:2026-07'
    expect(lookupBySubset(decisions, july)).toHaveLength(0)
  })

  it('allMatchingKeys：Q3 行取消勾选 → 命中键含行键与全部被包含子集键', () => {
    const decisions = new Map([
      ['q:C1:弹性公网IP:2026-07', { needCustomerVisit: true, needInternalTrace: false }],
      ['q:C1:弹性公网IP:2026-08', { needCustomerVisit: true, needInternalTrace: false }],
      ['q:C2:弹性公网IP:2026-07', { needCustomerVisit: true, needInternalTrace: false }],
    ])
    const q3 = 'q:C1:弹性公网IP:2026-07|2026-08|2026-09'
    expect(allMatchingKeys(decisions, q3)).toEqual([
      'q:C1:弹性公网IP:2026-07',
      'q:C1:弹性公网IP:2026-08',
    ])
    // 行键本身不在 map 时不出现在结果里（写 false 时由 persist 层补写行键）
    expect(allMatchingKeys(decisions, q3)).not.toContain(q3)
    // 其他客户的子集键不误伤
    expect(allMatchingKeys(decisions, q3)).not.toContain('q:C2:弹性公网IP:2026-07')
  })
})
