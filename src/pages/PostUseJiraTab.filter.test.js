import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('PostUseJiraTab composite filter', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'PostUseJiraTab.jsx'), 'utf8')

  it('uses the shared composite filter instead of a row of inputs', () => {
    expect(source).toContain('PostUseJiraCompositeFilter')
    expect(source).toContain('postUseJiraFiltersToListQuery')
    expect(source).not.toContain('placeholder="数据月份"')
    expect(source).not.toContain('placeholder="客户名称 / 编码 / JIRA"')
  })
})
