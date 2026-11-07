import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * API 巡检两个新 Tab 真渲染冒烟测试（M5，对齐 Actions.render 先例）。
 * renderToStaticMarkup 真渲染组件树——挂载即炸的 ReferenceError/TypeError 直接红。
 * useEffect 不执行（数据拉取不触发），只 mock 渲染路径 hooks。
 */

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ can: () => true }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/InsightsContext.jsx', () => ({
  useInsights: () => ({
    adapter: {
      getMeta: vi.fn(async () => null),
      putMeta: vi.fn(async () => {}),
    },
    tagCandidates: [],
    productCatalogMeta: null,
  }),
  InsightsProvider: ({ children }) => children,
}))
vi.mock('../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))

import ApiPatrolRegistryPanel from '../components/tagManagement/ApiPatrolRegistryPanel.jsx'
import ApiPatrolRootCauseRulesPanel from '../components/tagManagement/ApiPatrolRootCauseRulesPanel.jsx'

describe('API 巡检 Tab 组件真渲染冒烟', () => {
  it('ApiPatrolRegistryPanel 挂载不炸（含空态）', () => {
    const html = renderToStaticMarkup(
      React.createElement(ApiPatrolRegistryPanel, { readOnly: false }),
    )
    expect(html).toContain('产品接口')
    // 关键列头渲染
    expect(html).toContain('指标名称')
    expect(html).toContain('接口名称')
  })

  it('ApiPatrolRegistryPanel 只读模式无编辑控件', () => {
    const html = renderToStaticMarkup(
      React.createElement(ApiPatrolRegistryPanel, { readOnly: true }),
    )
    expect(html).not.toContain('新增接口')
    expect(html).not.toContain('删除')
  })

  it('ApiPatrolRootCauseRulesPanel 挂载不炸（表头/说明渲染）', () => {
    const html = renderToStaticMarkup(
      React.createElement(ApiPatrolRootCauseRulesPanel, { readOnly: false }),
    )
    expect(html).toContain('接口失败根因分类')
    expect(html).toContain('有序规则表')
    expect(html).toContain('新增规则')
  })

  it('ApiPatrolRootCauseRulesPanel 只读模式无新增/排序', () => {
    const html = renderToStaticMarkup(
      React.createElement(ApiPatrolRootCauseRulesPanel, { readOnly: true }),
    )
    expect(html).not.toContain('新增规则')
  })
})

/**
 * 页面级守卫：TagManagement 按新 tab 参数渲染（新入口不静默丢失）。
 * 受控 tab 解析守卫——对齐 11-04 教训（受控 Tabs 单源化）。
 */
import TagManagement from './TagManagement.jsx'
import { MemoryRouter } from 'react-router-dom'

// 第二个 describe 复用文件顶部已有的 InsightsContext mock（含 adapter/tagCandidates/productCatalogMeta）

describe('TagManagement 新 Tab 注册守卫', () => {
  it('tab=api_patrol_registry 渲染产品接口面板（锚定面板独有内容，防与 tab label 撞名恒绿）', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/tags?tab=api_patrol_registry'] },
        React.createElement(TagManagement),
      ),
    )
    expect(html).toContain('编辑只影响之后推送') // ApiPatrolRegistryPanel 独有说明
  })

  it('tab=api_patrol_root_causes 渲染根因分类面板（锚定面板独有内容）', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/tags?tab=api_patrol_root_causes'] },
        React.createElement(TagManagement),
      ),
    )
    expect(html).toContain('先命中先返回') // ApiPatrolRootCauseRulesPanel 独有说明
  })
})
