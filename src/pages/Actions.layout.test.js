import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Actions page tabs', () => {
  const source = fs.readFileSync(new URL('./Actions.jsx', import.meta.url), 'utf8')

  it('keeps product actions and post-use JIRA as two tabs', () => {
    expect(source).toContain("label: '产品举措与进展'")
    expect(source).toContain("label: '用后即评JIRA'")
    expect(source).toContain("searchParams.get('tab') === 'post-use-jira'")
    expect(source).toContain('<PostUseJiraTab />')
    expect(source).toContain('<ProductActionsTab />')
  })
})
