import { useEffect, useMemo } from 'react'
import { Alert, Badge } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from './Dashboard.shared.jsx'
import WorkbenchTabNav from '../components/workbench/WorkbenchTabNav.jsx'
import CustomTagsPanel from '../components/tagManagement/CustomTagsPanel.jsx'
import LlmTagReviewPanel from '../components/tagManagement/LlmTagReviewPanel.jsx'
import TagCorrectionReviewPanel from '../components/tagManagement/TagCorrectionReviewPanel.jsx'
import PostUseKeyCustomersPanel from '../components/tagManagement/PostUseKeyCustomersPanel.jsx'
import ProductConfigurationCenter from '../components/tagManagement/ProductConfigurationCenter.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

/** @type {Record<string, string>} */
const TAB_KEYS = {
  products: 'products',
  requestScene: 'request_scene',
  problemType: 'problem_type',
  journey: 'journey',
  keyCustomers: 'key_customers',
  review: 'review',
  correction: 'correction',
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
      },
      {
        key: TAB_KEYS.requestScene,
        label: '请求场景（通用）',
      },
      {
        key: TAB_KEYS.problemType,
        label: '问题类型（通用）',
      },
      {
        key: TAB_KEYS.journey,
        label: '用户旅程',
      },
      {
        key: TAB_KEYS.keyCustomers,
        label: '重点客户',
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
      },
      {
        key: TAB_KEYS.correction,
        label: '改标学习',
      },
    ],
    [pendingCount],
  )

  const renderTabContent = (key) => {
    switch (key) {
      case TAB_KEYS.products:
        return <ProductConfigurationCenter readOnly={readOnly} catalogMeta={productCatalogMeta} />
      case TAB_KEYS.requestScene:
        return <CustomTagsPanel tagKind="request_scene" readOnly={readOnly} />
      case TAB_KEYS.problemType:
        return <CustomTagsPanel tagKind="problem_type" readOnly={readOnly} />
      case TAB_KEYS.journey:
        return <CustomTagsPanel tagKind="journey" readOnly={readOnly} />
      case TAB_KEYS.keyCustomers:
        return <PostUseKeyCustomersPanel readOnly={readOnly} />
      case TAB_KEYS.review:
        return <LlmTagReviewPanel readOnly={readOnly} />
      case TAB_KEYS.correction:
        return <TagCorrectionReviewPanel readOnly={readOnly} />
      default:
        return null
    }
  }

  return (
    <div>
      <PageHeader
        title="对象与标签"
        desc="产品配置、通用请求场景与问题类型、分产品用户旅程、重点客户名单、LLM 提议标签复核，以及改标学习"
      />
      {readOnly && (
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message="当前为只读模式"
          description="查看者角色可浏览对象与标签配置，但不能新增、修改或导入。"
        />
      )}
      <WorkbenchTabNav
        className="mt-4"
        activeKey={tab}
        items={items}
        onChange={(key) => {
          const next = new URLSearchParams(searchParams)
          next.set('tab', key)
          if (key !== TAB_KEYS.journey) next.delete('journeyProduct')
          if (key !== TAB_KEYS.products) next.delete('productView')
          setSearchParams(next)
        }}
      />
      <div className="mt-4">
        {renderTabContent(tab)}
      </div>
    </div>
  )
}
