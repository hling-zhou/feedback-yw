import { useMemo } from 'react'
import { Segmented, Typography } from 'antd'
import { useSearchParams } from 'react-router-dom'
import ProductCatalogPanel from '../ProductCatalogPanel.jsx'
import JourneyTemplatePanel from './JourneyTemplatePanel.jsx'

const VIEW_KEYS = {
  catalog: 'catalog',
  journeyTemplates: 'journey_templates',
}

const VIEW_OPTIONS = [
  { label: '产品与规格', value: VIEW_KEYS.catalog },
  { label: '旅程模板', value: VIEW_KEYS.journeyTemplates },
]

/**
 * 产品、规格、旅程模板集中管理（一级 Tabs 下用 Segmented 作二级切换）
 * @param {Object} props
 * @param {import('../../context/InsightsContext.jsx').InsightsContextValue['productCatalogMeta']} props.catalogMeta
 * @param {boolean} [props.readOnly]
 */
export default function ProductConfigurationCenter({ catalogMeta, readOnly = false }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawView = searchParams.get('productView')
  const view =
    rawView === VIEW_KEYS.journeyTemplates ? VIEW_KEYS.journeyTemplates : VIEW_KEYS.catalog

  const viewLabel = useMemo(
    () => VIEW_OPTIONS.find((o) => o.value === view)?.label ?? '产品与规格',
    [view],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Typography.Text type="secondary" className="text-sm">
          产品配置 · {viewLabel}
        </Typography.Text>
        <Segmented
          value={view}
          options={VIEW_OPTIONS}
          onChange={(next) => {
            const params = new URLSearchParams(searchParams)
            if (next === VIEW_KEYS.catalog) params.delete('productView')
            else params.set('productView', String(next))
            setSearchParams(params)
          }}
        />
      </div>
      {view === VIEW_KEYS.catalog ? (
        <ProductCatalogPanel readOnly={readOnly} catalogMeta={catalogMeta} />
      ) : (
        <JourneyTemplatePanel />
      )}
    </div>
  )
}
