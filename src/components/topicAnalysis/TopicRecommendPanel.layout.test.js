import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('TopicRecommendPanel refresh', () => {
  const source = fs.readFileSync(new URL('./TopicRecommendPanel.jsx', import.meta.url), 'utf8')
  const page = fs.readFileSync(new URL('../../pages/TopicAnalysis.jsx', import.meta.url), 'utf8')

  it('exposes a manual refresh that keeps existing cards on screen', () => {
    expect(source).toContain('刷新推荐')
    expect(source).toContain('onRefresh')
    expect(source).toContain('正在刷新推荐')
    expect(page).toContain('runRecommend({ force: true })')
    expect(page).toContain('loading={recordsLoading && cards.length === 0}')
  })
})
