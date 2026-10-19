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

  it('supports period months filtering and personal review status (view 2)', () => {
    // 视图 2 跟随当前周期：months prop + importMonth 按「、」拆分交集过滤
    expect(source).toContain('export default function PostUseJiraTab({ months = [], periodLabel = \'\' })')
    expect(source).toContain("String(item.importMonth || '')\n          .split('、')")
    // 个人处理状态：jira: 前缀 + 我的状态列 + 标记处理
    expect(source).toContain('`jira:${id}`')
    expect(source).toContain('我的状态')
    expect(source).toContain('标记处理')
    expect(source).toContain('useUserTicketReviews')
  })
})
