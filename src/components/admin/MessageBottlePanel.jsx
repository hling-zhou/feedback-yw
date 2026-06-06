import { useCallback, useEffect, useState } from 'react'
import { Button, Image, Input, Modal, Table, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { listMessageBottles, updateMessageBottleProgress } from '../../lib/messageBottleClient.js'

/** @typedef {import('../../domain/messageBottle.js').MessageBottleAttachment} MessageBottleAttachment */

/**
 * @typedef {Object} MessageBottleRecord
 * @property {string} id
 * @property {string} userId
 * @property {string} username
 * @property {string} content
 * @property {MessageBottleAttachment[]} attachments
 * @property {string} progress
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @param {{ attachments: MessageBottleAttachment[] }} props
 */
function AttachmentPreview({ attachments }) {
  if (!attachments?.length) {
    return <Typography.Text type="secondary">—</Typography.Text>
  }
  return (
    <Image.PreviewGroup>
      <div className="flex flex-wrap gap-2">
        {attachments.map((item, index) => (
          <Image
            key={`${item.fileName}-${index}`}
            src={item.dataUrl}
            alt={item.fileName}
            width={48}
            height={48}
            className="rounded border border-ink-200 object-cover"
          />
        ))}
      </div>
    </Image.PreviewGroup>
  )
}

export default function MessageBottlePanel() {
  const message = useAppMessage()
  const { can } = useAuth()
  const canManage = can('manageMessageBottles')
  const [items, setItems] = useState(/** @type {MessageBottleRecord[]} */ ([]))
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detailItem, setDetailItem] = useState(/** @type {MessageBottleRecord | null} */ (null))
  const [draftProgress, setDraftProgress] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listMessageBottles({ limit: 200 })
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (err) {
      setItems([])
      setTotal(0)
      message.error(err instanceof Error ? err.message : '加载漂流瓶失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  const openDetail = (record) => {
    setDetailItem(record)
    setDraftProgress(record.progress || '')
  }

  const saveProgress = async () => {
    if (!detailItem || !canManage) return
    const progress = draftProgress.trim()
    if (!progress) {
      message.warning('请填写处理进展')
      return
    }
    setSaving(true)
    try {
      const data = await updateMessageBottleProgress(detailItem.id, progress)
      setItems((prev) => prev.map((item) => (item.id === detailItem.id ? data.item : item)))
      message.success('处理进展已更新')
      setDetailItem(null)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 168,
      render: (value) => (value ? new Date(value).toLocaleString('zh-CN') : '—'),
    },
    { title: '提交人', dataIndex: 'username', width: 100 },
    {
      title: '内容',
      dataIndex: 'content',
      ellipsis: true,
      render: (value, record) => (
        <Button type="link" className="!h-auto !px-0 !text-left" onClick={() => openDetail(record)}>
          {value}
        </Button>
      ),
    },
    {
      title: '附件',
      key: 'attachments',
      width: 120,
      render: (_, record) => <AttachmentPreview attachments={record.attachments} />,
    },
    {
      title: '处理进展',
      dataIndex: 'progress',
      width: 180,
      render: (value, record) =>
        canManage ? (
          <Button type="link" className="!h-auto !px-0 !text-left" onClick={() => openDetail(record)}>
            {value || '待处理'}
          </Button>
        ) : (
          value || '待处理'
        ),
    },
  ]

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Typography.Text type="secondary" className="text-sm">
          共 {total} 条用户反馈
        </Typography.Text>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          刷新
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 10, showTotal: (count) => `共 ${count} 条` }}
      />

      <Modal
        title={canManage ? '漂流瓶详情 · 更新处理进展' : '漂流瓶详情'}
        open={Boolean(detailItem)}
        okText={canManage ? '保存进展' : undefined}
        okButtonProps={{ style: canManage ? undefined : { display: 'none' } }}
        confirmLoading={saving}
        onCancel={() => setDetailItem(null)}
        onOk={canManage ? () => void saveProgress() : undefined}
        width={640}
      >
        {detailItem ? (
          <div className="space-y-4">
            <div>
              <Typography.Text type="secondary" className="mb-1 block text-xs">
                提交人 · {detailItem.username} · {new Date(detailItem.createdAt).toLocaleString('zh-CN')}
              </Typography.Text>
              <Typography.Paragraph className="whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-sm">
                {detailItem.content}
              </Typography.Paragraph>
            </div>
            <AttachmentPreview attachments={detailItem.attachments} />
            {canManage ? (
              <div>
                <Typography.Text className="mb-2 block text-sm">处理进展</Typography.Text>
                <Input.TextArea
                  value={draftProgress}
                  onChange={(e) => setDraftProgress(e.target.value)}
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  maxLength={500}
                  placeholder="例如：待处理 / 处理中 / 已采纳 / 已关闭"
                />
                <Typography.Text type="secondary" className="mt-1 block text-right text-xs">
                  {draftProgress.length} / 500
                </Typography.Text>
              </div>
            ) : (
              <div>
                <Typography.Text className="mb-1 block text-sm">处理进展</Typography.Text>
                <Typography.Text>{detailItem.progress || '待处理'}</Typography.Text>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
