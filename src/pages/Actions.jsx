import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Dropdown,
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
import { CopyOutlined, DownloadOutlined, EditOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
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
  createActionItem,
  createActionItemsBatch,
  updateActionItem,
} from '../lib/actionItemClient.js'
import { exportActionItemsWithQuery } from '../lib/actionItemExport.js'
import {
  buildProductNameToKeyMap,
  parseActionItemImportWorkbook,
} from '../lib/actionItemImport.js'
import { downloadActionItemImportTemplate } from '../lib/actionItemImportTemplate.js'
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
  formatActionItemUpdatedAtDisplay,
  formatActionItemUpdatedByDisplay,
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
  const { feedbacks, updateFeedback } = useInsights()
  const [items, setItems] = useState(/** @type {ActionItem[]} */ ([]))
  const [total, setTotal] = useState(0)
  const [allTotal, setAllTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
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
  const importInputRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const watchedSchedule = Form.useWatch('scheduleAt', editForm)

  const [addOpen, setAddOpen] = useState(false)
  const [addForm] = Form.useForm()
  const [adding, setAdding] = useState(false)
  const watchedAddSchedule = Form.useWatch('scheduleAt', addForm)

  const [importOpen, setImportOpen] = useState(false)
  const [importPreview, setImportPreview] = useState(
    /** @type {{ rows: Partial<ActionItem>[]; errors: { row: number; error: string }[] } | null} */ (null),
  )
  const [importing, setImporting] = useState(false)

  const hasEditSchedule = useMemo(() => {
    if (!watchedSchedule) return false
    if (dayjs.isDayjs(watchedSchedule)) return watchedSchedule.isValid()
    return Boolean(String(watchedSchedule).trim())
  }, [watchedSchedule])

  const hasAddSchedule = useMemo(() => {
    if (!watchedAddSchedule) return false
    if (dayjs.isDayjs(watchedAddSchedule)) return watchedAddSchedule.isValid()
    return Boolean(String(watchedAddSchedule).trim())
  }, [watchedAddSchedule])

  const productOptions = useMemo(() => {
    return listProducts(feedbacks).map((p) => ({
      label: p.name,
      value: p.key,
    }))
  }, [feedbacks])

  const periodFilterActive = Boolean(insightPeriodId)

  const periodTicketIdSet = useMemo(() => {
    if (!periodFilterActive || !selectedPeriod) return null
    return buildTicketIdSetFromRecords(filterRecordsForScope(feedbacks, selectedPeriod))
  }, [feedbacks, selectedPeriod, periodFilterActive])

  const resolveLinkedTicketIds = useCallback(
    (/** @type {ActionItem} */ record) => {
      if (!periodFilterActive) return record.linkedTicketIds || []
      return linkedTicketIdsInPeriod(record.linkedTicketIds, periodTicketIdSet)
    },
    [periodFilterActive, periodTicketIdSet],
  )

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

  /** 页头周期/首次提出时间范围，不含表格区筛选 */
  const baseScopeQuery = useMemo(
    () => ({
      firstProposedFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
      firstProposedTo: dateRange?.[1]?.format('YYYY-MM-DD'),
      insightPeriodId: insightPeriodId || undefined,
    }),
    [dateRange, insightPeriodId],
  )

  const loadStats = useCallback(async () => {
    try {
      const data = await getActionItemStats(baseScopeQuery)
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
        const result = await listActionItems({ ...baseScopeQuery, limit: 500, offset: 0 })
        byProduct = aggregateActionItemsByProductStatus(result.items)
      }
      setStatsByProduct(byProduct)
    } catch (err) {
      console.warn('[Actions] 加载统计失败:', err)
      message.warning(err instanceof Error ? err.message : '加载统计失败')
    }
  }, [baseScopeQuery])

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

  useEffect(() => {
    let cancelled = false
    listActionItems({ ...baseScopeQuery, limit: 1, offset: 0 })
      .then((result) => {
        if (!cancelled) setAllTotal(result.total)
      })
      .catch(() => {
        if (!cancelled) setAllTotal(0)
      })
    return () => {
      cancelled = true
    }
  }, [baseScopeQuery])

  const handleExport = async (scope) => {
    const filtered = scope === 'filtered'
    const query = filtered ? listQuery : baseScopeQuery
    const count = filtered ? total : allTotal
    if (!count) {
      message.warning('当前范围无可导出举措')
      return
    }

    setExporting(true)
    try {
      const statsData = await getActionItemStats(query)
      const exported = await exportActionItemsWithQuery({
        query,
        statsByProduct: statsData.byProduct?.length ? statsData.byProduct : undefined,
        periodTicketIdSet: periodTicketIdSet,
        scopeLabel: filtered ? '当前筛选' : '全部',
        periodLabel: selectedPeriod?.label,
      })
      message.success(`已导出 ${exported} 条举措（分产品统计 + 举措清单）`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

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

  const openAdd = () => {
    addForm.resetFields()
    addForm.setFieldsValue({ status: 'pending_evaluation' })
    setAddOpen(true)
  }

  const handleAddSave = async () => {
    const values = await addForm.validateFields()
    const productKey = values.productKey?.trim() || ''
    const productName =
      productOptions.find((option) => option.value === productKey)?.label?.trim() || ''
    const scheduleAt = values.scheduleAt ? dayjs(values.scheduleAt).format('YYYY-MM-DD') : ''
    const status = scheduleAt ? values.status : deriveActionItemStatusFromSchedule('')

    setAdding(true)
    try {
      await createActionItem({
        content: values.content.trim(),
        productKey,
        productName,
        painPointSnapshot: values.painPointSnapshot?.trim() || '',
        problemTypeSnapshot: values.problemTypeSnapshot?.trim() || '',
        journeyL1Snapshot: values.journeyL1Snapshot?.trim() || '',
        scheduleAt,
        status,
        linkedTicketIds: [],
        linkedDataSources: [],
        firstProposedAt: new Date().toISOString().slice(0, 10),
      })
      message.success('已添加举措')
      setAddOpen(false)
      setPage(1)
      loadItems()
      loadStats()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '添加失败')
    } finally {
      setAdding(false)
    }
  }

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const productNameToKey = buildProductNameToKeyMap(
        listProducts(feedbacks).map((p) => ({ name: p.name, key: p.key })),
      )
      const preview = parseActionItemImportWorkbook(buffer, {
        productNameToKey,
        firstProposedAt: new Date().toISOString().slice(0, 10),
      })
      if (!preview.rows.length && preview.errors.length) {
        message.error(preview.errors[0]?.error || '导入文件无效')
        return
      }
      if (!preview.rows.length) {
        message.warning('未解析到有效举措行')
        return
      }
      setImportPreview(preview)
      setImportOpen(true)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取文件失败')
    }
  }

  const handleImportConfirm = async () => {
    if (!importPreview?.rows.length) return
    setImporting(true)
    try {
      const result = await createActionItemsBatch(importPreview.rows)
      const failed = result.errors?.length ?? 0
      message.success(
        failed
          ? `已导入 ${result.items.length} 条，${failed} 条失败`
          : `已导入 ${result.items.length} 条举措`,
      )
      setImportOpen(false)
      setImportPreview(null)
      setPage(1)
      loadItems()
      loadStats()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const columns = [
    {
      title: '产品名称',
      dataIndex: 'productName',
      width: 120,
      fixed: 'left',
      render: (text, record) => text || record.productKey || '—',
    },
    {
      title: '问题',
      dataIndex: 'painPointSnapshot',
      ellipsis: true,
      width: 160,
      fixed: 'left',
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
      title: periodFilterActive ? (
        <Tooltip title="数量仅统计当前所选周期内的关联工单">
          <span>
            关联工单
            <Typography.Text type="secondary" className="ml-1 text-[10px] font-normal">
              (本周期)
            </Typography.Text>
          </span>
        </Tooltip>
      ) : (
        '关联工单'
      ),
      key: 'linkedTickets',
      width: 110,
      render: (_, record) => (
        <LinkedTicketsCell ticketIds={resolveLinkedTicketIds(record)} />
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
      title: '最近更新时间',
      key: 'updatedAt',
      width: 168,
      render: (_, record) => formatActionItemUpdatedAtDisplay(record),
    },
    {
      title: '最近更新人员',
      key: 'updatedBy',
      width: 100,
      ellipsis: true,
      render: (_, record) => formatActionItemUpdatedByDisplay(record),
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
        action={
          <Space wrap>
            <PermissionGate permission="editRecord">
              <Button icon={<PlusOutlined />} onClick={openAdd}>
                添加
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => importInputRef.current?.click()}>
                导入
              </Button>
              <Button type="link" className="!px-1" onClick={downloadActionItemImportTemplate}>
                下载模板
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImportFile}
              />
            </PermissionGate>
            <Dropdown
            menu={{
              items: [
                {
                  key: 'all',
                  label: `全部（${allTotal} 条）`,
                  disabled: allTotal === 0,
                },
                {
                  key: 'filtered',
                  label: `当前筛选范围（${total} 条）`,
                  disabled: total === 0,
                },
              ],
              onClick: ({ key }) => handleExport(/** @type {'all' | 'filtered'} */ (key)),
            }}
          >
            <Button loading={exporting} icon={<UploadOutlined />}>
              导出
            </Button>
          </Dropdown>
          </Space>
        }
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-800">周期筛选</span>
          <InsightPeriodPicker
            compact
            showHint={periodFilterActive}
            allowEmpty
            value={insightPeriodId}
            onChange={(id, period) => {
              setInsightPeriodId(id)
              setSelectedPeriod(period)
              setPage(1)
            }}
          />
          {!periodFilterActive ? (
            <Typography.Text type="secondary" className="text-xs">
              当前显示全部举措（不限周期）
            </Typography.Text>
          ) : null}
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
          scroll={{ x: 1500 }}
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
        title="添加举措"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={handleAddSave}
        confirmLoading={adding}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" className="!mb-3 !text-xs">
          问题、问题类型、用户旅程、来源、关联工单均可留空；首次提出时间记为今天。后续在工单详情中首次关联该举措时，空字段将从该工单的「需求痛点」「问题类型」「用户旅程」及来源自动补齐。
        </Typography.Paragraph>
        <Form form={addForm} layout="vertical">
          <Form.Item name="productKey" label="产品">
            <Select allowClear placeholder="可选" options={productOptions} />
          </Form.Item>
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
          <Form.Item name="painPointSnapshot" label="问题（可选）">
            <Input placeholder="需求痛点摘要" />
          </Form.Item>
          <Form.Item name="problemTypeSnapshot" label="问题类型（可选）">
            <Input />
          </Form.Item>
          <Form.Item name="journeyL1Snapshot" label="用户旅程一级（可选）">
            <Input />
          </Form.Item>
          <Form.Item name="scheduleAt" label="排期">
            <DatePicker
              className="w-full"
              format="YYYY-MM-DD"
              placeholder="留空 = 待评估"
              allowClear
              onChange={(date) => {
                if (!date) {
                  addForm.setFieldsValue({ status: 'pending_evaluation' })
                  return
                }
                if (addForm.getFieldValue('status') === 'pending_evaluation') {
                  addForm.setFieldsValue({ status: 'in_progress' })
                }
              }}
            />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="pending_evaluation" rules={[{ required: true }]}>
            <Select options={STATUS_OPTIONS} disabled={!hasAddSchedule} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="导入举措"
        open={importOpen}
        onCancel={() => {
          setImportOpen(false)
          setImportPreview(null)
        }}
        onOk={handleImportConfirm}
        confirmLoading={importing}
        okText="确认导入"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" className="!mb-3 !text-xs">
          支持「举措清单」工作表或
          <Button type="link" className="!h-auto !p-0 !text-xs" onClick={downloadActionItemImportTemplate}>
            下载模板
          </Button>
          ；仅「举措*（必填）」必填。问题等可选列留空时，首次关联工单后自动补齐。首次提出时间统一记为导入当天。
        </Typography.Paragraph>
        {importPreview ? (
          <>
            <Alert
              type={importPreview.errors.length ? 'warning' : 'info'}
              showIcon
              className="!mb-3"
              message={`解析到 ${importPreview.rows.length} 条可导入举措${
                importPreview.errors.length ? `，${importPreview.errors.length} 行有误将跳过` : ''
              }`}
            />
            {importPreview.errors.length > 0 ? (
              <ul className="mb-0 max-h-32 overflow-y-auto pl-5 text-xs text-ink-600">
                {importPreview.errors.slice(0, 8).map((err) => (
                  <li key={`${err.row}-${err.error}`}>
                    第 {err.row} 行：{err.error}
                  </li>
                ))}
                {importPreview.errors.length > 8 ? (
                  <li>另有 {importPreview.errors.length - 8} 行错误未展示</li>
                ) : null}
              </ul>
            ) : null}
          </>
        ) : null}
      </Modal>

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
