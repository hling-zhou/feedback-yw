import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Modal, Space, Table, Tag, Typography, Upload } from 'antd'
import { BookOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import {
  deleteKnowledgeBase,
  listKnowledgeBases,
  uploadKnowledgeBase,
} from '../../lib/knowledgeBaseClient.js'

/** @typedef {import('../../lib/knowledgeBaseClient.js').KnowledgeBaseSummary} KnowledgeBaseSummary */

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function KnowledgeBasePanel() {
  const message = useAppMessage()
  const [items, setItems] = useState(/** @type {KnowledgeBaseSummary[]} */ ([]))
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await listKnowledgeBases())
    } catch (err) {
      setItems([])
      message.error(err instanceof Error ? err.message : '加载知识库列表失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleUpload = async (file) => {
    setUploading(true)
    try {
      const text = await file.text()
      let parsed = null
      try {
        parsed = JSON.parse(text)
      } catch {
        message.error('文件不是合法的 JSON')
        return false
      }
      const productLine = String(parsed?.productLine ?? '').trim()
      if (!productLine) {
        message.error('缺少 productLine 字段')
        return false
      }
      if (!Array.isArray(parsed?.details) || parsed.details.length === 0) {
        message.error('details 为空或不是数组')
        return false
      }
      const existed = items.find((it) => it.productKey === productLine.toLowerCase())
      const proceed = async () => {
        try {
          await uploadKnowledgeBase(parsed)
          message.success(`知识库「${parsed.productName || productLine}」已上传`)
          await loadItems()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '上传失败')
        }
      }
      if (existed) {
        Modal.confirm({
          title: '替换现有知识库',
          content: `产品「${existed.productName || existed.productKey}」已有知识库，上传将覆盖。继续？`,
          okText: '覆盖上传',
          cancelText: '取消',
          onOk: () => proceed(),
        })
      } else {
        await proceed()
      }
    } finally {
      setUploading(false)
    }
    return false // 阻止 antd 自动上传
  }

  const handleDelete = (record) => {
    Modal.confirm({
      title: '删除知识库',
      content: `确定删除「${record.productName || record.productKey}」的知识库？删除后工单优化建议将不再引用该产品知识库。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteKnowledgeBase(record.productKey)
          message.success('已删除')
          await loadItems()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除失败')
        }
      },
    })
  }

  const columns = useMemo(
    () => [
      {
        title: '产品',
        key: 'product',
        render: (_, record) => (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{record.productName || record.productKey}</Typography.Text>
            <Typography.Text type="secondary" code>
              {record.productKey}
            </Typography.Text>
          </Space>
        ),
      },
      { title: '导出日期', dataIndex: 'exportDate', width: 120, render: (v) => v || '—' },
      {
        title: '上传人',
        dataIndex: 'uploadedByUsername',
        width: 120,
        render: (v) => v || '—',
      },
      {
        title: '上传时间',
        dataIndex: 'uploadedAt',
        width: 168,
        render: formatDateTime,
      },
      {
        title: '大小',
        dataIndex: 'sizeBytes',
        width: 100,
        align: 'right',
        render: formatSize,
      },
      {
        title: '操作',
        key: 'actions',
        width: 90,
        render: (_, record) => (
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        ),
      },
    ],
    [loadItems, message],
  )

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <BookOutlined />
          产品业务知识库
        </span>
      }
      extra={
        <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => void handleUpload(file)}>
          <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
            上传知识库
          </Button>
        </Upload>
      }
    >
      <Typography.Text type="secondary" className="mb-3 block text-xs">
        上传各产品的业务知识库 JSON（含 <Typography.Text code>productLine</Typography.Text>、
        <Typography.Text code>details</Typography.Text>）。工单自动分析的「优化建议」会检索引用其中相关规则/特性；
        同一产品重复上传即覆盖。
      </Typography.Text>
      {items.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message="暂无知识库"
          description="上传后，工单优化建议将获得产品知识库支撑。"
        />
      ) : (
        <Table
          size="small"
          loading={loading}
          rowKey="productKey"
          pagination={false}
          columns={columns}
          dataSource={items}
          scroll={{ x: 720 }}
        />
      )}
    </Card>
  )
}
