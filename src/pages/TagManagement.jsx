import { useEffect, useMemo } from 'react'
import { Alert, Badge, Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from './Dashboard.shared.jsx'
import ConfigPublishStatusBar from '../components/tagManagement/ConfigPublishStatusBar.jsx'
import CustomTagsPanel from '../components/tagManagement/CustomTagsPanel.jsx'
import LlmTagReviewPanel from '../components/tagManagement/LlmTagReviewPanel.jsx'
import ProductConfigurationCenter from '../components/tagManagement/ProductConfigurationCenter.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

/** @type {Record<string, string>} */
const TAB_KEYS = {
  products: 'products',
  requestScene: 'request_scene',
  problemType: 'problem_type',
  journey: 'journey',
  review: 'review',
}

export default function TagManagement() {
  const { can } = useAuth()
  const readOnly = !can('manageTags')
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab') || TAB_KEYS.products
  const tab =
    rawTab === 'custom' ? TAB_KEYS.requestScene : rawTab

  useEffect(() => {
    if (searchParams.get('tab') === 'custom') {
      const next = new URLSearchParams(searchParams)
      next.set('tab', TAB_KEYS.requestScene)
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])
  const {
    tagCandidates,
    productCatalogMeta,
  } = useInsights()

  const pendingCount = tagCandidates.filter((c) => c.status === 'pending').length

  const items = useMemo(
    () => [
      {
        key: TAB_KEYS.products,
        label: '产品配置',
        children: (
          <ProductConfigurationCenter
            readOnly={readOnly}
            catalogMeta={productCatalogMeta}
          />
        ),
      },
      {
        key: TAB_KEYS.requestScene,
        label: '请求场景（通用）',
        children: <CustomTagsPanel tagKind="request_scene" readOnly={readOnly} />,
      },
      {
        key: TAB_KEYS.problemType,
        label: '问题类型（通用）',
        children: <CustomTagsPanel tagKind="problem_type" readOnly={readOnly} />,
      },
      {
        key: TAB_KEYS.journey,
        label: '用户旅程',
        children: <CustomTagsPanel tagKind="journey" readOnly={readOnly} />,
      },
      {
        key: TAB_KEYS.review,
        label: (
          <span>
            LLM 标签复核
            {pendingCount > 0 ? (
              <Badge count={pendingCount} size="small" className="ml-2" />
            ) : null}
          </span>
        ),
        children: <LlmTagReviewPanel readOnly={readOnly} />,
      },
    ],
    [pendingCount, productCatalogMeta, readOnly],
  )

  return (
    <div>
      <PageHeader
        title="标签管理"
        desc="产品配置、通用请求场景与问题类型、分产品用户旅程，以及 LLM 提议标签复核"
      />
      {readOnly && (
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message="当前为只读模式"
          description="查看者角色可浏览标签配置，但不能新增、修改或导入标签。"
        />
      )}
      {!readOnly && <ConfigPublishStatusBar />}
      <Tabs
        className="mt-4"
        activeKey={tab}
        onChange={(key) => {
          const next = new URLSearchParams(searchParams)
          next.set('tab', key)
          if (key !== TAB_KEYS.journey) next.delete('journeyProduct')
          setSearchParams(next)
        }}
        items={items}
      />
    </div>
  )
}
