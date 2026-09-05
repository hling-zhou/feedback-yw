import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Actions page tabs', () => {
  const source = fs.readFileSync(new URL('./Actions.jsx', import.meta.url), 'utf8')

  it('keeps meeting todos first, then product actions, post-use JIRA, and problem reduction', () => {
    expect(source).toContain("label: '会议待办'")
    expect(source).toContain("label: '产品举措与进展'")
    expect(source).toContain("label: '用后即评JIRA'")
    expect(source).toContain("label: '问题压降'")
    expect(source).toContain("label: 'Playbook 沉淀'")
    expect(source).toContain("rawTab === 'product' || rawTab === 'post-use-jira' || rawTab === 'problem-reduction' || rawTab === 'playbook'")
    expect(source).toContain('<TicketTodoTab />')
    expect(source).toContain('<PostUseJiraTab />')
    expect(source).toContain('<ProductActionsTab />')
    expect(source).toContain('<ProblemReductionTab />')
    expect(source).toContain('<PlaybookPromotionPanel />')
    expect(source).not.toContain('title="产品举措与进展"')
    expect(source).toContain('[&_.ant-tabs-tab]:text-xl')
    expect(source).toContain('[&_.ant-tabs-tab]:font-bold')
    expect(source.indexOf("label: '会议待办'")).toBeLessThan(
      source.indexOf("label: '产品举措与进展'"),
    )
    expect(source.indexOf("label: '产品举措与进展'")).toBeLessThan(
      source.indexOf("label: '用后即评JIRA'"),
    )
    expect(source.indexOf("label: '用后即评JIRA'")).toBeLessThan(
      source.indexOf("label: '问题压降'"),
    )
    expect(source.indexOf("label: '问题压降'")).toBeLessThan(
      source.indexOf("label: 'Playbook 沉淀'"),
    )
  })

  it('slims the action list: removes 问题类型/用户旅程/来源/举措详情 columns and merges 最近更新', () => {
    // 删除的列
    expect(source).not.toContain("title: '问题类型'")
    expect(source).not.toContain("title: '用户旅程'")
    expect(source).not.toContain("title: '来源'")
    expect(source).not.toContain("title: '举措详情'")
    // 合并的列：原"最近更新时间"/"最近更新人员" → 单列"最近更新"
    expect(source).not.toContain("title: '最近更新时间'")
    expect(source).not.toContain("title: '最近更新人员'")
    expect(source).toContain("title: '最近更新'")
    // 保留的核心列
    expect(source).toContain("title: '产品名称'")
    expect(source).toContain("title: '问题'")
    expect(source).toContain("title: '举措'")
    expect(source).toContain("title: '状态'")
  })
})

describe('ProblemReductionTab height', () => {
  const source = fs.readFileSync(new URL('./ProblemReductionTab.jsx', import.meta.url), 'utf8')

  it('fills remaining viewport after chrome instead of a short magic grid', () => {
    expect(source).toContain('lg:h-[calc(100dvh-9.5rem)]')
    expect(source).toContain('min-h-0 flex-1')
    expect(source).not.toContain('h-[calc(100dvh-13.5rem)]')
  })
})
