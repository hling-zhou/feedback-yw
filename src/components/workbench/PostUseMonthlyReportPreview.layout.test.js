import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PostUseMonthlyReportPreview import entry', () => {
  const source = fs.readFileSync(new URL('./PostUseMonthlyReportPreview.jsx', import.meta.url), 'utf8')

  it('exposes revised Word import next to monthly report export', () => {
    expect(source).toContain('导入修订版')
    expect(source).toContain('importMonthlyReportDocx')
    expect(source).toContain('appendMonthlyReportRevision')
    expect(source).toContain('analyzeMonthlyReportRevisionLearning')
    expect(source).toContain('已导入')
    expect(source).toContain('已沉淀')
    expect(source).toContain('学到的经验')
    expect(source).toContain('本次导出前建议复核')
    expect(source).toContain("label: '整体得分情况'")
    expect(source).toContain("label: '整体分布'")
  })
})
