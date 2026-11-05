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

  it('supports period months filtering (view 2)', () => {
    // 视图 2 跟随当前周期：months prop + importMonth 按「、」拆分交集过滤
    expect(source).toContain('export default function PostUseJiraTab({ months = [], periodLabel = \'\' })')
    expect(source).toContain("String(item.importMonth || '')\n          .split('、')")
  })

  it('2026-11-05 状态自动流转：个人标记体系下线 + 提交/暂存双操作（红绿守卫）', () => {
    // 状态由操作自动判定：提交=已处理（回溯结果必填）/ 暂存=处理中
    expect(source).toContain("status: mode === 'submit' ? '已处理' : '处理中'")
    expect(source).toContain('await form.validateFields()')
    expect(source).toContain('回溯结果')
    // 个人标记体系（jira: 前缀 + 我的状态列 + 标记处理勾选列）整体移除——回潮即红
    expect(source).not.toContain('`jira:${id}`')
    expect(source).not.toContain('我的状态')
    expect(source).not.toContain('标记处理')
    expect(source).not.toContain('useUserTicketReviews')
    // 抽屉不再有手动状态下拉
    expect(source).not.toContain('status: item.status ||')
  })
})
