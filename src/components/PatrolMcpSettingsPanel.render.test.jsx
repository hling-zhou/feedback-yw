import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({ success: vi.fn(), error: vi.fn() }),
}))

/**
 * 产品API日志诊断配置面板·渲染冒烟（真渲染，非源码断言）。
 * renderToStaticMarkup 不跑 useEffect → 无网络请求，空态（source=none）即默认渲染形态。
 */
describe('PatrolMcpSettingsPanel 渲染', () => {
  const renderPanel = async (canEdit) => {
    const mod = await import('./PatrolMcpSettingsPanel.jsx')
    return renderToStaticMarkup(React.createElement(mod.default, { canEdit }))
  }

  it('① 面板骨架：端点/Token 字段（FieldLabel）+ 空态告警 + 保存按钮', async () => {
    const html = await renderPanel(true)
    expect(html).toContain('MCP 诊断端点')
    expect(html).toContain('MCP 访问 Token')
    expect(html).toContain('保存诊断配置')
    expect(html).toContain('诊断服务未配置') // 空态 Alert（库+env 均未配置）
    expect(html).toContain('库优先于环境变量')
  })

  it('② canEdit=false → 保存按钮禁用（仅管理员可改）', async () => {
    const html = await renderPanel(false)
    const saveBtn = (html.match(/<button[^>]*type="button"[^>]*>/g) || []).pop()
    expect(String(saveBtn)).toContain('disabled')
  })

  it('③ canEdit=true → 保存按钮可用', async () => {
    const html = await renderPanel(true)
    const saveBtn = (html.match(/<button[^>]*type="button"[^>]*>/g) || []).pop()
    expect(String(saveBtn)).not.toContain('disabled')
  })
})
