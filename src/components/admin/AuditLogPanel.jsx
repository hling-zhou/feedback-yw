import { useCallback, useEffect, useState } from 'react'
import { Card, Table, Typography } from 'antd'
import { apiFetch } from '../../lib/apiClient.js'

/** @type {Record<string, string>} */
const ACTION_LABELS = {
  'storage.import_batch': '导入反馈批次',
  'storage.replace_all_records': '全量替换反馈',
  'storage.delete_record': '删除单条反馈',
  'storage.clear_imported_data': '清空导入数据',
  'storage.publish_taxonomy': '发布打标配置（手动/重试）',
  'storage.publish_product_catalog': '发布产品目录（手动/重试）',
  'storage.auto_publish_taxonomy': '自动备份打标配置到磁盘',
  'storage.auto_publish_product_catalog': '自动备份产品目录到磁盘',
  'storage.bootstrap_from_local': '本机数据迁移至服务端',
  'user.create': '创建用户',
  'user.update': '更新用户',
  'user.delete': '删除用户',
}

/**
 * @param {Record<string, unknown>} detail
 */
function formatDetail(detail) {
  if (!detail || typeof detail !== 'object') return '—'
  const parts = []
  if (detail.count != null) parts.push(`条数 ${detail.count}`)
  if (detail.recordsCleared != null) parts.push(`清除记录 ${detail.recordsCleared}`)
  if (detail.dataSourceType) parts.push(String(detail.dataSourceType))
  if (detail.importMonth) parts.push(String(detail.importMonth))
  if (detail.username) parts.push(String(detail.username))
  if (detail.userId) parts.push(`用户 ${detail.userId}`)
  if (detail.excelPath) parts.push('已写 Excel')
  if (parts.length) return parts.join(' · ')
  const raw = JSON.stringify(detail)
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw
}

export default function AuditLogPanel() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/api/audit?days=7')
      setEntries(data.entries || [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 168,
      render: (v) => (v ? new Date(v).toLocaleString('zh-CN') : '—'),
    },
    { title: '操作者', dataIndex: 'username', width: 100 },
    {
      title: '操作',
      dataIndex: 'action',
      width: 160,
      render: (action) => ACTION_LABELS[action] || action,
    },
    {
      title: '详情',
      dataIndex: 'detail',
      ellipsis: true,
      render: (detail) => formatDetail(detail),
    },
  ]

  return (
    <Card className="mt-6" title="操作审计（最近 7 天）">
      <Typography.Text type="secondary" className="mb-3 block text-xs">
        记录导入、清空、配置发布与用户变更；仅管理员可查看。
      </Typography.Text>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={entries}
        pagination={{ pageSize: 10, showSizeChanger: false }}
      />
    </Card>
  )
}
