import { describe, expect, it } from 'vitest'
import {
  blobMatchesTopicQuery,
  dnfGroupsToLayers,
  formatTopicMatchLayers,
  parseTopicSearchQuery,
} from './matchQuery.js'

const HINTS = ['弹性公网ip', '云主机']

describe('dnfGroupsToLayers', () => {
  it('turns alternative AND groups into AND of OR layers', () => {
    expect(dnfGroupsToLayers([['配额', '申请'], ['配额', '不足']])).toEqual([
      { terms: ['配额'] },
      { terms: ['申请', '不足'] },
    ])
  })

  it('keeps a single compound as AND layers', () => {
    expect(dnfGroupsToLayers([['带宽', '限速']])).toEqual([
      { terms: ['带宽'] },
      { terms: ['限速'] },
    ])
  })
})

describe('parseTopicSearchQuery', () => {
  it('places product and 带宽/限速 on separate AND layers', () => {
    const parsed = parseTopicSearchQuery('弹性公网IP带宽限速', { productHints: HINTS })
    expect(parsed.productName).toBe('弹性公网ip')
    expect(parsed.problemText).toBe('带宽限速')
    expect(parsed.layers[0].terms).toEqual(['弹性公网ip'])
    expect(parsed.layers.slice(1).map((layer) => layer.terms.join('')).sort()).toEqual(['带宽', '限速'])
    expect(parsed.layers.slice(1).every((layer) => layer.terms.length === 1)).toBe(true)
  })

  it('factors 配额申请与配额不足 into 配额 AND (申请 OR 不足)', () => {
    const parsed = parseTopicSearchQuery('配额申请与配额不足问题分析', { productHints: HINTS })
    expect(parsed.problemText).toBe('配额申请与配额不足')
    expect(parsed.tokens).not.toEqual(expect.arrayContaining(['与配', '额不', '足问', '题分']))
    expect(parsed.layers).toEqual([
      { terms: ['配额'] },
      { terms: ['申请', '不足'] },
    ])
    expect(formatTopicMatchLayers(parsed.layers)).toContain('配额')
    expect(formatTopicMatchLayers(parsed.layers)).toMatch(/申请.*不足|不足.*申请/)
  })

  it('respects explicit 且 layers written with semicolons', () => {
    const parsed = parseTopicSearchQuery('配额；申请、不足', { productHints: HINTS })
    expect(parsed.layers).toEqual([
      { terms: ['配额'] },
      { terms: ['申请', '不足'] },
    ])
  })
})

describe('blobMatchesTopicQuery', () => {
  it('matches quota apply or shortage tickets from a natural-language title', () => {
    const query = parseTopicSearchQuery('配额申请与配额不足问题分析', { productHints: HINTS })
    expect(blobMatchesTopicQuery('问题类型：配额与权限申请 申请提升带宽配额上限', query)).toBe(true)
    expect(blobMatchesTopicQuery('创建IP时提示配额不足，请提升配额', query)).toBe(true)
    expect(blobMatchesTopicQuery('申请开通云主机，帮忙看下配置', query)).toBe(false)
    expect(blobMatchesTopicQuery('高峰时段带宽经常被限速，晚上公网带宽不够用', query)).toBe(false)
  })

  it('still requires both 带宽 and 限速 for a compound without 与', () => {
    const query = parseTopicSearchQuery('弹性公网IP带宽限速', { productHints: HINTS })
    expect(blobMatchesTopicQuery('弹性公网IP 高峰时段带宽经常被限速', query)).toBe(true)
    expect(blobMatchesTopicQuery('弹性公网IP 磁盘写满了', query)).toBe(false)
    expect(blobMatchesTopicQuery('弹性公网IP 带宽不够用', query)).toBe(false)
  })
})
