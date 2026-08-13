import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PostUseJiraDrawer editable fields', () => {
  const source = fs.readFileSync(new URL('./PostUseJiraDrawer.jsx', import.meta.url), 'utf8')

  it('only exposes JIRA ticket, status and progress as form fields', () => {
    expect(source).toContain('name="jiraTicket"')
    expect(source).toContain('name="status"')
    expect(source).toContain('name="progress"')
    expect(source).not.toContain('name="customerName"')
    expect(source).not.toContain('name="customerFeedback"')
    expect(source).not.toContain('name="productName"')
    expect(source).toContain('基础信息')
  })
})
