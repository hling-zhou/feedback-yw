import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Descriptions, Modal, Table, Typography } from 'antd'
import { apiFetch } from '../../lib/apiClient.js'

/** @typedef {{ id: string; userId?: string; username?: string; action: string; detail?: Record<string, unknown>; createdAt?: string }} AuditEntry */

/** @type {Record<string, string>} */
export const AUDIT_ACTION_LABELS = {
  'auth.logout': '退出登录',
  'storage.import_batch': '导入反馈批次',
  'storage.replace_all_records': '全量替换反馈',
  'storage.delete_record': '删除单条反馈',
  'storage.record_force_overwrite': '工单冲突强制覆盖',
  'storage.clear_imported_data': '清空导入数据',
  'storage.background_task_acquire': '获取后台任务锁',
  'storage.background_task_release': '释放后台任务锁',
  'storage.insight_rebuild_enqueue': '刷新洞察快照',
  'storage.publish_taxonomy': '发布打标配置（手动/重试）',
  'storage.publish_product_catalog': '发布产品目录（手动/重试）',
  'storage.auto_publish_taxonomy': '自动备份打标配置到磁盘',
  'storage.auto_publish_product_catalog': '自动备份产品目录到磁盘',
  'storage.bootstrap_from_local': '本机数据迁移至服务端',
  'action.create': '创建举措',
  'action.update': '更新举措',
  'action.delete': '删除举措',
  'action.unlink_tickets': '举措解关联工单',
  'user.create': '创建用户',
  'user.update': '更新用户',
  'user.delete': '删除用户',
}

/**
 * @param {Record<string, unknown>} detail
 */
export function formatAuditDetailSummary(detail) {
  if (!detail || typeof detail !== 'object') return '—'
  const parts = []
  if (detail.count != null) parts.push(`条数 ${detail.count}`)
  if (detail.recordsCleared != null) parts.push(`清除记录 ${detail.recordsCleared}`)
  if (detail.dataSourceType) parts.push(String(detail.dataSourceType))
  if (detail.importMonth) parts.push(String(detail.importMonth))
  if (detail.ticketId) parts.push(`工单 ${detail.ticketId}`)
  if (detail.recordId) parts.push(`记录 ${detail.recordId}`)
  if (detail.actionId) parts.push(`举措 ${detail.actionId}`)
  if (detail.fields && Array.isArray(detail.fields)) {
    parts.push(`字段 ${detail.fields.join('、')}`)
  }
  if (detail.username) parts.push(String(detail.username))
  if (detail.userId) parts.push(`用户 ${detail.userId}`)
  if (detail.excelPath) parts.push('已写 Excel')
  if (parts.length) return parts.join(' · ')
  const raw = JSON.stringify(detail)
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatAuditDetailJson(value) {
  if (value == null) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function AuditLogPanel() {
  const [entries, setEntries] = useState(/** @type {AuditEntry[]} */ ([]))
  const [loading, setLoading] = useState(false)
  const [detailEntry, setDetailEntry] = useState(/** @type {AuditEntry | null} */ (null))

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
      render: (action) => AUDIT_ACTION_LABELS[action] || action,
    },
    {
      title: '详情',
      dataIndex: 'detail',
      ellipsis: true,
      render: (detail, record) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{formatAuditDetailSummary(detail)}</span>
          <Button type="link" size="small" className="!px-0 shrink-0" onClick={() => setDetailEntry(record)}>
            查看
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
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

      <Modal
        title="审计详情"
        open={Boolean(detailEntry)}
        onCancel={() => setDetailEntry(null)}
        footer={[
          <Button key="close" onClick={() => setDetailEntry(null)}>
            关闭
          </Button>,
        ]}
        width={720}
        destroyOnClose
      >
        {detailEntry ? (
          <div className="space-y-4">
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="时间">
                {detailEntry.createdAt
                  ? new Date(detailEntry.createdAt).toLocaleString('zh-CN')
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="操作者">
                {detailEntry.username || detailEntry.userId || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="操作">
                {AUDIT_ACTION_LABELS[detailEntry.action] || detailEntry.action}
              </Descriptions.Item>
              <Descriptions.Item label="操作码">
                <Typography.Text code>{detailEntry.action}</Typography.Text>
              </Descriptions.Item>
            </Descriptions>
            <div>
              <Typography.Text type="secondary" className="mb-2 block text-xs">
                完整 detail JSON
              </Typography.Text>
              <pre className="max-h-96 overflow-auto rounded-md border border-ink-100 bg-ink-50/60 p-3 text-xs leading-relaxed text-ink-800">
                {formatAuditDetailJson(detailEntry.detail)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
