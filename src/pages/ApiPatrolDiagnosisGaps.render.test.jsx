import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 诊断能力需求池页面守卫（11-19）：真渲染冒烟（挂载不炸/锚点文案）+ 源码契约断言
 * （数据链路/交付动作/只读/表格模式/分区形态/引导卡约束/注册双保险）。
 * renderToStaticMarkup 不跑 useEffect——数据加载态断言走源码契约（先例 ApiPatrolFailures.render.test）。
 */

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'u1', role: 'admin', username: 'tester' } }),
}))
vi.mock('../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))
vi.mock('../lib/apiClient.js', () => ({
  apiFetch: vi.fn(async () => ({ stats: { groupCount: 0, uncoveredCount: 0, coveredCount: 0, apiCount: 0, poolCount: 0 }, uncoveredPools: [], rows: [] })),
}))

const Content = (await import('../components/apiPatrol/ApiPatrolDiagnosisGapsContent.jsx')).default

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolDiagnosisGapsContent.jsx'),
  'utf-8',
)
const routerSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'router.jsx'),
  'utf-8',
)
const shellSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'AppShell.jsx'),
  'utf-8',
)

describe('ApiPatrolDiagnosisGaps 诊断能力需求池', () => {
  it('真渲染冒烟：引导卡定位文案 + 分区二标题 + 空态 + 快捷键（挂载不炸）', () => {
    const html = renderToStaticMarkup(React.createElement(Content))
    expect(html).toContain('诊断能力需求池')
    expect(html).toContain('云网工作台 MCP 日志服务诊断能力建设的需求输入')
    expect(html).toContain('池已接入 MCP，但查不到失败日志')
    expect(html).toContain('近7天')
    expect(html).toContain('近30天')
    expect(html).toContain('T-1')
  })

  it('源码契约①数据链路：summary 端点 + groups 下钻（rootCauseL1=诊断能力缺口 + apiPathExact + poolName）', () => {
    expect(src).toContain("apiFetch(`/api/patrol/diagnosis-gaps/summary?${qs}`)")
    expect(src).toContain("rootCauseL1: '诊断能力缺口'")
    expect(src).toContain('qs.set(\'apiPathExact\'')
    expect(src).toContain("qs.set('poolName'")
  })

  it('源码契约②交付动作：聚合行复制全量请求ID串 + 明细行复制 firstRequestId（换行分隔）', () => {
    expect(src).toContain("copyTextToClipboard")
    expect(src).toContain("ids.join('\\n')")
    expect(src).toContain('已复制 RequestID')
  })

  it('源码契约③只读复用：FailureGroupDrawer 具名导入 + readOnly + 无 PATCH 写路径', () => {
    expect(src).toContain("import { FailureGroupDrawer } from './ApiPatrolFailuresContent.jsx'")
    expect(src).toContain('readOnly')
    expect(src).not.toContain('method: \'PATCH\'')
    expect(src).not.toMatch(/method:\s*'PATCH'/)
  })

  it('源码契约④表格模式：useColumnResize 两实例 + sumColumnsWidth + sticky + paginationShowTotal', () => {
    expect(src).toContain("tableKey: 'patrol.diagnosisGaps.agg'")
    expect(src).toContain("tableKey: 'patrol.diagnosisGaps.detail'")
    expect(src).toContain('sumColumnsWidth(aggColumns)')
    expect(src).toContain('sumColumnsWidth(detailColumns)')
    expect(src).toContain('sticky={{ offsetHeader: 0 }}')
    expect(src).toContain('paginationShowTotal')
  })

  it('源码契约⑤分区形态：分区一数据驱动条件渲染 + 明细下钻才现 + 查看全部明细入口', () => {
    expect(src).toMatch(/uncoveredPools\.length > 0 && \(/)
    expect(src).toContain('查看全部明细')
    expect(src).toMatch(/\{drill && \(/)
  })

  it('源码契约⑥引导卡约束：无三步用法（①）+ 无 metric-card（六指标卡防回潮）', () => {
    expect(src).not.toContain('①')
    expect(src).not.toContain('metric-card')
  })

  it('源码契约⑦注册双保险：router 路由 + AppShell 导航 leaf', () => {
    expect(routerSrc).toContain("path: 'api-patrol/diagnosis-gaps'")
    expect(shellSrc).toContain("key: '/api-patrol/diagnosis-gaps'")
    expect(shellSrc).toContain("label: '诊断能力需求'")
  })
})
