import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Form,
  Popconfirm,
  Space,
  Table,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  deletePostUseJiraItem,
  deletePostUseJiraItems,
  listPostUseJiraItems,
  patchPostUseJiraItem,
} from '../lib/postUseJiraClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import PostUseJiraDrawer from '../components/actions/PostUseJiraDrawer.jsx'
import PostUseJiraCompositeFilter from '../components/actions/PostUseJiraCompositeFilter.jsx'
import {
  clearAllPostUseJiraFilters,
  createEmptyPostUseJiraFilters,
  postUseJiraFiltersToListQuery,
} from '../lib/postUseJiraFilterModel.js'

const PAGE_SIZE = 20

export default function PostUseJiraTab() {
  const { can } = useAuth()
  const canEdit = can('editRecord')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [filters, setFilters] = useState(createEmptyPostUseJiraFilters)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const query = useMemo(
    () => ({
      ...postUseJiraFiltersToListQuery(filters),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [filters, page],
  )

  const load = async () => {
    setLoading(true)
    try {
      const res = await listPostUseJiraItems(query)
      setItems(res?.items || [])
      setTotal(Number(res?.total) || 0)
    } catch (error) {
      message.error(error?.message || '加载用后即评JIRA失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.importMonth, query.productName, query.status, query.search, query.offset])

  const openEdit = (item) => {
    setEditing(item)
    form.setFieldsValue({
      jiraTicket: item.jiraTicket || '',
      status: item.status || '待处理',
      progress: item.progress || '',
    })
  }

  const saveEdit = async () => {
    if (!editing) return
    const values = await form.validateFields()
    setSaving(true)
    try {
      const { item } = await patchPostUseJiraItem(editing.id, {
        jiraTicket: values.jiraTicket,
        status: values.status,
        progress: values.progress,
      })
      setItems((list) => list.map((row) => (row.id === item.id ? item : row)))
      setEditing(item)
      message.success('已保存')
    } catch (error) {
      message.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const removeOne = async (id) => {
    try {
      await deletePostUseJiraItem(id)
      setSelectedRowKeys((keys) => keys.filter((key) => key !== id))
      if (editing?.id === id) setEditing(null)
      await load()
      message.success('已删除')
    } catch (error) {
      message.error(error?.message || '删除失败')
    }
  }

  const removeSelected = async () => {
    if (!selectedRowKeys.length) return
    try {
      await deletePostUseJiraItems(selectedRowKeys)
      setSelectedRowKeys([])
      setEditing(null)
      await load()
      message.success('已批量删除')
    } catch (error) {
      message.error(error?.message || '批量删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Typography.Paragraph type="secondary" className="!mb-0">
          从建议回访/溯源清单勾选部门内溯源后一键存档。仅可编辑 JIRA工单、状态、进展。
        </Typography.Paragraph>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          {canEdit ? (
            <Popconfirm
              title={`确定删除选中的 ${selectedRowKeys.length} 条？`}
              disabled={!selectedRowKeys.length}
              onConfirm={() => void removeSelected()}
            >
              <Button danger icon={<DeleteOutlined />} disabled={!selectedRowKeys.length}>
                批量删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <PostUseJiraCompositeFilter
          className="min-w-0 flex-1"
          filters={filters}
          onFiltersChange={(next) => {
            setFilters(next)
            setPage(1)
          }}
          onClearFilters={() => {
            setFilters(clearAllPostUseJiraFilters())
            setPage(1)
          }}
        />
      </div>
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={items}
        scroll={{ x: 1280 }}
        rowSelection={
          canEdit
            ? {
                selectedRowKeys,
                onChange: setSelectedRowKeys,
              }
            : undefined
        }
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          onChange: setPage,
        }}
        onRow={(record) => ({
          onClick: () => openEdit(record),
        })}
        columns={[
          { title: '数据月份', dataIndex: 'importMonth', width: 110 },
          { title: '客户名称', dataIndex: 'customerName', width: 160, ellipsis: true },
          { title: '客户编码', dataIndex: 'customerCode', width: 140, ellipsis: true },
          { title: '产品名称', dataIndex: 'productName', width: 140, ellipsis: true },
          { title: '客户反馈', dataIndex: 'customerFeedback', ellipsis: true },
          { title: 'JIRA工单', dataIndex: 'jiraTicket', width: 140, ellipsis: true },
          { title: '状态', dataIndex: 'status', width: 100 },
          { title: '进展', dataIndex: 'progress', width: 180, ellipsis: true },
          canEdit
            ? {
                title: '操作',
                key: 'actions',
                width: 80,
                render: (_value, row) => (
                  <Popconfirm
                    title="确定删除该记录？"
                    onConfirm={(event) => {
                      event?.stopPropagation?.()
                      void removeOne(row.id)
                    }}
                    onCancel={(event) => event?.stopPropagation?.()}
                  >
                    <Button
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </Popconfirm>
                ),
              }
            : null,
        ].filter(Boolean)}
      />
      <PostUseJiraDrawer
        item={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        form={form}
        canEdit={canEdit}
        saving={saving}
        onSave={() => void saveEdit()}
      />
    </div>
  )
}
