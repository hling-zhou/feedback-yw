import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 用后即评工作台入口下线守卫（2026-11-21 清单迁移拍板）。
 *
 * 历史：2026-11-09 双入口同弹窗（头部「分析与报告」居右按钮 + StoryView「客户与证据」按钮）。
 * 2026-11-21 用户拍板下线：清单功能平移至反馈库 · 用后即评满意度 ·「建议回访/溯源清单」tab
 * （PostUseCallbackListTab，常驻视图 + 用户名白名单可见），弹窗 PostUseCallbackProcessModal
 * 随入口一并删除。本守卫防入口/弹窗回潮。
 */

const source = fs.readFileSync(
  new URL('./PostUseRatingDashboardView.jsx', import.meta.url),
  'utf8',
)

describe('PostUseRatingDashboardView 清单入口已下线（2026-11-21）', () => {
  it('头部入口与弹窗挂载均已删除，不得回潮', () => {
    expect(source).not.toContain('查看并处理建议回访/溯源清单')
    expect(source).not.toContain('PostUseCallbackProcessModal')
    expect(source).not.toContain('callbackProcessOpen')
    expect(source).not.toContain('onOpenCallbackProcess')
    expect(source).not.toContain('canUsePostUseCallbackList')
    expect(source).not.toContain('isCallbackEntryDisabled')
  })

  it('下线说明注释在位（迁移去向可追溯）', () => {
    expect(source).toContain('2026-11-21 清单入口下线')
    expect(source).toContain('PostUseCallbackListTab')
  })
})

describe('PostUseRatingDashboardView 样本 Tag 口径说明（11-18 拍板）', () => {
  it('「样本」Tag 在存在选项题时追加说明文案', () => {
    expect(source).toContain('样本 {storyModel.scope.validSample}')
    expect(source).toContain('另含选项题 ${optionRecordCount} 条（无评分）')
  })

  it('选项题计数复用共享谓词（与 scoredRows 排除口径同源），不另写判定', () => {
    expect(source).toContain("import { isOptionScoreRecord } from '../../lib/postUseRating/scoredRows.js'")
    expect(source).toContain('selectedItems.filter(isOptionScoreRecord).length')
    expect(source).not.toContain("channel === 'option' ||")
  })
})
