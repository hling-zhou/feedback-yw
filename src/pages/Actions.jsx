import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Popover,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { CopyOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { PageHeader } from './Dashboard.shared.jsx'
import {
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_STATUS_LABELS,
  ACTION_ITEM_CONTENT_MAX_LENGTH,
  deriveActionItemStatusFromSchedule,
} from '../domain/actionItem.js'
import { normalizeActionSchedule } from '../domain/actionSchedule.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  getActionItemStats,
  listActionItems,
  updateActionItem,
} from '../lib/actionItemClient.js'
import { syncLinkedTicketCopies } from '../lib/actionItemTicketSync.js'
import { listProducts } from '../lib/productTaxonomy.js'
import { useInsights } from '../context/InsightsContext.jsx'
import PermissionGate from '../components/auth/PermissionGate.jsx'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../domain/actionItem.js').ActionItemStatus} ActionItemStatus */

const PAGE_SIZE = 20

const STATUS_TAG_COLORS = {
  pending_evaluation: 'default',
  in_progress: 'blue',
  completed: 'green',
  suspended: '',
}

const STATUS_OPTIONS = ACTION_ITEM_STATUSES.map((value) => ({
  label: ACTION_ITEM_STATUS_LABELS[value],
  value,
}))

/**
 * @param {ActionItem['warningLevel']} level
 * @returns {string | undefined}
 */
function scheduleWarningClass(level) {
  if (level === 'orange') return 'text-amber-600 font-medium'
  if (level === 'red') return 'text-red-600 font-medium'
  return undefined
}

function LinkedTicketsCell({ ticketIds }) {
  const ids = ticketIds || []
  if (!ids.length) return <Typography.Text type="secondary">—</Typography.Text>

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(ids.join('\n'))
      message.success('已复制工单号')
    } catch {
      message.error('复制失败')
    }
  }

  const content = (
    <div className="max-h-48 overflow-y-auto">
      <Space direction="vertical" size={4} className="w-full">
        {ids.map((id) => (
          <Typography.Text key={id} copyable={{ text: id }} className="text-xs">
            {id}
          </Typography.Text>
        ))}
        <Button type="link" size="small" icon={<CopyOutlined />} onClick={copyAll} className="!px-0">
          复制全部
        </Button>
      </Space>
    </div>
  )

  return (
    <Popover content={content} title="关联工单" trigger="hover">
      <Button type="link" size="small" className="!px-0">
        {ids.length} 个工单
      </Button>
    </Popover>
  )
}

export default function Actions() {
  const { feedbacks, updateFeedback } = useInsights()
  const [items, setItems] = useState(/** @type {ActionItem[]} */ ([]))
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(
    /** @type {Record<ActionItemStatus, number>} */ ({
      pending_evaluation: 0,
      in_progress: 0,
      completed: 0,
      suspended: 0,
    }),
  )

  const [productKeys, setProductKeys] = useState(/** @type {string[]} */ ([]))
  const [statuses, setStatuses] = useState(/** @type {ActionItemStatus[]} */ ([]))
  const [ticketId, setTicketId] = useState('')
  const [dateRange, setDateRange] = useState(
    /** @type {[dayjs.Dayjs | null, dayjs.Dayjs | null] | null} */ (null),
  )

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(/** @type {ActionItem | null} */ (null))
  const [editForm] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const watchedSchedule = Form.useWatch('scheduleAt', editForm)

  const hasEditSchedule = useMemo(() => {
    if (!watchedSchedule) return false
    if (dayjs.isDayjs(watchedSchedule)) return watchedSchedule.isValid()
    return Boolean(String(watchedSchedule).trim())
  }, [watchedSchedule])

  const productOptions = useMemo(() => {
    return listProducts(feedbacks).map((p) => ({
      label: p.name,
      value: p.key,
    }))
  }, [feedbacks])

  const loadStats = useCallback(async () => {
    try {
      const data = await getActionItemStats()
      setStats(data.counts)
    } catch {
      /* ignore stats errors */
    }
  }, [])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listActionItems({
        productKeys: productKeys.length ? productKeys.join(',') : undefined,
        statuses: statuses.length ? statuses.join(',') : undefined,
        ticketId: ticketId.trim() || undefined,
        firstProposedFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
        firstProposedTo: dateRange?.[1]?.format('YYYY-MM-DD'),
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setItems(result.items)
      setTotal(result.total)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载举措列表失败')
    } finally {
      setLoading(false)
    }
  }, [productKeys, statuses, ticketId, dateRange, page])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const parseScheduleForPicker = (value) => {
    const normalized = normalizeActionSchedule(value)
    if (!normalized) return null
    const parsed = dayjs(normalized, 'YYYY-MM-DD', true)
    return parsed.isValid() ? parsed : null
  }

  const openEdit = (record) => {
    setEditing(record)
    editForm.setFieldsValue({
      content: record.content,
      status: record.status,
      scheduleAt: parseScheduleForPicker(record.scheduleAt),
    })
    setEditOpen(true)
  }

  const handleScheduleChange = (date) => {
    if (!date) {
      editForm.setFieldsValue({ status: 'pending_evaluation' })
      return
    }
    if (editForm.getFieldValue('status') === 'pending_evaluation') {
      editForm.setFieldsValue({ status: 'in_progress' })
    }
  }

  const handleEditSave = async () => {
    if (!editing) return
    const values = await editForm.validateFields()
    setSaving(true)
    try {
      const scheduleAt = values.scheduleAt
        ? dayjs(values.scheduleAt).format('YYYY-MM-DD')
        : ''
      const status = scheduleAt ? values.status : deriveActionItemStatusFromSchedule('')
      const updated = await updateActionItem(editing.id, {
        content: values.content.trim(),
        status,
        scheduleAt,
      })
      const synced = await syncLinkedTicketCopies(updated, feedbacks, updateFeedback)
      message.success(synced > 0 ? `已保存，并同步 ${synced} 条关联工单` : '已保存')
      setEditOpen(false)
      loadItems()
      loadStats()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: '产品名称',
      dataIndex: 'productName',
      width: 120,
      render: (text, record) => text || record.productKey || '—',
    },
    {
      title: '问题',
      dataIndex: 'painPointSnapshot',
      ellipsis: true,
      width: 160,
    },
    {
      title: '问题类型',
      dataIndex: 'problemTypeSnapshot',
      width: 100,
    },
    {
      title: '用户旅程一级',
      dataIndex: 'journeyL1Snapshot',
      width: 120,
    },
    {
      title: '来源',
      key: 'sources',
      width: 100,
      render: (_, record) => {
        const sources = record.linkedDataSources || []
        if (!sources.length) return '—'
        return (
          <Space size={[4, 4]} wrap>
            {sources.map((s) => (
              <Tag key={s} className="!m-0">
                {DATA_SOURCE_LABELS[s] || s}
              </Tag>
            ))}
          </Space>
        )
      },
    },
    {
      title: '举措',
      dataIndex: 'content',
      ellipsis: true,
      width: 200,
    },
    {
      title: '关联工单',
      key: 'linkedTickets',
      width: 100,
      render: (_, record) => <LinkedTicketsCell ticketIds={record.linkedTicketIds} />,
    },
    {
      title: '首次提出时间',
      dataIndex: 'firstProposedAt',
      width: 120,
      render: (text, record) => (
        <span
          className={
            record.status === 'pending_evaluation' ? scheduleWarningClass(record.warningLevel) : undefined
          }
        >
          {text || '—'}
        </span>
      ),
    },
    {
      title: '排期时间',
      key: 'scheduleAt',
      width: 120,
      render: (_, record) => (
        <Space size={4}>
          <span
            className={
              record.status === 'in_progress' ? scheduleWarningClass(record.warningLevel) : undefined
            }
          >
            {record.scheduleAt?.trim() || '—'}
          </span>
          {record.scheduleChanged ? (
            <Tag color="orange" className="!m-0 !text-[10px]">
              变更
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status) => (
        <Tag color={STATUS_TAG_COLORS[status] || 'default'}>
          {ACTION_ITEM_STATUS_LABELS[status] || status}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right',
      render: (_, record) => (
        <PermissionGate permission="editRecord">
          <Tooltip title="修改状态 / 内容 / 排期">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              className="!px-0"
              onClick={() => openEdit(record)}
            />
          </Tooltip>
        </PermissionGate>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="举措与进展"
        desc="集中查看确立举措及完成进展，支持筛选、预警与行内编辑。"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ACTION_ITEM_STATUSES.map((status) => (
          <Card key={status} size="small" className="!border-ink-100">
            <Statistic
              title={ACTION_ITEM_STATUS_LABELS[status]}
              value={stats[status] ?? 0}
              styles={{ content: { fontSize: 22 } }}
            />
          </Card>
        ))}
      </div>

      <Card size="small" className="!border-ink-100">
        <Space wrap className="w-full">
          <Select
            mode="multiple"
            allowClear
            placeholder="产品"
            style={{ minWidth: 180 }}
            options={productOptions}
            value={productKeys}
            onChange={(v) => {
              setProductKeys(v)
              setPage(1)
            }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="状态"
            style={{ minWidth: 160 }}
            options={STATUS_OPTIONS}
            value={statuses}
            onChange={(v) => {
              setStatuses(v)
              setPage(1)
            }}
          />
          <DatePicker.RangePicker
            placeholder={['首次提出起', '首次提出止']}
            value={dateRange}
            onChange={(v) => {
              setDateRange(v)
              setPage(1)
            }}
          />
          <Input.Search
            allowClear
            placeholder="关联工单号"
            style={{ width: 180 }}
            value={ticketId}
            onChange={(e) => setTicketId(e.target.value)}
            onSearch={() => setPage(1)}
          />
          <Button onClick={() => loadItems()}>刷新</Button>
        </Space>
      </Card>

      <Card size="small" className="!border-ink-100">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={items}
          scroll={{ x: 1300 }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => setPage(p),
          }}
        />
      </Card>

      <Modal
        title="编辑举措"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleEditSave}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" className="mt-2">
          <Form.Item
            name="content"
            label="举措内容"
            rules={[
              { required: true, message: '请输入举措内容' },
              { max: ACTION_ITEM_CONTENT_MAX_LENGTH, message: `不超过 ${ACTION_ITEM_CONTENT_MAX_LENGTH} 字` },
            ]}
          >
            <Input.TextArea rows={4} showCount maxLength={ACTION_ITEM_CONTENT_MAX_LENGTH} />
          </Form.Item>
          <Form.Item name="scheduleAt" label="排期">
            <DatePicker
              className="w-full"
              format="YYYY-MM-DD"
              placeholder="留空 = 待评估"
              allowClear
              onChange={handleScheduleChange}
            />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select options={STATUS_OPTIONS} disabled={!hasEditSchedule} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
