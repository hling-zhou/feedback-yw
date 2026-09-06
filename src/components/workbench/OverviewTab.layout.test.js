import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('OverviewTab journey map', () => {
  it('hosts the combined journey map with source switcher', () => {
    const overview = fs.readFileSync(new URL('./OverviewTab.jsx', import.meta.url), 'utf8')
    const map = fs.readFileSync(new URL('./OverviewJourneyMap.jsx', import.meta.url), 'utf8')
    expect(overview).toContain('OverviewJourneyMap')
    expect(map).toContain('全部反馈')
    expect(map).toContain('投诉仅含客户体验类')
    expect(map).toContain('sourceFilter')
    expect(map).toContain('resolveJourneyComparisonWindow')
    expect(map).toContain('useMonthlyAverage')
    expect(map).toContain('多月按月均')
  })

  it('mounts the single-product experience trend panel after 行动建议', () => {
    const overview = fs.readFileSync(new URL('./OverviewTab.jsx', import.meta.url), 'utf8')
    expect(overview).toContain('ProductExperienceTrendPanel')
    expect(overview).toContain('<ProductExperienceTrendPanel feedbacks={feedbacks} />')
    // 顺序：行动建议之后、用户旅程之前
    expect(overview.indexOf('<PlanningRecommendationsPanel')).toBeLessThan(
      overview.indexOf('<ProductExperienceTrendPanel'),
    )
    expect(overview.indexOf('<ProductExperienceTrendPanel')).toBeLessThan(
      overview.indexOf('<OverviewJourneyMap'),
    )
  })
})
