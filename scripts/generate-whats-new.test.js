import { describe, expect, it } from 'vitest'
import { buildWhatsNewFeed } from './generate-whats-new.mjs'

describe('buildWhatsNewFeed', () => {
  it('only keeps feat/fix after mapping', () => {
    const feed = buildWhatsNewFeed({
      since: 'aaa',
      repoCommit: 'bbb',
      now: '2026-07-29T12:00:00.000Z',
      repoUrl: 'https://github.com/acme/app',
      overrides: {
        '111aaaa': {
          summary: '- 覆盖摘要',
        },
      },
      commits: [
        {
          hash: '111aaaa',
          date: '2026-07-28',
          subject: 'feat(actions): 新筛选',
          body: '',
        },
        {
          hash: '222bbbb',
          date: '2026-07-27',
          subject: 'chore: ignore me',
          body: '',
        },
        {
          hash: '333cccc',
          date: '2026-07-26',
          subject: 'fix: 修 bug',
          body: '',
        },
      ],
    })
    expect(feed.since).toBe('aaa')
    expect(feed.items).toHaveLength(2)
    expect(feed.items[0].commitUrl).toBe('https://github.com/acme/app/commit/111aaaa')
    expect(feed.items[0].summary).toBe('- 覆盖摘要')
    expect(feed.items.map((i) => i.category)).toEqual(['feature', 'fix'])
  })
})
