import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Actions page tabs', () => {
  const source = fs.readFileSync(new URL('./Actions.jsx', import.meta.url), 'utf8')

  it('keeps meeting todos first, then product actions and post-use JIRA', () => {
    expect(source).toContain("label: '会议待办'")
    expect(source).toContain("label: '产品举措与进展'")
    expect(source).toContain("label: '用后即评JIRA'")
    expect(source).toContain("rawTab === 'product' || rawTab === 'post-use-jira'")
    expect(source).toContain('<TicketTodoTab />')
    expect(source).toContain('<PostUseJiraTab />')
    expect(source).toContain('<ProductActionsTab />')
    expect(source).not.toContain('title="产品举措与进展"')
    expect(source).toContain('[&_.ant-tabs-tab]:text-xl')
    expect(source).toContain('[&_.ant-tabs-tab]:font-bold')
    expect(source.indexOf("label: '会议待办'")).toBeLessThan(
      source.indexOf("label: '产品举措与进展'"),
    )
  })
})
