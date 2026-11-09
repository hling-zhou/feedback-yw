// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * VersionRefreshBanner effect 链路真测试（2026-11-09）。
 *
 * 与 ProblemRecognitionBanner.render.test.jsx 同款挂载方式（jsdom +
 * createRoot + act）：mock 全局 fetch 与页面 DOM 资产引用，驱动组件
 * 完整 effect 路径（首帧 → 指纹采集 → 轮询 → 过期判定 → 横幅渲染）。
 *
 * 真实输入样本锚定：指纹 HTML 用 Vite 生产产物实况形态
 * （/assets/index-<hash>.js|css），dev 形态用 /src/main.jsx 引用。
 */

const PROD_HTML_LATEST = `<!doctype html>
<html lang="zh-CN">
  <head>
    <link rel="stylesheet" crossorigin href="/assets/index-Ab12Cd34.css">
    <script type="module" crossorigin src="/assets/index-Ef56Gh78.js"></script>
  </head>
</html>`

const fetchMock = vi.fn()

vi.stubGlobal('fetch', fetchMock)
// React act() 环境声明（消除 jsdom 下 act 警告）
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const { default: VersionRefreshBanner } = await import('./VersionRefreshBanner.jsx')

/**
 * 在 jsdom document 中注入页面资产引用（模拟当前 bundle 的 DOM 实况）。
 * @param {string[]} assetUrls
 */
function injectPageAssets(assetUrls) {
  for (const url of assetUrls) {
    const el = document.createElement(url.endsWith('.css') ? 'link' : 'script')
    if (url.endsWith('.css')) {
      el.setAttribute('rel', 'stylesheet')
      el.setAttribute('href', url)
    } else {
      el.setAttribute('src', url)
    }
    document.head.appendChild(el)
  }
}

/**
 * 挂载 → flush 异步（真实计时器：挂载即探测一轮 + 10ms 余量）→ 取 innerHTML。
 * 不用 vi.useFakeTimers()：假计时器会让 Promise 排队的 setTimeout 永不 resolve，
 * 挂载即探测的真实时序足够驱动断言（无需快进 5 分钟轮询）。
 * @returns {Promise<string>}
 */
async function renderBanner() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(VersionRefreshBanner))
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
  const html = container.innerHTML
  root.unmount()
  container.remove()
  return html
}

/** 秒级驱动一轮探针（PROBE_INTERVAL_MS 是 5 分钟，测试用真实等待）。 */
async function flushProbeRound() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

beforeEach(() => {
  document.head.innerHTML = ''
  fetchMock.mockReset()
})

describe('VersionRefreshBanner（长开标签页版本探针）', () => {
  it('dev 形态（DOM 无 /assets/ 引用）→ 轮询不启动（fetch 零调用）、不渲染', async () => {
    injectPageAssets(['/src/main.jsx'])
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => PROD_HTML_LATEST,
    })
    const html = await renderBanner()
    await flushProbeRound()
    await flushProbeRound()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(html).toBe('')
  })

  it('生产形态 + 指纹未变 → 横幅不出现', async () => {
    injectPageAssets(['/assets/index-Ef56Gh78.js', '/assets/index-Ab12Cd34.css'])
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => PROD_HTML_LATEST,
    })
    await renderBanner()
    await flushProbeRound()
    expect(fetchMock).toHaveBeenCalledWith(
      '/index.html',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('生产形态 + 服务端已发新版本（指纹变化）→ 横幅提示刷新', async () => {
    // 当前 DOM：旧 bundle
    injectPageAssets(['/assets/index-DNr4N5jY.js', '/assets/index-QN62NotS.css'])
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => PROD_HTML_LATEST, // 服务端：新 bundle
    })
    const html = await renderBanner()
    await flushProbeRound()
    expect(html).toContain('新版本已发布')
    expect(html).toContain('立即刷新')
    expect(html).toContain('稍后')
  })

  it('探针 fetch 失败 → 静默跳过（不渲染、不抛异常），下一轮重试', async () => {
    injectPageAssets(['/assets/index-DNr4N5jY.js'])
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const html = await renderBanner()
    await flushProbeRound()
    expect(html).toBe('')
  })

  it('探针返回非 200 → 静默跳过', async () => {
    injectPageAssets(['/assets/index-DNr4N5jY.js'])
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 })
    const html = await renderBanner()
    await flushProbeRound()
    expect(html).toBe('')
  })
})
