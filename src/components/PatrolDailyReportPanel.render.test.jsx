import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({ success: vi.fn(), error: vi.fn() }),
}))

/**
 * AI 巡检日报面板·渲染冒烟（真渲染）。draft 本地默认值 → SSR 即渲染完整表单
 * （renderToStaticMarkup 不跑 useEffect，/api 请求不发生；真实配置由 load 后覆盖）。
 */
describe('PatrolDailyReportPanel 渲染', () => {
  const renderPanel = async (canEdit) => {
    const mod = await import('./PatrolDailyReportPanel.jsx')
    return renderToStaticMarkup(React.createElement(mod.default, { canEdit }))
  }

  it('① 表单骨架：开关/群组/通道/时刻/口径开关/明细上限/立即发送', async () => {
    const html = await renderPanel(true)
    expect(html).toContain('启用每日自动发送')
    expect(html).toContain('收件人群组')
    expect(html).toContain('日报发信通道')
    expect(html).toContain('每日发送时刻')
    expect(html).toContain('无异常也发平静简报')
    expect(html).toContain('排除仿真/测试流量')
    expect(html).toContain('每产品明细上限')
    expect(html).toContain('保存日报配置')
    expect(html).toContain('立即发送（测试/补发）')
    expect(html).toContain('尚未发送过日报') // status 未加载时的默认提示
  })

  it('② canEdit=false → 保存与立即发送按钮禁用', async () => {
    const html = await renderPanel(false)
    const buttons = html.match(/<button[^>]*type="button"[^>]*>/g) || []
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    expect(buttons.some((b) => b.includes('disabled'))).toBe(true)
  })
})
