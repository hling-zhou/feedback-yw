import { describe, expect, it } from 'vitest'
import {
  commitToWhatsNewItem,
  formatCommitBodyAsSummary,
  groupWhatsNewItemsByMonth,
  hasUnreadWhatsNewFeed,
  latestWhatsNewSignal,
  modulesFromScope,
  normalizeWhatsNewFeed,
  parseChangelogVisibility,
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

  it('keeps full body and strips git trailers from summary', () => {
    expect(
      formatCommitBodyAsSummary(
        '第一段说明。\n\n第二段细节。\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\nSigned-off-by: Dev <dev@example.com>\n',
      ),
    ).toBe('第一段说明。\n\n第二段细节。')

    expect(
      commitToWhatsNewItem({
        hash: 'abc1234',
        subject: 'feat(feedbacks): 会议待办',
        date: '2026-07-28',
        body: '详情一行\n\n更多说明\n\nSigned-off-by: Dev <dev@example.com>',
      }),
    ).toMatchObject({
      id: 'abc1234',
      category: 'feature',
      modules: ['feedbacks'],
      title: '会议待办',
      publishedAt: '2026-07-28',
      summary: '详情一行\n\n更多说明',
    })
    expect(
      commitToWhatsNewItem({
        hash: 'x',
        subject: 'chore: ignore',
        date: '2026-07-28',
      }),
    ).toBeNull()
  })

  it('honors Changelog skip/show trailers', () => {
    expect(parseChangelogVisibility('说明\n\nChangelog: skip\n')).toBe('skip')
    expect(parseChangelogVisibility('说明\n\nChangelog: show\n')).toBe('show')
    expect(parseChangelogVisibility('说明\n\nChangelog: hide\n')).toBe('skip')

    expect(
      commitToWhatsNewItem({
        hash: 'skip1',
        subject: 'feat(workbench): 不该出现',
        date: '2026-07-28',
        body: '内部调整\n\nChangelog: skip',
      }),
    ).toBeNull()

    expect(
      commitToWhatsNewItem({
        hash: 'show1',
        subject: 'chore(settings): 强制展示',
        date: '2026-07-28',
        body: '需要告知用户\n\nChangelog: show',
      }),
    ).toMatchObject({
      id: 'show1',
      title: '强制展示',
      category: 'improvement',
      summary: '需要告知用户',
      modules: ['settings'],
    })
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
