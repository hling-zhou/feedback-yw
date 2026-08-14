import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PostUseRatingDashboardView report availability', () => {
  const source = fs.readFileSync(new URL('./PostUseRatingDashboardView.jsx', import.meta.url), 'utf8')

  it('opens the HTML monthly report in a new tab for a single-month range', () => {
    expect(source).toContain('打开月报')
    expect(source).toContain("window.open(`/workbench/post-use-report/${reportMonth}`, '_blank')")
    expect(source).not.toContain('noopener')
    expect(source).toContain("{reportMonth ? <Tag color=\"green\">月报 {reportMonth}</Tag> : null}")
    expect(source).not.toContain('Word 月报')
    expect(source).not.toContain('生成 Word')
    expect(source).not.toContain('导入修订版')
    expect(source).not.toContain("activeViewMode === 'report'")
    expect(source).not.toContain('PostUseMonthlyReportPreview')
  })
})
