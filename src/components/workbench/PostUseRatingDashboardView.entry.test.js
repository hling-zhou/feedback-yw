import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 用后即评头部快捷入口守卫（2026-11-09 双入口需求）。
 * 锚点：头部「分析与报告」标题行入口存在、权限门同源、disabled 判定走共享 helper、
 * 弹窗实例唯一（本组件持有），StoryView 经 prop 委托打开。
 * 红绿：改动前文件不含「查看并处理建议回访/溯源清单」与共享 helper 引用 → 红。
 */

const source = fs.readFileSync(
  new URL('./PostUseRatingDashboardView.jsx', import.meta.url),
  'utf8',
)

describe('PostUseRatingDashboardView 头部快捷入口（2026-11-09）', () => {
  it('头部「分析与报告」标题行有居右快捷入口', () => {
    expect(source).toContain('用后即评分析与报告')
    expect(source).toContain('查看并处理建议回访/溯源清单')
    expect(source).toContain('ml-auto')
  })

  it('入口权限与 disabled 判定同源共享 helper（与 StoryView 入口一致）', () => {
    expect(source).toContain("import { canUsePostUseCallbackList }")
    expect(source).toContain('canOpenCallbackList = canUsePostUseCallbackList(user?.role)')
    expect(source).toContain('isCallbackEntryDisabled')
    expect(source).toContain('CALLBACK_ENTRY_DISABLED_REASON')
    expect(source).toContain('callbackEntryDisabled = isCallbackEntryDisabled(storyModel)')
  })

  it('弹窗实例唯一：由本组件持有，双入口共用', () => {
    expect(source).toContain('PostUseCallbackProcessModal')
    expect(source).toContain('open={callbackProcessOpen}')
    expect(source).toContain("recommendations={storyModel.callbackRecommendations || []}")
    expect(source).toContain("callbackNonTenRecords={storyModel.callbackNonTenRecords || []}")
    // 空清单点按防御也走同源 helper，不另写一份清单判空
    expect(source).toContain('if (isCallbackEntryDisabled(storyModel))')
  })

  it('StoryView 经 prop 委托打开弹窗（不自带弹窗实例）', () => {
    expect(source).toContain('onOpenCallbackProcess={() => {')
  })
})
