import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Table, Tag } from 'antd'
import { useInsights } from '../../context/InsightsContext.jsx'
import {
  countManagedProductJourneyL2,
  listJourneyTemplates,
  resolveJourneysForManagedProduct,
} from '../../lib/taxonomyLoader.js'
import { countCatalogRefsToTaxonomyKey } from '../../lib/productCenterSync.js'

/**
 * 旅程模板只读查看：模板的创建、更新与删除随产品规格自动同步
 */
export default function JourneyTemplatePanel() {
  const {
    getManagedTaxonomySnapshot,
    getManagedProductCatalogSnapshot,
    taxonomyMeta,
    productCatalogMeta,
  } = useInsights()

  const [snapshot, setSnapshot] = useState(null)
  const [catalogProducts, setCatalogProducts] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tax, catalog] = await Promise.all([
        getManagedTaxonomySnapshot(),
        getManagedProductCatalogSnapshot(),
      ])
      setSnapshot(tax)
      setCatalogProducts(catalog.products || [])
    } finally {
      setLoading(false)
    }
  }, [getManagedTaxonomySnapshot, getManagedProductCatalogSnapshot])

  useEffect(() => {
    load()
  }, [load, taxonomyMeta?.loadedAt, productCatalogMeta?.loadedAt])

  const templates = useMemo(() => {
    if (snapshot?.products) {
      return Object.values(snapshot.products).map((tax) => ({
        key: tax.key,
        name: tax.name,
        l1Count: resolveJourneysForManagedProduct(tax, tax.key).length,
        l2Count: countManagedProductJourneyL2(snapshot, tax.key),
      }))
    }
    return listJourneyTemplates()
  }, [snapshot])

  const columns = [
    {
      title: '模板 Key',
      dataIndex: 'key',
      width: 100,
      render: (k) => <code className="text-xs">{k}</code>,
    },
    { title: '名称', dataIndex: 'name' },
    {
      title: '一级环节',
      dataIndex: 'l1Count',
      width: 96,
      align: 'center',
      render: (n) => `${n} 个`,
    },
    {
      title: '二级环节',
      dataIndex: 'l2Count',
      width: 96,
      align: 'center',
      render: (n) => `${n} 个`,
    },
    {
      title: '关联产品',
      width: 100,
      render: (_, row) => {
        const n = countCatalogRefsToTaxonomyKey(catalogProducts, row.key)
        return n > 0 ? <Tag color="blue">{n} 个产品</Tag> : <Tag>未关联</Tag>
      },
    },
  ]

  return (
    <div>
      <Alert
        type="info"
        showIcon
        className="!mb-4"
        title="旅程模板随产品自动维护"
        description="新增产品时自动创建同名旅程模板（环节为空）；修改产品名称会同步更新模板；删除产品时移除对应模板。请在「分析维度 → 用户旅程」为各产品配置一级 / 二级环节。"
      />

      <Table
        rowKey="key"
        size="small"
        loading={loading}
        pagination={false}
        dataSource={templates}
        columns={columns}
      />
    </div>
  )
}
