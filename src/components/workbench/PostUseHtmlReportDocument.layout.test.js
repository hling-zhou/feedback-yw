import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('HTML monthly report route and page', () => {
  const router = fs.readFileSync(new URL('../../router.jsx', import.meta.url), 'utf8')
  const page = fs.readFileSync(new URL('../../pages/PostUseHtmlReport.jsx', import.meta.url), 'utf8')
  const document = fs.readFileSync(new URL('./PostUseHtmlReportDocument.jsx', import.meta.url), 'utf8')

  it('registers an independent report route outside AppShell', () => {
    expect(router).toContain("path: 'workbench/post-use-report/:month'")
    expect(router).toContain('<PostUseHtmlReport />')
    const reportIndex = router.indexOf("path: 'workbench/post-use-report/:month'")
    const shellIndex = router.indexOf('<AppShell />')
    expect(reportIndex).toBeGreaterThan(-1)
    expect(shellIndex).toBeGreaterThan(reportIndex)
    expect(router.slice(reportIndex, shellIndex)).not.toContain('<AppShell')
  })

  it('keeps toolbar actions for save, with optional print', () => {
    expect(page).toContain('返回工作台')
    expect(page).toContain('保存')
    expect(page).toContain('导出离线 HTML')
    expect(page).toContain("can('editRecord')")
    expect(page).toContain('post-use-html-report-toolbar')
  })

  it('uses interactive charts instead of print-only bars', () => {
    expect(document).toContain('PostUseHtmlReportCharts')
    expect(document).toContain('scoreTrend')
    expect(document).toContain('satisfactionTrend')
    const charts = fs.readFileSync(new URL('./PostUseHtmlReportCharts.jsx', import.meta.url), 'utf8')
    expect(charts).toContain('TrendChart')
    expect(charts).toContain('SentimentChart')
    expect(charts).toContain('ThemeBarChart')
    expect(charts).toContain('BarChart')
  })

  it('renders judgment, issues, todo and appendix in reading order', () => {
    expect(document).toContain('本月判断')
    expect(document).toContain('问题与证据')
    expect(document).toContain('本月要办')
    expect(document).toContain('附录')
    expect(document).toContain('有效客户原话登记')
    expect(document).toContain('本条暂无有效负向原话')
    expect(document).toContain('正反馈')
    expect(document).toContain('负反馈')
    expect(document).toContain('云网均分')
    expect(document).toContain('YunwangScoreHints')
    expect(document).toContain('vsCompanyLabel')
    expect(document).toContain('momLabel')
    const charts = fs.readFileSync(new URL('./PostUseHtmlReportCharts.jsx', import.meta.url), 'utf8')
    expect(charts).toContain('客户声音')
    const judgment = document.indexOf('id="report-judgment"')
    const issues = document.indexOf('id="report-issues"')
    const todo = document.indexOf('id="report-todo"')
    const appendix = document.indexOf('id="report-appendix"')
    expect([judgment, issues, todo, appendix].every((index) => index >= 0)).toBe(true)
    expect(judgment).toBeLessThan(issues)
    expect(issues).toBeLessThan(todo)
    expect(todo).toBeLessThan(appendix)
  })
})
