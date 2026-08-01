import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProductCatalogPanel from './ProductCatalogPanel.jsx'

const getManagedProductCatalogSnapshot = vi.fn()

vi.mock('../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock('../context/InsightsContext.jsx', () => ({
  useInsights: () => ({
    getManagedProductCatalogSnapshot,
    saveManagedProductCatalog: vi.fn(),
    importManagedProductCatalog: vi.fn(),
    productCatalogReloading: false,
  }),
}))

describe('ProductCatalogPanel render', () => {
  beforeEach(() => {
    getManagedProductCatalogSnapshot.mockResolvedValue({ products: [] })
  })

  it('renders managed source copy without throwing', () => {
    const html = renderToStaticMarkup(
      <ProductCatalogPanel
        catalogMeta={{ source: 'managed', loadedAt: '2026-08-01T10:00:00.000Z' }}
      />,
    )

    expect(html).toContain('当前使用')
    expect(html).toContain('共享库配置')
  })
})
