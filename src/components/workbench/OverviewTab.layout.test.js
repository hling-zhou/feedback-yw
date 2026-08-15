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
  })
})
