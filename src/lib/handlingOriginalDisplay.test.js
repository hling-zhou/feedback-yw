import { describe, expect, it } from 'vitest'
import {
  countHandlingKeywordHitsInGroup,
  defaultExpandedPhaseIds,
  groupHandlingOriginalByPhase,
  mergeHighlightRanges,
  phaseIdsMatchingKeyword,
  segmentHandlingOriginalText,
  shouldUseStructuredHandlingDisplay,
  splitTextWithManualHighlights,
} from './handlingOriginalDisplay.js'

/**
 * @param {string} raw
 * @param {{ text: string }[]} segments
 */
function expectTextsAreSubstrings(raw, segments) {
  for (const seg of segments) {
    if (!seg.text) continue
    expect(raw.includes(seg.text), `missing substring: ${JSON.stringify(seg.text.slice(0, 40))}`).toBe(
      true,
    )
  }
}

describe('segmentHandlingOriginalText', () => {
  it('splits newline-separated labeled fields', () => {
    const raw = '客户问题：无法访问\n处理意见：已放行端口'
    const segments = segmentHandlingOriginalText(raw)
    expect(shouldUseStructuredHandlingDisplay(segments)).toBe(true)
    expect(segments).toEqual([
      { kind: 'field', label: '客户问题', text: '无法访问\n' },
      { kind: 'field', label: '处理意见', text: '已放行端口' },
    ])
    expectTextsAreSubstrings(raw, segments)
  })

  it('splits glued numbered bracket fields', () => {
    const raw =
      '1、【客户问题】:客户反应，带宽问题，请排查原因2、【问题原因】:同上'
    const segments = segmentHandlingOriginalText(raw)
    expect(segments.some((s) => s.kind === 'field' && s.label === '1、客户问题')).toBe(true)
    expect(segments.some((s) => s.kind === 'field' && s.label === '2、问题原因')).toBe(true)
    const problem = segments.find((s) => s.label === '1、客户问题')
    expect(problem?.text).toBe('客户反应，带宽问题，请排查原因')
    expect(segments.find((s) => s.label === '2、问题原因')?.text).toBe('同上')
    expectTextsAreSubstrings(raw, segments)
  })

  it('splits multi-phase workflow handling blocks', () => {
    const raw = [
      '开始&客服组.南基客服专席组-01L0&处理意见：客户标签：请求节点：全局流转详细内容：客户反应，带宽问题联系时间：9:00',
      '',
      '首处理&客服组.01&处理意见：1、客户需求：客户反应，带宽问题2、产品UUID：36.*.*.128',
      '',
      '反馈&客服组.01&处理意见：您好!关于您反映的问题，经过核实未发现异常。',
    ].join('\n')

    const segments = segmentHandlingOriginalText(raw)
    expect(shouldUseStructuredHandlingDisplay(segments)).toBe(true)
    const phases = segments.filter((s) => s.kind === 'phase')
    expect(phases.map((p) => p.label)).toEqual([
      '开始&客服组.南基客服专席组-01L0',
      '首处理&客服组.01',
      '反馈&客服组.01',
    ])
    expect(segments.some((s) => s.kind === 'field' && s.label === '详细内容')).toBe(true)
    expect(segments.some((s) => s.kind === 'field' && s.label === '1、客户需求')).toBe(true)
    expectTextsAreSubstrings(raw, segments)
  })

  it('falls back to a single plain block for unstructured prose', () => {
    const raw = '已协助客户调整安全组并复测通过，业务恢复正常。'
    const segments = segmentHandlingOriginalText(raw)
    expect(segments).toEqual([{ kind: 'plain', text: raw }])
    expect(shouldUseStructuredHandlingDisplay(segments)).toBe(false)
  })

  it('returns empty array for blank input', () => {
    expect(segmentHandlingOriginalText('')).toEqual([])
    expect(segmentHandlingOriginalText('   ')).toEqual([])
  })
})

describe('groupHandlingOriginalByPhase', () => {
  it('groups multi-phase flat segments by phase label', () => {
    const raw = [
      '开始&客服组.A&处理意见：详细内容：带宽问题',
      '',
      '首处理&客服组.B&处理意见：1、客户需求：带宽问题',
      '',
      '协办&网络组&处理意见：排查中',
      '',
      '反馈&客服组.B&处理意见：已恢复',
    ].join('\n')
    const segments = segmentHandlingOriginalText(raw)
    const groups = groupHandlingOriginalByPhase(segments)
    expect(groups).toHaveLength(4)
    expect(groups.map((g) => g.label)).toEqual([
      '开始&客服组.A',
      '首处理&客服组.B',
      '协办&网络组',
      '反馈&客服组.B',
    ])
    expect(groups[0].items.some((item) => item.label === '详细内容')).toBe(true)
    expect(defaultExpandedPhaseIds(groups)).toEqual(groups.map((g) => g.id))
  })

  it('puts field-only segments into a single 正文 group', () => {
    const segments = segmentHandlingOriginalText('客户问题：无法访问\n处理意见：已放行端口')
    const groups = groupHandlingOriginalByPhase(segments)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('正文')
    expect(groups[0].items).toHaveLength(2)
    expect(defaultExpandedPhaseIds(groups)).toEqual([groups[0].id])
  })

  it('defaultExpandedPhaseIds expands all when fewer than 5 groups, else first and last', () => {
    expect(defaultExpandedPhaseIds([{ id: 'a', label: 'A', items: [] }])).toEqual(['a'])
    expect(
      defaultExpandedPhaseIds([
        { id: 'a', label: 'A', items: [] },
        { id: 'b', label: 'B', items: [] },
        { id: 'c', label: 'C', items: [] },
        { id: 'd', label: 'D', items: [] },
      ]),
    ).toEqual(['a', 'b', 'c', 'd'])
    expect(
      defaultExpandedPhaseIds([
        { id: 'a', label: 'A', items: [] },
        { id: 'b', label: 'B', items: [] },
        { id: 'c', label: 'C', items: [] },
        { id: 'd', label: 'D', items: [] },
        { id: 'e', label: 'E', items: [] },
      ]),
    ).toEqual(['a', 'e'])
  })

  it('counts keyword hits and matching phase ids', () => {
    const groups = [
      {
        id: 'phase-1',
        label: '开始&客服',
        items: [{ kind: 'field', label: '详细内容', text: '带宽打满' }],
      },
      {
        id: 'phase-2',
        label: '反馈&客服',
        items: [{ kind: 'plain', text: '已恢复正常' }],
      },
    ]
    expect(countHandlingKeywordHitsInGroup(groups[0], '带宽')).toBe(1)
    expect(phaseIdsMatchingKeyword(groups, '带宽')).toEqual(['phase-1'])
    expect(phaseIdsMatchingKeyword(groups, '恢复')).toEqual(['phase-2'])
    expect(phaseIdsMatchingKeyword(groups, '不存在')).toEqual([])
  })
})

describe('manual highlight ranges', () => {
  it('merges overlapping and adjacent ranges', () => {
    expect(
      mergeHighlightRanges([
        { start: 0, end: 3 },
        { start: 2, end: 5 },
        { start: 8, end: 10 },
        { start: 10, end: 12 },
      ]),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 8, end: 12 },
    ])
  })

  it('splits text into original substrings with manual flags', () => {
    const text = 'ABCDEFGHIJ'
    const slices = splitTextWithManualHighlights(text, [
      { start: 2, end: 5 },
      { start: 7, end: 9 },
    ])
    expect(slices).toEqual([
      { text: 'AB', manual: false },
      { text: 'CDE', manual: true },
      { text: 'FG', manual: false },
      { text: 'HI', manual: true },
      { text: 'J', manual: false },
    ])
    expect(slices.map((s) => s.text).join('')).toBe(text)
  })
})
