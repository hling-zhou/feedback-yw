import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 目录竞态守卫（2026-11-27 万投比目标值不渲染复盘产物）。
 *
 * 事故形态：TicketDashboardView 的 enabledProducts / catalogReady 原为空依赖
 * useMemo——managed 产品目录异步加载晚于组件挂载时，目录未就绪的窗口内
 * resolveCatalogKeyFromProductName 解析不出 catalog key → 万投比 productKey=null
 * → 目标值/达标判断全空，且目录加载完成后【永不重算】（依赖数组不含目录状态），
 * 用户在设置里配置的目标值在工作台趋势图/规模卡/产品总览三处全部不渲染。
 *
 * 本守卫用源码断言（React hook 依赖数组无法在 renderToStaticMarkup 下做行为断言）：
 * ① model/storedModel/enabledProducts/catalogReady 的 useMemo 依赖必须含 productCatalogMeta；
 * ② 禁止 enabledProducts/catalogReady 回潮空依赖 useMemo；
 * ③ 组件必须从 context 解构 productCatalogMeta。
 * 红绿自证：去掉任一依赖（复刻事故形态）→ 红。
 */

const SOURCE = readFileSync(
  new URL('./TicketDashboardView.jsx', import.meta.url),
  'utf-8',
)

describe('TicketDashboardView 目录竞态守卫（万投比目标值渲染依赖）', () => {
  it('enabledProducts / catalogReady 依赖含目录状态（空依赖回潮即红）', () => {
    expect(SOURCE).toMatch(
      /const enabledProducts = useMemo\(\(\) => getEnabledProducts\(\), \[productCatalogMeta\]\)/,
    )
    expect(SOURCE).toMatch(
      /const catalogReady = useMemo\(\(\) => isManagedCatalogLoaded\(\), \[productCatalogMeta\]\)/,
    )
  })

  it('model 与 storedModel 的 useMemo 依赖含 productCatalogMeta（目录就绪后必须重算万投比）', () => {
    const modelDep = /const model = useMemo\(\(\) => buildTicketStoryModel\(\{[\s\S]*?\}\), \[([^\]]+)\]\)/.exec(SOURCE)
    expect(modelDep, 'model useMemo 依赖数组存在').toBeTruthy()
    expect(modelDep[1]).toContain('productCatalogMeta')

    const storedDep = /const storedModel = useMemo\(\s*\(\) => applyTicketWorkbenchAggregate\([\s\S]*?\),\s*\[([^\]]+)\],\s*\)/.exec(SOURCE)
    expect(storedDep, 'storedModel useMemo 依赖数组存在').toBeTruthy()
    expect(storedDep[1]).toContain('productCatalogMeta')
  })

  it('组件从 useInsights 解构 productCatalogMeta', () => {
    expect(SOURCE).toMatch(/productCatalogMeta[^=]*= useInsights\(\)|= useInsights\(\)[^\n]*productCatalogMeta|\{[^}]*productCatalogMeta[^}]*\} = useInsights\(\)/)
  })
})
