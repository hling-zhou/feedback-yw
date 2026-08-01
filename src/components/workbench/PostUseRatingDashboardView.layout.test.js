import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PostUseRatingDashboardView report availability', () => {
  const source = fs.readFileSync(new URL('./PostUseRatingDashboardView.jsx', import.meta.url), 'utf8')

  it('only exposes the Word monthly report for a single-month range', () => {
    expect(source).toContain("const activeViewMode = reportMonth ? viewMode : 'online'")
    expect(source).toContain("className=\"post-use-report-tabs\"")
    expect(source).toContain("{reportMonth ? <Tag color=\"green\">月报 {reportMonth}</Tag> : null}")
    expect(source).not.toContain('Word 月报仅支持单月范围')
    expect(source).toContain("{activeViewMode === 'report' ? (")
  })
})
