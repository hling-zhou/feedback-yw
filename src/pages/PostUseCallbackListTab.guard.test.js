import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 反馈库 ·「建议回访/溯源清单」tab 守卫（2026-11-21 平铺需求）。
 *
 * 锚点：
 * 1. 页面形态——卡片内嵌吸顶（11-09 方案 A 拍板），禁 Modal 外壳与页面级 page-sticky-chrome；
 * 2. 行级勾选 + 周期包含语义 + 已纳入 Tag（弹窗 rowLevel 语义平移，禁止回潮组级合并勾选）；
 * 3. 产品下拉「先切后建」（先筛 records 再 build，禁止对清单行做后过滤）；
 * 4. scroll.x 走 sumColumnsWidth（禁硬编码，列宽拖拽守卫同源）；
 * 5. 操作权限与弹窗同构（canUsePostUseCallbackList），tab 可见性门控在宿主；
 * 6. 数据链走共享构建函数 buildPostUseCallbackLists（两壳口径对拍锚点）。
 * 红绿：本文件新写——改动前组件不存在即红；建成落锚即绿。
 */

const source = fs.readFileSync(
  new URL('./PostUseCallbackListTab.jsx', import.meta.url),
  'utf8',
)

describe('PostUseCallbackListTab 页面形态守卫（2026-11-21）', () => {
  it('无 Modal 外壳、无页面级 page-sticky-chrome，卡片内白底吸顶', () => {
    expect(source).not.toContain('<Modal')
    expect(source).not.toContain('useNavigate')
    // 注：page-sticky-chrome / bg-ink-50 的「渲染产物」断言在 chrome.render.test.js
    //（源码注释里合法出现这两个词——写「禁用说明」时会被本源码扫描误伤，11-09 先例同款）
    expect(source).toContain('sticky top-0')
    expect(source).toContain('-mx-4')
    expect(source).toContain('bg-white')
  })

  it('行级勾选 + 周期包含语义 + 已纳入 Tag（弹窗 rowLevel 语义平移）', () => {
    // 周期包含语义三件套共享函数
    expect(source).toContain('allMatchingKeys')
    expect(source).toContain('itemKeySubsetMatches')
    expect(source).toContain('lookupBySubset')
    expect(source).toContain('decisionOf')
    // 已纳入 Tag（省代表回访 + 产品部溯源双判定）
    expect(source).toContain('isDispatched')
    expect(source).toContain('isArchived')
    // 行级勾选（组级一勾全选的 visitFlagColumn 已下线，不得回潮）
    expect(source).not.toContain('visitFlagColumn')
    // 勾选持久化 + 服务端联动刷新
    expect(source).toContain('persistDecision')
    expect(source).toContain('refreshDecisions')
  })

  it('产品下拉「先切后建」：先筛 records 再 build，非清单行后过滤', () => {
    expect(source).toContain('buildPostUseCallbackLists')
    expect(source).toContain('selectedItems')
    // 先切后建形态：selectedItems 是 build 的 records 入参
    expect(source).toMatch(/buildPostUseCallbackLists\(\{\s*\n\s*records: selectedItems/)
    // 产品筛选是 records 级（selectedProduct 过滤 scopedItems），不是对清单行过滤
    expect(source).toContain("scopedItems.filter((record) => record.product === selectedProduct)")
  })

  it('scroll.x 走 sumColumnsWidth + 列宽拖拽（禁硬编码回潮）', () => {
    expect(source).toContain('sumColumnsWidth')
    expect(source).not.toMatch(/scroll=\{\{ x: \d+ \}\}/)
    expect(source).toContain('useColumnResize')
  })

  it('操作权限与弹窗同构：canUsePostUseCallbackList（admin+editor）', () => {
    expect(source).toContain('canUsePostUseCallbackList')
    expect(source).toContain('disabled={!canEdit || !visitCount}')
    expect(source).toContain('disabled={!canEdit}')
  })

  it('工单跳转自建 index：buildTicketRecordIndex + 宿主 onOpenTicket 回调', () => {
    expect(source).toContain('buildTicketRecordIndex')
    expect(source).toContain('openTicketByOriginalId')
    expect(source).toContain('onOpenTicket')
  })

  it('存档成功「立即查看」走宿主 onNavigateToTrace（不 navigate 整页）', () => {
    expect(source).toContain('onNavigateToTrace')
    expect(source).not.toContain("navigate('/feedbacks")
    expect(source).not.toContain('useNavigate')
  })

  it('「产品部溯源」跳转按钮已删（2026-11-21 拍板）：同 lane 切 Segmented 即达，不得回潮', () => {
    expect(source).not.toContain('LinkOutlined')
    expect(source).not.toContain('切换到产品部溯源视图')
    // 存档「立即查看」是 onNavigateToTrace 唯一消费点（grep 单点）
    expect(source.split('onNavigateToTrace?.()').length).toBe(2)
  })

  it('操作行与筛选行间距 space-y-4（2026-11-21 用户反馈间距太小）', () => {
    expect(source).not.toContain('space-y-2 rounded-t-lg')
    expect(source).toContain('space-y-4 rounded-t-lg')
  })
})
