import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Modal, Select, Space, Table, Tag, Typography, Input } from 'antd'
import { EditOutlined, SaveOutlined, CloseOutlined, RollbackOutlined } from '@ant-design/icons'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import {
  listCuratedTaxonomies,
  getCuratedTaxonomy,
  updateCuratedTaxonomy } from '../../lib/curatedTaxonomyClient.js'

const { TextArea } = Input

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

/**
 * 行动建议分类法管理面板。
 * 列出各产品的 curated taxonomy JSON，支持查看 / 编辑 / 保存。
 */
export default function CuratedTaxonomyPanel({ canEdit }) {
  const message = useAppMessage()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [jsonError, setJsonError] = useState(null)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listCuratedTaxonomies()
      setItems(data.items || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载分类法列表失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleEdit = async (product) => {
    try {
      const tax = await getCuratedTaxonomy(product)
      const formatted = JSON.stringify(tax, null, 2)
      setEditingProduct(product)
      setEditContent(formatted)
      setOriginalContent(formatted)
      setJsonError(null)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载分类法失败')
    }
  }

  const handleContentChange = (e) => {
    const val = e.target.value
    setEditContent(val)
    // 实时校验 JSON
    try {
      JSON.parse(val)
      setJsonError(null)
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'JSON 格式错误')
    }
  }

  const handleSave = async () => {
    if (jsonError) {
      message.error('JSON 格式有误，请修正后再保存')
      return
    }
    let parsed
    try {
      parsed = JSON.parse(editContent)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'JSON 解析失败')
      return
    }
    if (!Array.isArray(parsed.families)) {
      message.error('families 字段必须是数组')
      return
    }

    setSaving(true)
    try {
      await updateCuratedTaxonomy(editingProduct, parsed)
      message.success(`分类法「${editingProduct}」已保存`)
      setEditingProduct(null)
      setEditContent('')
      setOriginalContent('')
      await loadItems()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    if (editContent !== originalContent) {
      Modal.confirm({
        title: '放弃修改',
        content: '当前内容已修改，确定放弃？',
        okText: '放弃',
        okType: 'danger',
        cancelText: '继续编辑',
        onOk: () => {
          setEditingProduct(null)
          setEditContent('')
          setOriginalContent('')
          setJsonError(null)
        } })
    } else {
      setEditingProduct(null)
      setEditContent('')
      setOriginalContent('')
      setJsonError(null)
    }
  }

  const handleReset = () => {
    setEditContent(originalContent)
    setJsonError(null)
  }

  const isDirty = editContent !== originalContent

  const columns = useMemo(
    () => [
      {
        title: '产品',
        key: 'product',
        render: (_, r) => (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{r.product}</Typography.Text>
            <Typography.Text type="secondary" code>
              {r.file}
            </Typography.Text>
          </Space>
        ) },
      {
        title: '版本',
        dataIndex: 'version',
        width: 140,
        render: (v) => v || '—' },
      {
        title: 'Family 数',
        dataIndex: 'families',
        width: 100,
        align: 'right',
        render: (v) => (v != null ? `${v} 个` : '—') },
      {
        title: '最后修改',
        dataIndex: 'lastModified',
        width: 168,
        render: formatDateTime },
      {
        title: '状态',
        key: 'status',
        width: 80,
        render: (_, r) =>
          r.exists ? (
            <Tag color="success">已加载</Tag>
          ) : (
            <Tag color="default">未创建</Tag>
          ) },
      {
        title: '操作',
        key: 'actions',
        width: 90,
        render: (_, r) => (
          <Button
            type="link"
            icon={<EditOutlined />}
            disabled={!canEdit || !r.exists}
            onClick={() => handleEdit(r.product)}
          >
            编辑
          </Button>
        ) },
    ],
    [],
  )

  return (
    <div className="page-card"><div className="page-card-header"><span className="page-card-title">行动建议分类法</span><div>
        <Button onClick={() => loadItems()} loading={loading}>
          刷新
        </Button>
      </div></div>
      <Typography.Text type="secondary" className="mb-3 block text-xs">
        管理各产品的行动建议分类法（curated JSON）。编辑 family 正则与子议题，保存后写入服务端；
        在洞察工作台点「生成 / 刷新洞察」后，引擎会用新分类法重新跑门禁。
      </Typography.Text>

      {items.length === 0 && !loading ? (
        <Alert
          type="info"
          showIcon
          message="暂无分类法"
          description="分类法文件应在服务端 scripts/ 目录下。请联系管理员确认部署。"
        />
      ) : (
        <Table
          size="small"
          loading={loading}
          rowKey="product"
          pagination={false}
          columns={columns}
          dataSource={items}
          scroll={{ x: 720 }}
        />
      )}

      {/* 编辑抽屉 */}
      <Modal
        title={`编辑分类法 — ${editingProduct || ''}`}
        open={Boolean(editingProduct)}
        onCancel={handleCancel}
        width="90%"
        style={{ maxWidth: 1200 }}
        footer={
          <div className="flex items-center justify-between">
            <Space>
              {jsonError ? (
                <Typography.Text type="danger" className="text-xs">
                  JSON 错误：{jsonError}
                </Typography.Text>
              ) : isDirty ? (
                <Typography.Text type="warning" className="text-xs">
                  已修改，未保存
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary" className="text-xs">
                  无修改
                </Typography.Text>
              )}
            </Space>
            <Space>
              <Button
                icon={<RollbackOutlined />}
                disabled={!isDirty || saving}
                onClick={handleReset}
              >
                还原
              </Button>
              <Button icon={<CloseOutlined />} onClick={handleCancel} disabled={saving}>
                取消
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saving}
                disabled={Boolean(jsonError) || !isDirty || !canEdit}
                onClick={() => void handleSave()}
              >
                保存
              </Button>
            </Space>
          </div>
        }
      >
        {editingProduct && (
          <TextArea
            value={editContent}
            onChange={handleContentChange}
            autoSize={{ minRows: 20, maxRows: 35 }}
            disabled={!canEdit}
            className="font-mono text-xs"
            spellCheck={false}
            style={{ fontFamily: 'monospace' }}
          />
        )}
      </Modal>
    </div>
  )
}
