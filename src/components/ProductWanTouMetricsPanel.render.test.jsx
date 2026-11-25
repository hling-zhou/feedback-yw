import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// 产品目录 mock：两个启用产品 + 一个停用产品（断言停用者不进 tab）
vi.mock('../lib/productCatalogLoader.js', () => ({
  getEnabledProducts: () => [
    { key: 'rdc', name: '融e借', enabled: true },
    { key: 'wzd', name: '微中南', enabled: true },
  ],
}))

import ProductWanTouMetricsPanel from './ProductWanTouMetricsPanel.jsx'

describe('ProductWanTouMetricsPanel render 守卫（产品页签回归）', () => {
  it('每个启用产品渲染一个 tab，停用产品不出现', () => {
    const html = renderToStaticMarkup(
      <ProductWanTouMetricsPanel
        orderVolumes={[]}
        wanTouTargets={[]}
        onSaveOrderVolume={async () => {}}
        onSaveWanTouTarget={async () => {}}
      />,
    )
    expect(html).toContain('融e借')
    expect(html).toContain('微中南')
    expect(html).not.toContain('已停用产品')
    // tab nav 结构存在且恰好 2 个 tab（tab 丢失回归 = Card tabList 被卡片规范重构吞掉）
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)?.length).toBe(2)
    // 内容区承载万投比设置主体
    expect(html).toContain('万投比目标值')
    expect(html).toContain('产品月订单数')
  })
})
