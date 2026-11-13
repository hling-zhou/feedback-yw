import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PostUseJiraDrawer editable fields', () => {
  const source = fs.readFileSync(new URL('./PostUseJiraDrawer.jsx', import.meta.url), 'utf8')

  it('keeps status in the title and limits editable fields to assignee and progress', () => {
    expect(source).toContain('name="assigneeId"')
    expect(source).toContain('name="progress"')
    expect(source).not.toContain('name="status"')
    expect(source).toContain('<Tag color=')
    expect(source).toContain('<PostUseAttachments ownerType="trace"')
    expect(source).not.toContain('name="jiraTicket"')
    expect(source).not.toContain('name="customerName"')
    expect(source).not.toContain('name="customerFeedback"')
    expect(source).not.toContain('name="productName"')
    expect(source).toContain('基础信息')
  })
})
