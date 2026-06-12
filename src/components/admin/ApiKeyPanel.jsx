import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { CopyOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { API_KEY_SCOPE_LABELS, API_KEY_SCOPES } from '../../domain/apiKey.js'
import { createApiKey, listApiKeys, revokeApiKey } from '../../lib/apiKeyClient.js'

/** @typedef {import('../../lib/apiKeyClient.js').PublicApiKey} PublicApiKey */

const SCOPE_OPTIONS = API_KEY_SCOPES.map((scope) => ({
  value: scope,
  label: API_KEY_SCOPE_LABELS[scope],
}))

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export default function ApiKeyPanel() {
  const message = useAppMessage()
  const [items, setItems] = useState(/** @type {PublicApiKey[]} */ ([]))
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createdSecret, setCreatedSecret] = useState('')
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState(
    /** @type {import('../../domain/apiKey.js').ApiKeyScope[]} */ ([
      'requirement_ticket_progress:import',
    ]),
  )

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await listApiKeys())
    } catch (err) {
      setItems([])
      message.error(err instanceof Error ? err.message : '加载 API Key 失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const columns = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', width: 160 },
      {
        title: 'Key 前缀',
        dataIndex: 'keyPrefix',
        width: 160,
        render: (value) => <Typography.Text code>{value}…</Typography.Text>,
      },
      {
        title: '权限',
        dataIndex: 'scopes',
        render: (value) =>
          (value || []).map((scope) => (
            <Tag key={scope}>{API_KEY_SCOPE_LABELS[scope] || scope}</Tag>
          )),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 90,
        render: (value) =>
          value === 'active' ? <Tag color="green">有效</Tag> : <Tag>已吊销</Tag>,
      },
      {
        title: '最近使用',
        dataIndex: 'lastUsedAt',
        width: 168,
        render: formatDateTime,
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        width: 168,
        render: formatDateTime,
      },
      {
        title: '操作',
        key: 'actions',
        width: 90,
        render: (_, record) =>
          record.status === 'active' ? (
            <Button
              type="link"
              danger
              onClick={() => {
                Modal.confirm({
                  title: '吊销 API Key',
                  content: `确定吊销「${record.name}」？吊销后外部系统将无法继续使用该 Key。`,
                  okText: '吊销',
                  okType: 'danger',
                  cancelText: '取消',
                  onOk: async () => {
                    await revokeApiKey(record.id)
                    message.success('API Key 已吊销')
                    await loadItems()
                  },
                })
              }}
            >
              吊销
            </Button>
          ) : (
            '—'
          ),
      },
    ],
    [loadItems, message],
  )

  const resetCreateForm = () => {
    setName('')
    setScopes(['requirement_ticket_progress:import'])
    setCreatedSecret('')
  }

  const handleCreate = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      message.warning('请填写 Key 名称')
      return
    }
    if (!scopes.length) {
      message.warning('请至少选择一个权限范围')
      return
    }
    setCreating(true)
    try {
      const result = await createApiKey({ name: trimmedName, scopes })
      setCreatedSecret(String(result?.secret || ''))
      message.success('API Key 已创建')
      await loadItems()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建 API Key 失败')
    } finally {
      setCreating(false)
    }
  }

  const copySecret = async () => {
    if (!createdSecret) return
    try {
      await navigator.clipboard.writeText(createdSecret)
      message.success('已复制到剪贴板')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  return (
    <>
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <KeyOutlined />
            外部系统 API Key
          </span>
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              resetCreateForm()
              setCreateOpen(true)
            }}
          >
            新建 Key
          </Button>
        }
      >
        <Typography.Text type="secondary" className="mb-3 block text-xs">
          供外部系统调用导入接口。Key 仅在创建时显示一次，请妥善保存。请求时使用
          {' '}
          <Typography.Text code>Authorization: Bearer fi_live_…</Typography.Text>
          {' '}
          或
          {' '}
          <Typography.Text code>X-API-Key: fi_live_…</Typography.Text>
          。
        </Typography.Text>
        <Table
          size="small"
          loading={loading}
          rowKey="id"
          pagination={false}
          columns={columns}
          dataSource={items}
          scroll={{ x: 960 }}
        />
      </Card>

      <Modal
        title={createdSecret ? 'API Key 已创建' : '新建 API Key'}
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false)
          resetCreateForm()
        }}
        footer={
          createdSecret ? (
            <Button
              type="primary"
              onClick={() => {
                setCreateOpen(false)
                resetCreateForm()
              }}
            >
              我已保存
            </Button>
          ) : (
            <Space>
              <Button onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="primary" loading={creating} onClick={() => void handleCreate()}>
                创建
              </Button>
            </Space>
          )
        }
        destroyOnClose
      >
        {createdSecret ? (
          <div className="space-y-3">
            <Alert
              type="warning"
              showIcon
              message="请立即复制并妥善保存"
              description="关闭后将无法再次查看完整 Key。"
            />
            <Input.TextArea value={createdSecret} readOnly autoSize={{ minRows: 3, maxRows: 5 }} />
            <Button icon={<CopyOutlined />} onClick={() => void copySecret()}>
              复制 Key
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Typography.Text className="mb-1 block">名称</Typography.Text>
              <Input
                value={name}
                placeholder="如：需求系统对接"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Typography.Text className="mb-1 block">权限范围</Typography.Text>
              <Checkbox.Group
                className="flex flex-col gap-2"
                value={scopes}
                options={SCOPE_OPTIONS}
                onChange={(values) =>
                  setScopes(/** @type {import('../../domain/apiKey.js').ApiKeyScope[]} */ (values))
                }
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
