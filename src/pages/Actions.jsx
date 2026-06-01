import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Popover,
  Select,
  Space,
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
  aggregateActionItemsByProductStatus,
  deriveActionItemStatusFromSchedule,
} from '../domain/actionItem.js'
import {
  buildTicketIdSetFromRecords,
  linkedTicketIdsInPeriod,
} from '../domain/actionItemPeriodFilter.js'
import { normalizeActionSchedule } from '../domain/actionSchedule.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  getActionItemStats,
  listActionItems,
  updateActionItem,
} from '../lib/actionItemClient.js'
import { syncLinkedTicketCopies } from '../lib/actionItemTicketSync.js'
import { listProducts } from '../lib/productTaxonomy.js'
import { filterRecordsForScope } from '../snapshots/recordScope.js'
import { useInsights } from '../context/InsightsContext.jsx'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import PermissionGate from '../components/auth/PermissionGate.jsx'
import ActionItemProductStatusChart from '../components/charts/ActionItemProductStatusChart.jsx'
import ActionItemStatusTag from '../components/tags/ActionItemStatusTag.jsx'
import ActionItemConflictModal from '../components/ActionItemConflictModal.jsx'
import {
  formatActionItemUpdatedByLine,
  getActionItemRevision,
  toActionItemConflictError,
} from '../domain/actionItemRevision.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../domain/actionItem.js').ActionItemStatus} ActionItemStatus */

const PAGE_SIZE = 20

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
  const { feedbacks, updateFeedback, currentPeriod } = useInsights()
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
  const [statsByProduct, setStatsByProduct] = useState(
    /** @type {import('../lib/actionItemClient.js').ActionItemProductStatusRow[]} */ ([]),
  )

  const [insightPeriodId, setInsightPeriodId] = useState(
    /** @type {string | null} */ (null),
  )
  const [selectedPeriod, setSelectedPeriod] = useState(
    /** @type {import('../domain/insightPeriod.js').InsightPeriod | null} */ (null),
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
  const [editStale, setEditStale] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [conflictServerItem, setConflictServerItem] = useState(/** @type {ActionItem | null} */ (null))
  const [conflictRevision, setConflictRevision] = useState(0)
  const [conflictDraft, setConflictDraft] = useState(
    /** @type {{ content: string; status: ActionItemStatus; scheduleAt: string } | null} */ (null),
  )
  const [forceSaving, setForceSaving] = useState(false)
  const baseRevisionRef = useRef(0)
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

  useEffect(() => {
    if (insightPeriodId || !currentPeriod) return
    setInsightPeriodId(currentPeriod.id)
    setSelectedPeriod(currentPeriod)
  }, [currentPeriod, insightPeriodId])

  const periodTicketIdSet = useMemo(() => {
    if (!selectedPeriod) return null
    return buildTicketIdSetFromRecords(filterRecordsForScope(feedbacks, selectedPeriod))
  }, [feedbacks, selectedPeriod])

  const listQuery = useMemo(
    () => ({
      productKeys: productKeys.length ? productKeys.join(',') : undefined,
      statuses: statuses.length ? statuses.join(',') : undefined,
      ticketId: ticketId.trim() || undefined,
      firstProposedFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
      firstProposedTo: dateRange?.[1]?.format('YYYY-MM-DD'),
      insightPeriodId: insightPeriodId || undefined,
    }),
    [productKeys, statuses, ticketId, dateRange, insightPeriodId],
  )

  const loadStats = useCallback(async () => {
    try {
      const data = await getActionItemStats(listQuery)
      const counts = {
        pending_evaluation: 0,
        in_progress: 0,
        completed: 0,
        suspended: 0,
        ...(data.counts || {}),
      }
      setStats(counts)

      let byProduct = Array.isArray(data.byProduct) ? data.byProduct : []
      const total = ACTION_ITEM_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0)
      if (!byProduct.length && total > 0) {
        const result = await listActionItems({ ...listQuery, limit: 500, offset: 0 })
        byProduct = aggregateActionItemsByProductStatus(result.items)
      }
      setStatsByProduct(byProduct)
    } catch (err) {
      console.warn('[Actions] 加载统计失败:', err)
      message.warning(err instanceof Error ? err.message : '加载统计失败')
    }
  }, [listQuery])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listActionItems({
        ...listQuery,
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
  }, [listQuery, page])

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
    baseRevisionRef.current = getActionItemRevision(record)
    setEditStale(false)
    setConflictOpen(false)
    editForm.setFieldsValue({
      content: record.content,
      status: record.status,
      scheduleAt: parseScheduleForPicker(record.scheduleAt),
    })
    setEditOpen(true)
  }

  useEffect(() => {
    if (!editOpen || !editing?.id) return
    const latest = items.find((item) => item.id === editing.id)
    if (!latest) return
    if (getActionItemRevision(latest) > baseRevisionRef.current) {
      setEditStale(true)
    }
  }, [editOpen, editing?.id, items])

  const handleScheduleChange = (date) => {
    if (!date) {
      editForm.setFieldsValue({ status: 'pending_evaluation' })
      return
    }
    if (editForm.getFieldValue('status') === 'pending_evaluation') {
      editForm.setFieldsValue({ status: 'in_progress' })
    }
  }

  const buildEditPatch = (values) => {
    const scheduleAt = values.scheduleAt
      ? dayjs(values.scheduleAt).format('YYYY-MM-DD')
      : ''
    const status = scheduleAt ? values.status : deriveActionItemStatusFromSchedule('')
    return {
      content: values.content.trim(),
      status,
      scheduleAt,
    }
  }

  const applyEditFormFromItem = (item) => {
    editForm.setFieldsValue({
      content: item.content,
      status: item.status,
      scheduleAt: parseScheduleForPicker(item.scheduleAt),
    })
    baseRevisionRef.current = getActionItemRevision(item)
    setEditStale(false)
    setEditing(item)
  }

  const finalizeEditSave = async (patch, saveOptions = {}) => {
    if (!editing) return
    const updated = await updateActionItem(editing.id, patch, {
      expectedRevision: saveOptions.expectedRevision ?? baseRevisionRef.current,
      skipConflictCheck: saveOptions.skipConflictCheck,
    })
    const synced = await syncLinkedTicketCopies(updated, feedbacks, updateFeedback)
    message.success(synced > 0 ? `已保存，并同步 ${synced} 条关联工单` : '已保存')
    setEditOpen(false)
    setConflictOpen(false)
    loadItems()
    loadStats()
  }

  const handleEditSave = async (saveOptions = {}) => {
    if (!editing) return
    const values = await editForm.validateFields()
    setSaving(true)
    try {
      await finalizeEditSave(buildEditPatch(values), saveOptions)
    } catch (err) {
      const conflict = toActionItemConflictError(err)
      if (conflict) {
        setConflictDraft(buildEditPatch(values))
        setConflictServerItem(conflict.current)
        setConflictRevision(conflict.currentRevision)
        setConflictOpen(true)
        return
      }
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleReloadLatestAfterConflict = () => {
    const latest =
      conflictServerItem || items.find((item) => item.id === editing?.id) || null
    if (!latest) {
      setConflictOpen(false)
      return
    }
    applyEditFormFromItem(latest)
    setConflictOpen(false)
    message.info('已加载服务器最新内容')
  }

  const handleForceSaveAfterConflict = async () => {
    if (!editing) return
    setForceSaving(true)
    try {
      const values = await editForm.validateFields()
      await finalizeEditSave(buildEditPatch(values), { expectedRevision: conflictRevision })
    } catch (err) {
      const again = toActionItemConflictError(err)
      if (again) {
        setConflictServerItem(again.current)
        setConflictRevision(again.currentRevision)
        message.warning('服务器版本再次变化，请重新加载后再试')
        return
      }
      message.error(err instanceof Error ? err.message : '覆盖保存失败')
    } finally {
      setForceSaving(false)
    }
  }

  const handleReloadStaleEdit = () => {
    const latest = items.find((item) => item.id === editing?.id)
    if (!latest) return
    applyEditFormFromItem(latest)
    message.info('已同步列表中的最新内容')
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
      title: (
        <Tooltip title="数量仅统计当前所选周期内的关联工单">
          <span>
            关联工单
            <Typography.Text type="secondary" className="ml-1 text-[10px] font-normal">
              (本周期)
            </Typography.Text>
          </span>
        </Tooltip>
      ),
      key: 'linkedTickets',
      width: 110,
      render: (_, record) => (
        <LinkedTicketsCell
          ticketIds={linkedTicketIdsInPeriod(record.linkedTicketIds, periodTicketIdSet)}
        />
      ),
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
      render: (status) => <ActionItemStatusTag status={status} />,
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
        desc="集中查看确立的举措及完成进展，支持更新状态、修改排期，及临期预警。"
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-800">工单所属周期</span>
          <InsightPeriodPicker
            compact
            showHint={false}
            value={insightPeriodId}
            onChange={(id, period) => {
              setInsightPeriodId(id)
              setSelectedPeriod(period)
              setPage(1)
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-800">首次提出时间</span>
          <DatePicker.RangePicker
            size="small"
            placeholder={['起', '止']}
            value={dateRange}
            onChange={(v) => {
              setDateRange(v)
              setPage(1)
            }}
          />
        </div>
      </div>

      <Card size="small" className="!border-ink-100" styles={{ body: { overflow: 'visible' } }}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {ACTION_ITEM_STATUSES.map((status) => (
              <div
                key={status}
                className="inline-flex min-w-[5.5rem] items-baseline gap-1.5 rounded-md border border-ink-100 bg-ink-50/60 px-2.5 py-1"
              >
                <span className="text-xs text-ink-500">{ACTION_ITEM_STATUS_LABELS[status]}</span>
                <span className="text-base font-semibold tabular-nums text-ink-900">
                  {stats[status] ?? 0}
                </span>
              </div>
            ))}
          </div>

          <div>
            <Typography.Text type="secondary" className="mb-2 block text-xs">
              分产品 · 分状态
            </Typography.Text>
            <ActionItemProductStatusChart data={statsByProduct} />
          </div>
        </div>
      </Card>

      <Card size="small" className="!border-ink-100">
        <Space wrap className="mb-3 w-full">
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
          <Input.Search
            allowClear
            placeholder="关联工单号"
            style={{ width: 180 }}
            value={ticketId}
            onChange={(e) => setTicketId(e.target.value)}
            onSearch={() => setPage(1)}
          />
          <Button
            onClick={() => {
              loadItems()
              loadStats()
            }}
          >
            刷新
          </Button>
        </Space>
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
        onOk={() => handleEditSave()}
        confirmLoading={saving}
        destroyOnClose
      >
        {editStale ? (
          <Alert
            type="warning"
            showIcon
            className="!mb-3"
            message="此举措已被他人更新"
            description={
              <>
                {formatActionItemUpdatedByLine(
                  items.find((item) => item.id === editing?.id) || editing,
                ) || '列表数据已同步为较新版本。'}
                {' '}
                继续编辑可能覆盖他人修改；保存时将再次校验。
              </>
            }
            action={
              <Button size="small" onClick={handleReloadStaleEdit}>
                加载最新
              </Button>
            }
          />
        ) : null}
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

      <ActionItemConflictModal
        open={conflictOpen}
        actionLabel={editing?.productName || editing?.content?.slice(0, 20)}
        serverItem={conflictServerItem}
        draft={
          conflictDraft || {
            content: editing?.content || '',
            status: editing?.status || 'pending_evaluation',
            scheduleAt: editing?.scheduleAt || '',
          }
        }
        onReloadLatest={handleReloadLatestAfterConflict}
        onForceSave={handleForceSaveAfterConflict}
        onCancel={() => setConflictOpen(false)}
        forceSaving={forceSaving}
      />
    </div>
  )
}
