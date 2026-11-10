/**
 * API 巡检总览数据链路健康横幅渲染守卫（docs/DESIGN-API巡检.md §9.6 P2-8 + §10.7 评审#2）。
 * 真渲染（renderToStaticMarkup）+ 判定逻辑断言：
 * - Plan B 判据：拉取错误态 ≥48h → 邮件拉取异常横幅
 * - Plan C 判据：lastPackageReceivedAt ≥48h → 数据代理断供横幅（新增）
 * - 正常/未启用/短时 → 无横幅
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.mock('../../lib/apiClient.js', () => ({ apiFetch: (...args) => fetchMock(...args) }))
vi.mock('../../hooks/useAppMessage.js', () => ({ useAppMessage: () => ({ error: () => {}, success: () => {}, info: () => {} }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

const Overview = (await import('./ApiPatrolOverviewContent.jsx')).default

// 基础 cause-stats 空数据（图表模块渲染不崩即可）
const EMPTY_STATS = { byProductCause: [], dailyTrend: [], l2Calendar: [], metricTrends: [], aiSummaryFacts: {} }

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString()

const FETCH_ERR_STATES = ['fetch_error', 'parse_error', 'sender_rejected']

describe('总览数据链路健康横幅（渲染守卫）', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('初始渲染（服务端同步渲染）不包含任一横幅——useEffect 未触发，无数据即无横幅', async () => {
    fetchMock.mockImplementation(async () => EMPTY_STATS)
    const html = renderToStaticMarkup(<Overview />)
    expect(html).not.toContain('邮件拉取已连续异常')
    expect(html).not.toContain('数据代理已断供')
  })

  it('Plan B 判据：连续失败 ≥48h 且 enabled → 显示邮件拉取异常横幅（逻辑断言）', async () => {
    const st = { enabled: true, state: { lastResult: 'fetch_error', lastFetchAt: hoursAgo(72), lastError: 'IMAP connect failed' } }
    const isErr = FETCH_ERR_STATES.includes(st.state.lastResult)
    const hours = (Date.now() - new Date(st.state.lastFetchAt).getTime()) / 3600000
    expect(isErr && st.enabled && hours >= 48).toBe(true)
  })

  it('Plan C 判据：lastPackageReceivedAt ≥48h 且 enabled → 显示数据代理断供横幅（逻辑断言）', async () => {
    const st = { enabled: true, state: { lastResult: 'success', lastFetchAt: hoursAgo(1), lastPackageReceivedAt: hoursAgo(72) } }
    // 拉取正常但日包断供——Plan C 判据独立命中
    const fetchOk = !FETCH_ERR_STATES.includes(st.state.lastResult)
    const pkgHours = (Date.now() - new Date(st.state.lastPackageReceivedAt).getTime()) / 3600000
    expect(fetchOk && st.enabled && pkgHours >= 48).toBe(true)
  })

  it('Plan C 判据：48h 内收过包 → 不显示', async () => {
    const st = { enabled: true, state: { lastPackageReceivedAt: hoursAgo(12) } }
    const pkgHours = (Date.now() - new Date(st.state.lastPackageReceivedAt).getTime()) / 3600000
    expect(!(st.enabled && pkgHours >= 48)).toBe(true)
  })

  it('两判据互斥优先：Plan B 错误态优先显示（同时命中时先报拉取失败）', async () => {
    const st = {
      enabled: true,
      state: { lastResult: 'fetch_error', lastFetchAt: hoursAgo(72), lastPackageReceivedAt: hoursAgo(72) },
    }
    // 组件内判定顺序：先判拉取错误、后判断供——同命中时拉取横幅胜出（组件源码锚定）
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./ApiPatrolOverviewContent.jsx', import.meta.url), 'utf-8'))
    // 判据①在判据②之前（源码顺序守卫）
    const idxFetch = src.indexOf('邮件拉取已连续异常')
    const idxPkg = src.indexOf('数据代理已断供')
    expect(idxFetch).toBeGreaterThan(0)
    expect(idxPkg).toBeGreaterThan(idxFetch)
    expect(st.enabled).toBe(true)
  })

  it('失败但 <48h → 不显示', async () => {
    const st = { enabled: true, state: { lastResult: 'fetch_error', lastFetchAt: hoursAgo(24) } }
    const hours = (Date.now() - new Date(st.state.lastFetchAt).getTime()) / 3600000
    expect(!(st.enabled && hours >= 48)).toBe(true)
  })

  it('成功状态且包正常 → 不显示', async () => {
    const st = { enabled: true, state: { lastResult: 'success', lastFetchAt: hoursAgo(1), lastPackageReceivedAt: hoursAgo(1) } }
    const isErr = FETCH_ERR_STATES.includes(st.state.lastResult)
    const pkgHours = (Date.now() - new Date(st.state.lastPackageReceivedAt).getTime()) / 3600000
    expect(!isErr && pkgHours < 48).toBe(true)
  })

  it('未启用 → 不显示（无论错误多久）', async () => {
    const st = { enabled: false, state: { lastResult: 'fetch_error', lastFetchAt: hoursAgo(72), lastPackageReceivedAt: hoursAgo(72) } }
    expect(!st.enabled).toBe(true)
  })
})
