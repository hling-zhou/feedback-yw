import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Space, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { fetchTaxonomyPublishStatus, publishTaxonomyToServer } from '../../lib/taxonomyPublishApi.js'
import {
  fetchProductCatalogPublishStatus,
  publishProductCatalogToServer,
} from '../../lib/productCatalogPublishApi.js'

/**
 * @param {{ lastPublishedAt?: string; lastPublishedBy?: string }} [meta]
 */
function formatLastPublish(meta) {
  if (!meta?.lastPublishedAt) return '尚未生成备份'
  const at = new Date(meta.lastPublishedAt).toLocaleString('zh-CN')
  const by = meta.lastPublishedBy ? `（${meta.lastPublishedBy}）` : ''
  return `${at}${by}`
}

export default function ConfigPublishStatusBar() {
  const [taxonomyStatus, setTaxonomyStatus] = useState(null)
  const [catalogStatus, setCatalogStatus] = useState(null)
  const [retrying, setRetrying] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const [tax, cat] = await Promise.all([
        fetchTaxonomyPublishStatus(),
        fetchProductCatalogPublishStatus(),
      ])
      setTaxonomyStatus(tax)
      setCatalogStatus(cat)
    } catch {
      /* 未登录时忽略 */
    }
  }, [])

  useEffect(() => {
    refreshStatus()
    const timer = setInterval(refreshStatus, 8000)
    return () => clearInterval(timer)
  }, [refreshStatus])

  const needsRetry =
    taxonomyStatus?.diskStale ||
    catalogStatus?.diskStale ||
    taxonomyStatus?.lastError ||
    catalogStatus?.lastError

  const handleRetry = async () => {
    setRetrying(true)
    try {
      if (taxonomyStatus?.diskStale || taxonomyStatus?.lastError) {
        await publishTaxonomyToServer({ writeJson: true })
      }
      if (catalogStatus?.diskStale || catalogStatus?.lastError) {
        await publishProductCatalogToServer({ writeJson: true })
      }
      await refreshStatus()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Alert
      className="mt-4"
      type={needsRetry ? 'warning' : 'info'}
      showIcon
      message="配置权威来源：共享数据库"
      description={
        <div className="space-y-2">
          <p>
            保存标签或产品目录后写入 <strong>auth.db</strong>，其他用户约 5 秒内同步。
            {needsRetry
              ? ' 磁盘 Excel/JSON 备份待同步或上次失败，可点击下方重试（请先关闭已打开的 Excel）。'
              : ' 生产环境保存后会自动生成 public/config 下的 Excel/JSON 备份。'}
          </p>
          <ul className="list-none space-y-1 text-sm m-0 p-0">
            <li>
              <strong>打标配置备份</strong>：{formatLastPublish(taxonomyStatus?.lastPublish)}
              {taxonomyStatus?.diskStale ? (
                <Typography.Text type="warning"> · 待同步</Typography.Text>
              ) : null}
              {taxonomyStatus?.lastError?.message ? (
                <Typography.Text type="danger">
                  {' '}
                  · {String(taxonomyStatus.lastError.message)}
                </Typography.Text>
              ) : null}
            </li>
            <li>
              <strong>产品目录备份</strong>：{formatLastPublish(catalogStatus?.lastPublish)}
              {catalogStatus?.diskStale ? (
                <Typography.Text type="warning"> · 待同步</Typography.Text>
              ) : null}
              {catalogStatus?.lastError?.message ? (
                <Typography.Text type="danger">
                  {' '}
                  · {String(catalogStatus.lastError.message)}
                </Typography.Text>
              ) : null}
            </li>
          </ul>
        </div>
      }
      action={
        needsRetry ? (
          <Space>
            <Button icon={<ReloadOutlined />} loading={retrying} onClick={() => void handleRetry()}>
              重试写盘备份
            </Button>
          </Space>
        ) : null
      }
    />
  )
}
