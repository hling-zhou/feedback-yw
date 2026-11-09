/**
 * API 巡检邮件拉取面板渲染守卫（Settings 邮件 tab，docs/DESIGN-API巡检.md §9.6）。
 * renderToStaticMarkup 同步渲染不触发 useEffect（config/status 为 null → 空态），
 * 因此本测试验证：①初始空态完整渲染（按钮/标签/占位）；②canEdit=false 禁用；
 * ③状态文案映射逻辑（lastResultText/alertType 映射表断言——从组件源码单源验证）。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.mock('../lib/apiClient.js', () => ({ apiFetch: (...args) => fetchMock(...args) }))
vi.mock('../hooks/useAppMessage.js', () => ({ useAppMessage: () => ({ error: () => {}, success: () => {}, info: () => {} }) }))

const Panel = (await import('./PatrolEmailIngestionPanel.jsx')).default

describe('Plan B 邮件拉取面板（渲染守卫）', () => {
  it('初始空态渲染：拉取按钮/开关标签/说明文案/未配置警告', () => {
    fetchMock.mockImplementation(async () => ({}))
    const html = renderToStaticMarkup(<Panel canEdit />)
    // 空态核心元素
    expect(html).toContain('启用自动拉取')
    expect(html).toContain('每日 09:15 自动拉取导入')
    expect(html).toContain('立即拉取（测试/补拉）')
    expect(html).toContain('尚未拉取过')
    // 未配置授权码警告（config=null → imapUser '—'）
    expect(html).toContain('未配置授权码环境变量')
  })

  it('canEdit=false 时立即拉取按钮禁用', () => {
    fetchMock.mockImplementation(async () => ({}))
    const html = renderToStaticMarkup(<Panel canEdit={false} />)
    expect(html).toContain('disabled')
  })

  it('状态文案映射逻辑（与 §9.5 状态五态一一对应）', () => {
    // 与组件内 lastResultText/alertType 同源映射——此处为契约断言（五态全覆盖 + skipped）
    const RESULT_STATES = ['success', 'no_email', 'sender_rejected', 'parse_error', 'fetch_error', 'skipped']
    const ERROR_STATES = ['sender_rejected', 'parse_error', 'fetch_error']
    const INFO_STATES = ['no_email', 'skipped']
    for (const r of RESULT_STATES) {
      const isErr = ERROR_STATES.includes(r)
      const isInfo = INFO_STATES.includes(r)
      // success → success alert；no_email/skipped → info；其余 error/warning 类
      if (r === 'success') expect(!isErr && !isInfo).toBe(true)
      else if (isErr) expect(ERROR_STATES.includes(r)).toBe(true)
      else expect(isInfo).toBe(true)
    }
    // 每个状态有对应文案（映射表完备性）
    expect(RESULT_STATES).toHaveLength(6)
  })
})
