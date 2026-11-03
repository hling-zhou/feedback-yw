// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('../../lib/generalizationClient.js', () => ({
  getGeneralizationPendingCount: vi.fn(async () => ({})),
}))
vi.mock('../../lib/observationClient.js', () => ({
  getObservationPendingCount: vi.fn(async () => ({})),
}))
vi.mock('react-router-dom', () => ({
  Link: ({ children }) => React.createElement('a', { href: '#' }, children),
}))

const { getGeneralizationPendingCount } =
  /** @type {any} */ (await import('../../lib/generalizationClient.js'))

const obsClient = /** @type {any} */ (await import('../../lib/observationClient.js'))

const { default: ProblemRecognitionBanner } = await import('./ProblemRecognitionBanner.jsx')

/**
 * 数据驱动渲染 helper：挂载 → flush 异步 → 取 innerHTML。
 * @param {Record<string, unknown>} props
 * @returns {Promise<string>}
 */
async function renderAsync(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(ProblemRecognitionBanner, props))
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
  const html = container.innerHTML
  root.unmount()
  container.remove()
  return html
}

describe('ProblemRecognitionBanner（合并横幅 · G2-5）', () => {
  it('三行全零：整条横幅不渲染', async () => {
    getGeneralizationPendingCount.mockResolvedValue({ total: 0, high: 0, medium: 0, low: 0, hints: 0 })
    obsClient.getObservationPendingCount.mockResolvedValue({ total: 0, high: 0, medium: 0, low: 0 })
    const html = await renderAsync({})
    expect(html).toBe('')
  })

  it('三行计数全呈现：建议 N / 命中举一反三 M / 命中留观 K，各带置信 breakdown 与跳转', async () => {
    getGeneralizationPendingCount.mockResolvedValue({
      total: 5, high: 2, medium: 3, low: 0,
      hints: 4, hintsHigh: 1, hintsMedium: 3,
    })
    obsClient.getObservationPendingCount.mockResolvedValue({ total: 7, high: 4, medium: 3, low: 0 })
    const html = await renderAsync({})
    expect(html).toContain('问题识别结果：16 条待处理')
    expect(html).toContain('有 4 条工单建议纳入举一反三')
    expect(html).toContain('高把握 1 条、中把握 3 条')
    expect(html).toContain('有 5 条工单疑似命中已有举一反三问题')
    expect(html).toContain('高置信 2 条、中置信 3 条')
    expect(html).toContain('有 7 条反馈疑似命中留观问题')
    expect(html).toContain('去处理')
  })

  it('G-pass 降级（hints=0）：只显后两行', async () => {
    getGeneralizationPendingCount.mockResolvedValue({
      total: 2, high: 1, medium: 1, low: 0, hints: 0, hintsHigh: 0, hintsMedium: 0,
    })
    obsClient.getObservationPendingCount.mockResolvedValue({ total: 3, high: 0, medium: 3, low: 0 })
    const html = await renderAsync({})
    expect(html).toContain('问题识别结果：5 条待处理')
    expect(html).not.toContain('建议纳入举一反三')
    expect(html).toContain('疑似命中已有举一反三问题')
    expect(html).toContain('疑似命中留观问题')
  })

  it('只有留观 pending：单行呈现（替代旧留观横幅语义）', async () => {
    getGeneralizationPendingCount.mockResolvedValue({ total: 0, high: 0, medium: 0, low: 0, hints: 0 })
    obsClient.getObservationPendingCount.mockResolvedValue({ total: 9, high: 6, medium: 3, low: 0 })
    const html = await renderAsync({})
    expect(html).toContain('问题识别结果：9 条待处理')
    expect(html).toContain('疑似命中留观问题')
    expect(html).not.toContain('举一反三')
  })

  it('拉取失败：不渲染（不打扰主流程）', async () => {
    getGeneralizationPendingCount.mockRejectedValue(new Error('api down'))
    const html = await renderAsync({})
    expect(html).toBe('')
  })
})
