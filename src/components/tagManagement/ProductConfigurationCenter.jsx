import { Tabs } from 'antd'
import ProductCatalogPanel from '../ProductCatalogPanel.jsx'
import JourneyTemplatePanel from './JourneyTemplatePanel.jsx'

/**
 * 产品、规格、旅程模板集中管理
 * @param {Object} props
 * @param {import('../../context/InsightsContext.jsx').InsightsContextValue['productCatalogMeta']} props.catalogMeta
 * @param {boolean} [props.readOnly]
 */
export default function ProductConfigurationCenter({ catalogMeta, readOnly = false }) {
  return (
    <Tabs
      defaultActiveKey="catalog"
      items={[
        {
          key: 'catalog',
          label: '产品与规格',
          children: <ProductCatalogPanel readOnly={readOnly} catalogMeta={catalogMeta} />,
        },
        {
          key: 'journey_templates',
          label: '旅程模板',
          children: <JourneyTemplatePanel />,
        },
      ]}
    />
  )
}
