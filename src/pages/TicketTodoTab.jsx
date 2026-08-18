import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Card,
  Popconfirm,
  Space,
  Table,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, EyeOutlined, FormOutlined, ReloadOutlined } from '@ant-design/icons'
import { PageHeader } from './Dashboard.shared.jsx'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import ActionItemProductStatusChart from '../components/charts/ActionItemProductStatusChart.jsx'
import TicketTodoCompositeFilter from '../components/actions/TicketTodoCompositeFilter.jsx'
import LinkedTicketsCell from '../components/actions/LinkedTicketsCell.jsx'
import CopyableEllipsisCell from '../components/actions/CopyableEllipsisCell.jsx'
import TicketTodoDrawer from '../components/actions/TicketTodoDrawer.jsx'
import TicketTodoStatusTag from '../components/tags/TicketTodoStatusTag.jsx'
import FeedbackDrawer from '../components/FeedbackDrawer.jsx'
import { useFeedbackDrawerSelection } from '../hooks/useFeedbackDrawerSelection.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  TICKET_TODO_PROCESS_MODE,
  TICKET_TODO_RESOLUTIONS,
  TICKET_TODO_RESOLUTION_LABELS,
  applyTicketTodoResolutionToItem,
  buildTicketTodoSavePatch,
  createEmptyTicketTodoResolutionCounts,
  formatSharePercent,
  formatTicketTodoAssigneeLabel,
  formatTicketTodoDateTime,
  getTicketTodoDraftItems,
  isTicketTodoOpen,
  resolveTicketTodoProcessResolution,
  shouldPersistEstablishedActionOnProcess,
} from '../domain/ticketTodo.js'
import { TICKET_TODO_RESOLUTION_CHART_COLORS } from '../components/tags/TicketTodoStatusTag.jsx'
import { persistEstablishedActionForTicket, syncFirstTicketSnapshotsForRecord, syncLinkedTicketsForActionIds } from '../lib/establishedActionPersist.js'
import { getTicketTodoStats, listTicketTodos } from '../lib/ticketTodoClient.js'
import {
  buildTicketTodoAssigneeFilterOptions,
  buildTicketTodoProductFilterOptions,
  clearAllTicketTodoFilters,
  createEmptyTicketTodoFilters,
  ticketTodoFiltersToListQuery,
} from '../lib/ticketTodoFilterModel.js'
import { buildFeedbackIndexByTicketId } from '../lib/actionItemLinkedFeedback.js'
import { apiFetch } from '../lib/apiClient.js'

/** @typedef {import('../domain/ticketTodo.js').TicketTodoRow} TicketTodoRow */

const PAGE_SIZE = 20

const FILTER_STATUS_OPTIONS = TICKET_TODO_RESOLUTIONS.map((value) => ({
  label: TICKET_TODO_RESOLUTION_LABELS[value],
  value,
}))

export default function TicketTodoTab() {
  const { user, can } = useAuth()
  const canEdit = can('editRecord')
  const { feedbacks, updateFeedback } = useInsights()
  const [items, setItems] = useState(/** @type {TicketTodoRow[]} */ ([]))
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(createEmptyTicketTodoResolutionCounts)
  const [conversionRate, setConversionRate] = useState(0)
  const [statsByProduct, setStatsByProduct] = useState([])
  const [insightPeriodId, setInsightPeriodId] = useState(/** @type {string | null} */ (null))
  const [filters, setFilters] = useState(createEmptyTicketTodoFilters)
  const [filterFacets, setFilterFacets] = useState({
    products: /** @type {{ productKey: string; productName: string }[]} */ ([]),
    assignees: /** @type {{ userId: string; username: string }[]} */ ([]),
    hasUnassigned: false,
  })
  const [listRefreshing, setListRefreshing] = useState(false)
  const [editing, setEditing] = useState(/** @type {TicketTodoRow | null} */ (null))
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(/** @type {string | null} */ (null))
  const [assigneeOptions, setAssigneeOptions] = useState(/** @type {{ value: string; label: string }[]} */ ([]))
  const stickyChromeRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [stickyChromeHeight, setStickyChromeHeight] = useState(0)

  useEffect(() => {
    const chrome = stickyChromeRef.current
    if (!chrome) return undefined
    const syncOffset = () => setStickyChromeHeight(chrome.offsetHeight)
    syncOffset()
    const observer = new ResizeObserver(syncOffset)
    observer.observe(chrome)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/users/assignees')
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data?.users) ? data.users : []
        setAssigneeOptions(
          list.map((item) => ({
            value: item.id,
            label: item.username || item.id,
          })).filter((item) => item.value),
        )
      })
      .catch(() => {
        if (!cancelled) setAssigneeOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const periodFilterActive = Boolean(insightPeriodId)
  const feedbackByTicketId = useMemo(() => buildFeedbackIndexByTicketId(feedbacks), [feedbacks])
  const {
    selected: selectedFeedback,
    setSelectedDirect,
    requestCloseDrawer,
    closeDrawer,
    onDrawerDirtyChange,
  } = useFeedbackDrawerSelection()

  const openFeedbackByTicketId = useCallback(
    (ticketId) => {
      const fromCache = feedbackByTicketId.get(ticketId)
      const fromRow = editing?.ticketId === ticketId ? editing.record : null
      const fromList = items.find((item) => item.ticketId === ticketId)?.record
      const record = fromCache || fromRow || fromList
      if (!record) {
        message.warning('未在库中找到该工单，请稍后刷新或确认工单号')
        return
      }
      setSelectedDirect(record)
    },
    [editing, feedbackByTicketId, items, setSelectedDirect],
  )

  const handleFiltersChange = useCallback((next) => {
    setFilters(next)
    setPage(1)
  }, [])

  const handleClearFilters = useCallback(() => {
    setFilters(clearAllTicketTodoFilters())
    setPage(1)
  }, [])

  const tableFilters = useMemo(() => ticketTodoFiltersToListQuery(filters), [filters])
  const baseScopeQuery = useMemo(
    () => ({ insightPeriodId: insightPeriodId || undefined }),
    [insightPeriodId],
  )
  const listQuery = useMemo(
    () => ({
      ...tableFilters,
      ...baseScopeQuery,
    }),
    [tableFilters, baseScopeQuery],
  )

  const loadStats = useCallback(async () => {
    try {
      const data = await getTicketTodoStats(baseScopeQuery)
      setStats({ ...createEmptyTicketTodoResolutionCounts(), ...(data.counts || {}) })
      setConversionRate(Number(data.conversionRate) || 0)
      setStatsByProduct(Array.isArray(data.byProduct) ? data.byProduct : [])
      setFilterFacets({
        products: Array.isArray(data.facets?.products) ? data.facets.products : [],
        assignees: Array.isArray(data.facets?.assignees) ? data.facets.assignees : [],
        hasUnassigned: Boolean(data.facets?.hasUnassigned),
      })
    } catch (err) {
      message.warning(err instanceof Error ? err.message : '加载统计失败')
    }
  }, [baseScopeQuery])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listTicketTodos({
        ...listQuery,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setItems(result.items || [])
      setTotal(result.total || 0)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载会议待办失败')
    } finally {
      setLoading(false)
    }
  }, [listQuery, page])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const productOptions = useMemo(
    () =>
      buildTicketTodoProductFilterOptions(
        filterFacets.products.map((item) => ({
          productKey: item.productKey,
          productName: item.productName,
        })),
      ),
    [filterFacets.products],
  )
  const assigneeFilterOptions = useMemo(
    () =>
      buildTicketTodoAssigneeFilterOptions([
        ...(filterFacets.hasUnassigned
          ? [{ assigneeUserId: '', assigneeUsername: '' }]
          : []),
        ...filterFacets.assignees.map((item) => ({
          assigneeUserId: item.userId,
          assigneeUsername: item.username,
        })),
      ]),
    [filterFacets],
  )
  const productNameByKey = useMemo(() => {
    const map = new Map()
    for (const option of productOptions) map.set(option.value, option.label)
    return map
  }, [productOptions])
  const assigneeNameById = useMemo(() => {
    const map = new Map()
    for (const option of assigneeFilterOptions) map.set(option.value, option.label)
    return map
  }, [assigneeFilterOptions])

  const openRow = (record) => {
    setEditing(record)
    setEditOpen(true)
  }

  const closeEdit = () => {
    setEditOpen(false)
    setEditing(null)
  }

  const resolveRecord = useCallback(
    (row) => {
      return (
        feedbacks.find((item) => item.id === row.recordId) ||
        row.record ||
        null
      )
    },
    [feedbacks],
  )

  const handleSave = async (payload) => {
    if (!editing || !user?.id) return
    const record = resolveRecord(editing)
    if (!record) {
      message.error('未找到关联工单，无法保存')
      return
    }
    const resolution = resolveTicketTodoProcessResolution({
      processMode: payload.processMode,
      establishedActionContent: payload.establishedAction,
      actionId: payload.actionId,
      linkedFromLibrary: payload.linkedFromLibrary,
      markProcessed: payload.markProcessed,
    })
    if (payload.processMode === TICKET_TODO_PROCESS_MODE.ESTABLISH_ACTION && resolution === 'open') {
      message.warning('请选择或填写举措')
      return
    }
    setSaving(true)
    try {
      let actionPatch = {}
      if (shouldPersistEstablishedActionOnProcess(resolution)) {
        actionPatch = await persistEstablishedActionForTicket(record, {
          content: payload.establishedAction,
          detail: payload.establishedActionDetail,
          scheduleAt: payload.actionSchedule,
          actionId: payload.actionId,
          linkedFromLibrary: payload.linkedFromLibrary,
        })
      }
      const draftItems = getTicketTodoDraftItems(record).map((item) => {
        if (item.id !== editing.ticketTodoItemId) return item
        return applyTicketTodoResolutionToItem(
          {
            ...item,
            text: payload.text,
            assigneeUserId: payload.assigneeUserId,
            assigneeUsername: payload.assigneeUsername,
          },
          resolution,
          {
            processNote:
              payload.processMode === 'no_action' ? payload.processNote : item.processNote,
            linkedActionId:
              resolution === 'converted_to_action'
                ? actionPatch.actionId || payload.actionId || item.linkedActionId || ''
                : item.linkedActionId || '',
          },
        )
      })
      const todoPatch = buildTicketTodoSavePatch(record, draftItems, {
        userId: user.id,
        username: user.username || user.id,
      })
      const mergedPatch = { ...actionPatch, ...todoPatch }
      if (Object.keys(mergedPatch).length) {
        const merged = await updateFeedback(record.id, mergedPatch, { mergeBase: record })
        if (merged?.actionId?.trim()) {
          await syncFirstTicketSnapshotsForRecord(merged)
          if (!payload.linkedFromLibrary) {
            await syncLinkedTicketsForActionIds([merged.actionId], feedbacks, updateFeedback)
          }
        }
      }
      message.success(
        resolution === 'open' ? '已保存待办' : `已更新为「${TICKET_TODO_RESOLUTION_LABELS[resolution]}」`,
      )
      closeEdit()
      await Promise.all([loadItems(), loadStats()])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row) => {
    if (!user?.id) return
    const record = resolveRecord(row)
    if (!record) {
      message.error('未找到关联工单，无法删除')
      return
    }
    setDeletingId(row.id)
    try {
      const draftItems = getTicketTodoDraftItems(record).filter(
        (item) => item.id !== row.ticketTodoItemId,
      )
      const patch = buildTicketTodoSavePatch(record, draftItems, {
        userId: user.id,
        username: user.username || user.id,
      })
      if (Object.keys(patch).length) {
        await updateFeedback(record.id, patch, { mergeBase: record })
      }
      message.success('已删除待办')
      if (editing?.id === row.id) closeEdit()
      await Promise.all([loadItems(), loadStats()])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const handleRefreshList = async () => {
    setListRefreshing(true)
    try {
      await Promise.all([loadItems(), loadStats()])
      message.success('已刷新')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setListRefreshing(false)
    }
  }

  const columns = [
    {
      title: '产品名称',
      dataIndex: 'productName',
      width: 120,
      fixed: 'left',
      render: (value) => value || '—',
    },
    {
      title: '问题',
      dataIndex: 'painPoint',
      width: 220,
      render: (value) => <CopyableEllipsisCell text={value} />,
    },
    {
      title: '来源',
      dataIndex: 'dataSourceType',
      width: 96,
      render: (value) => DATA_SOURCE_LABELS[value] || value || '—',
    },
    {
      title: '待办',
      dataIndex: 'text',
      width: 240,
      render: (value) => <CopyableEllipsisCell text={value} />,
    },
    {
      title: '关联工单',
      dataIndex: 'ticketId',
      width: 140,
      render: (_, record) => (
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <LinkedTicketsCell
            title="关联工单"
            ticketIds={record.ticketId ? [record.ticketId] : []}
            feedbackByTicketId={feedbackByTicketId}
            onOpenTicket={openFeedbackByTicketId}
          />
        </div>
      ),
    },
    {
      title: '负责人',
      dataIndex: 'assigneeUsername',
      width: 100,
      render: (_, record) => formatTicketTodoAssigneeLabel(record),
    },
    {
      title: '提出时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (value) => formatTicketTodoDateTime(value) || '—',
    },
    {
      title: '最近更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value, record) =>
        value
          ? `${record.updatedBy?.username || record.updatedBy?.userId || ''} ${formatTicketTodoDateTime(value)}`.trim()
          : '—',
    },
    {
      title: '状态',
      dataIndex: 'resolution',
      width: 120,
      render: (value) => <TicketTodoStatusTag resolution={value} />,
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_, record) => {
        const openItem = isTicketTodoOpen(record)
        return (
          <Space size={0} onClick={(event) => event.stopPropagation()}>
            {canEdit && openItem ? (
              <Button type="link" size="small" icon={<FormOutlined />} onClick={() => openRow(record)}>
                处理
              </Button>
            ) : (
              <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openRow(record)}>
                查看
              </Button>
            )}
            {canEdit ? (
              <Popconfirm
                title="删除这条会议待办？"
                okText="删除"
                okButtonProps={{ danger: true }}
                onConfirm={() => void handleDelete(record)}
              >
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deletingId === record.id}
                >
                  删除
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader desc="集中处理投诉/咨询工单上的会议待办，可确立举措或标记已处理。点击行可打开详情。" />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-800">周期筛选</span>
          <InsightPeriodPicker
            compact
            showHint={periodFilterActive}
            allowEmpty
            value={insightPeriodId}
            onChange={(id) => {
              setInsightPeriodId(id)
              setPage(1)
            }}
          />
          {!periodFilterActive ? (
            <Typography.Text type="secondary" className="text-xs">
              当前显示全部会议待办（不限周期）
            </Typography.Text>
          ) : null}
        </div>
      </div>

      <Card size="small" className="!border-ink-100" styles={{ body: { overflow: 'visible' } }}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {TICKET_TODO_RESOLUTIONS.map((status) => (
              <div
                key={status}
                className="inline-flex min-w-[5.5rem] items-baseline gap-1.5 rounded-md border border-ink-100 bg-ink-50/60 px-2.5 py-1"
              >
                <span className="text-xs text-ink-500">{TICKET_TODO_RESOLUTION_LABELS[status]}</span>
                <span className="text-base font-semibold tabular-nums text-ink-900">
                  {stats[status] ?? 0}
                </span>
              </div>
            ))}
            <div className="inline-flex min-w-[5.5rem] items-baseline gap-1.5 rounded-md border border-ink-100 bg-ink-50/60 px-2.5 py-1">
              <span className="text-xs text-ink-500">转化率</span>
              <span className="text-base font-semibold tabular-nums text-ink-900">
                {formatSharePercent(conversionRate)}
              </span>
            </div>
          </div>
          <div>
            <Typography.Text type="secondary" className="mb-2 block text-xs">
              分产品 · 分状态 · 转化率
            </Typography.Text>
            <ActionItemProductStatusChart
              data={statsByProduct}
              statuses={TICKET_TODO_RESOLUTIONS}
              statusLabels={TICKET_TODO_RESOLUTION_LABELS}
              statusColors={TICKET_TODO_RESOLUTION_CHART_COLORS}
              rateLabel="转化率"
              countNoun="条待办"
              showLinkedFeedback={false}
            />
          </div>
        </div>
      </Card>

      <div
        ref={stickyChromeRef}
        className="page-section-sm page-sticky-chrome flex w-full flex-wrap items-start gap-2"
      >
        <TicketTodoCompositeFilter
          className="min-w-0 flex-1"
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onClearFilters={handleClearFilters}
          options={{
            productOptions,
            statusOptions: FILTER_STATUS_OPTIONS,
            assigneeOptions: assigneeFilterOptions,
            productNameByKey,
            assigneeNameById,
          }}
        />
        <Button
          icon={<ReloadOutlined />}
          loading={listRefreshing}
          onClick={() => void handleRefreshList()}
        >
          刷新
        </Button>
      </div>

      <Card size="small" className="page-section-sm !border-ink-100">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={items}
          sticky={{ offsetHeader: stickyChromeHeight }}
          scroll={{ x: 1560 }}
          onRow={(record) => ({
            onClick: () => openRow(record),
            className: 'cursor-pointer',
          })}
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

      <TicketTodoDrawer
        row={editing}
        record={editing ? resolveRecord(editing) : null}
        open={editOpen}
        onClose={closeEdit}
        canProcess={canEdit && Boolean(editing && isTicketTodoOpen(editing))}
        saving={saving}
        onSave={handleSave}
        feedbackByTicketId={feedbackByTicketId}
        onOpenTicket={openFeedbackByTicketId}
        assigneeOptions={assigneeOptions}
      />

      <FeedbackDrawer
        feedback={selectedFeedback}
        onClose={requestCloseDrawer}
        onSavedClose={closeDrawer}
        onDirtyChange={onDrawerDirtyChange}
      />
    </div>
  )
}
