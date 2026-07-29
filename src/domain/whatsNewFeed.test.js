import { describe, expect, it } from 'vitest'
import {
  commitToWhatsNewItem,
  groupWhatsNewItemsByMonth,
  hasUnreadWhatsNewFeed,
  latestWhatsNewSignal,
  modulesFromScope,
  normalizeWhatsNewFeed,
  parseConventionalSubject,
  truncateWhatsNewItems,
} from './whatsNewFeed.js'

describe('whatsNewFeed parse', () => {
  it('parses conventional subjects', () => {
    expect(parseConventionalSubject('feat(actions): 增加数据来源筛选')).toEqual({
      type: 'feat',
      scope: 'actions',
      title: '增加数据来源筛选',
    })
    expect(parseConventionalSubject('fix: 修复复制全文失败')).toEqual({
      type: 'fix',
      scope: '',
      title: '修复复制全文失败',
    })
    expect(parseConventionalSubject('Merge pull request #1')).toBeNull()
    expect(parseConventionalSubject('chore: bump deps')).toEqual({
      type: 'chore',
      scope: '',
      title: 'bump deps',
    })
  })

  it('maps scope to modules', () => {
    expect(modulesFromScope('actions')).toEqual(['actions'])
    expect(modulesFromScope('taxonomy')).toEqual(['tags'])
    expect(modulesFromScope('')).toEqual([])
    expect(modulesFromScope('unknown-scope')).toEqual(['other'])
  })

  it('converts commits and filters types', () => {
    expect(
      commitToWhatsNewItem({
        hash: 'abc1234',
        subject: 'feat(feedbacks): 会议待办',
        date: '2026-07-28',
        body: '详情一行\n\nSigned-off',
      }),
    ).toMatchObject({
      id: 'abc1234',
      category: 'feature',
      modules: ['feedbacks'],
      title: '会议待办',
      publishedAt: '2026-07-28',
      summary: '详情一行',
    })
    expect(
      commitToWhatsNewItem({
        hash: 'x',
        subject: 'chore: ignore',
        date: '2026-07-28',
      }),
    ).toBeNull()
  })

  it('groups by month and truncates', () => {
    const items = [
      { id: '1', title: 'a', category: 'feature', modules: [], publishedAt: '2026-07-01' },
      { id: '2', title: 'b', category: 'fix', modules: [], publishedAt: '2026-06-15' },
    ]
    expect(Object.keys(groupWhatsNewItemsByMonth(items)).sort()).toEqual(['2026-06', '2026-07'])
    expect(truncateWhatsNewItems(items, 1)).toHaveLength(1)
  })

  it('normalizes feed and unread signal', () => {
    const feed = normalizeWhatsNewFeed({
      generatedAt: '2026-07-29T00:00:00.000Z',
      items: [
        { id: '1', title: 't', category: 'feature', publishedAt: '2026-07-20', modules: [] },
        { id: 'bad', title: '', category: 'feature', publishedAt: '2026-07-21' },
      ],
    })
    expect(feed.items).toHaveLength(1)
    expect(latestWhatsNewSignal(feed)).toBe('2026-07-20')
    expect(hasUnreadWhatsNewFeed(feed, null)).toBe(true)
    expect(hasUnreadWhatsNewFeed(feed, '2026-07-21')).toBe(false)
    expect(hasUnreadWhatsNewFeed(feed, '2026-07-19')).toBe(true)
  })
})
