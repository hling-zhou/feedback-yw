import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PostUseMonthlyReportPreview is no longer the monthly report surface', () => {
  const dashboard = fs.readFileSync(new URL('./PostUseRatingDashboardView.jsx', import.meta.url), 'utf8')
  const reportPage = fs.readFileSync(new URL('../../pages/PostUseHtmlReport.jsx', import.meta.url), 'utf8')

  it('does not mount Word generate or import from live UI', () => {
    expect(dashboard).not.toContain('importMonthlyReportDocx')
    expect(dashboard).not.toContain('buildMonthlyReportDocxBlob')
    expect(reportPage).not.toContain('importMonthlyReportDocx')
    expect(reportPage).not.toContain('buildMonthlyReportDocxBlob')
    expect(reportPage).not.toContain('生成 Word')
    expect(reportPage).not.toContain('导入修订版')
  })
})
