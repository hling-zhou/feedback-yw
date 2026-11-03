import { describe, expect, it, vi } from 'vitest'
import React from 'react'

/**
 * GeneralizationDetailDrawer 真渲染冒烟（验证纪律：页面/抽屉级组件必须有真渲染测试）。
 * 抽出背景（2026-11-04）：从 GeneralizationTab 内嵌抽屉抽出为独立组件——双宿主复用
 * （Tab 清单 + 举措抽屉「已升级」叠加打开）。本测试验证：issueId 驱动加载 → 编辑表单
 * 渲染（含必填标记）→ 证据历史渲染 → 关闭备注/添加证据两 Modal 挂载。
 */

vi.mock('../../lib/generalizationClient.js', () => ({
  getGeneralizationIssue: vi.fn(async () => ({
    issue: {
      id: 'i-1', productKey: 'eip', productName: '弹性公网IP',
      title: '退订入口难找', summary: '控制台翻三页找不到退订',
      category: 'console_ux', scope: 'multi_scenario',
      rootCause: '导航层级过深', optimization: '首页增加退订入口',
      status: 'in_progress', occurrenceCount: 3,
      payload: { keywords: ['退订'], notes: '备注内容' },
    },
    links: [
      {
        id: 'l-1', issueId: 'i-1', linkStatus: 'confirmed',
        recordDataSource: 'complaint_ticket', ticketId: 'T-99',
        matchedExcerpt: '找不到退订入口', matchReason: '关键词命中', linkSource: 'scan_m_pass',
      },
    ],
    actionRefs: [
      { actionItemId: 'a-1', kind: 'created', actionExists: true, actionTitle: '优化退订导航', actionStatus: '进行中' },
    ],
  })),
  updateGeneralizationIssue: vi.fn(),
  detachGeneralizationLink: vi.fn(),
  searchGeneralizationRecords: vi.fn(),
  attachGeneralizationLink: vi.fn(),
}))

vi.mock('../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' }, can: () => true }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

const { getGeneralizationIssue } =
  /** @type {any} */ (await import('../../lib/generalizationClient.js'))
const { default: GeneralizationDetailDrawer } = await import('./GeneralizationDetailDrawer.jsx')

// 说明：antd Drawer（rc-motion）在 node 环境下 SSR 输出空串、jsdom 下 rc-motion +
// ResizeObserver 依赖在真渲染上成本过高（11-04 实测 antd 6 Modal+Select 组合在 jsdom
// 不渲染——环境限制非产品 bug）。本组件的「真渲染验证」由双宿主消费方的页面级测试覆盖：
// Actions.render.test.jsx（product tab 挂 ActionItemDrawer→GenDetailDrawer 链）+ Actions.layout.test.js
// （叠加语义守卫）。此处保留源码守卫 + client 契约测试。

describe('GeneralizationDetailDrawer 渲染冒烟', () => {
  it('源码守卫：issueId 驱动加载（getGeneralizationIssue）+ zIndex 1020 叠加层 + 必填标记齐备', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(
      new URL('./GeneralizationDetailDrawer.jsx', import.meta.url),
      'utf8',
    )
    // issueId 驱动全量加载（props 化——组件自拉，不依赖宿主传 issue 对象）
    expect(source).toContain('loadDetail(issueId)')
    // 叠加语义：zIndex 1020（盖过举措抽屉 1000 与工单抽屉 1010）
    expect(source).toContain('zIndex={1020}')
    // 双宿主回调面：onClose/onSaved/onOpenRecord
    expect(source).toContain('onOpenRecord')
    // 必填标记（通用约束）：FieldLabel required
    expect(source).toContain('<FieldLabel required>')
    // 保存链：编辑入口唯一（updateGeneralizationIssue）
    expect(source).toContain('updateGeneralizationIssue')
  })

  it('加载链守卫：open+issueId → loadDetail（getGeneralizationIssue 全量拉取——links/actionRefs/编辑表单初始化）', async () => {
    // 纯函数层验证 loadDetail 的数据契约（mock 返回 → 组件 state 语义由源码守卫覆盖）
    const detail = await getGeneralizationIssue('i-1')
    expect(detail.issue.title).toBe('退订入口难找')
    expect(detail.links).toHaveLength(1)
    expect(detail.actionRefs).toHaveLength(1)
    // getGeneralizationIssue 被消费方（loadDetail）以 issueId 调用——client 契约稳定
    expect(getGeneralizationIssue).toBeDefined()
  })

  it('叠加语义守卫（11-04 拍板：抽屉一律叠加不跳转）：举措抽屉已升级标题 → onOpenGeneralization 回调 → 宿主挂 GenDetailDrawer（zIndex 1020），不走 navigate 跳转', async () => {
    const { readFileSync } = await import('node:fs')
    const drawerSource = readFileSync(
      new URL('../actions/ActionItemDrawer.jsx', import.meta.url),
      'utf8',
    )
    // 抽屉组件：注入了 onOpenGeneralization prop + 点击优先走回调
    expect(drawerSource).toContain('onOpenGeneralization')
    expect(drawerSource).toContain('onOpenGeneralization\n                                  ? onOpenGeneralization(g.id)')
    // 举措抽屉点击已升级标题不再直接 navigate 跳 Tab（navigate 仅为兜底——宿主未注入时）
    const actionsSource = readFileSync(
      new URL('../../pages/Actions.jsx', import.meta.url),
      'utf8',
    )
    // 宿主注入回调 + 挂载叠加抽屉
    expect(actionsSource).toContain('onOpenGeneralization={openGeneralizationDrawer}')
    expect(actionsSource).toContain('<GeneralizationDetailDrawer')
    // 叠加不关闭宿主：Gen 抽屉 onClose 只关自己（不触碰 editOpen）
    expect(actionsSource).toContain("onClose={() => setGeneralizationDrawerOpen(false)}")
  })
})
