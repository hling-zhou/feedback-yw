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
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { PageHeader } from './Dashboard.shared.jsx'
import {
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_STATUS_LABELS,
  ACTION_ITEM_CONTENT_MAX_LENGTH,
  ACTION_ITEM_DETAIL_MAX_LENGTH,
  aggregateActionItemsByProductStatus,
  createEmptyActionItemStatusCounts,
  getActionItemStatusSelectOptions,
  isActionItemLocked,
  actionItemStatusRequiresEmptySchedule,
  actionItemStatusRequiresSchedule,
} from '../domain/actionItem.js'
import {
  ACTIONS_PAGE_SUBTITLE_HINT,
  REQUIREMENT_TICKET_FIELD_TIP,
  SCHEDULE_AT_HEADER_HINT,
} from '../domain/establishedActionHints.js'
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
import { buildFeedbackIndexByTicketId } from '../lib/actionItemLinkedFeedback.js'
import {
  buildProductNameToKeyMap,
  parseActionItemImportWorkbook,
  parseLinkedTicketIdsCell,
} from '../lib/actionItemImport.js'
import { downloadActionItemImportTemplate } from '../lib/actionItemImportTemplate.js'
import { syncLinkedTicketCopies } from '../lib/actionItemTicketSync.js'
import { hasRequirementTicketLinks } from '../domain/requirementTicketProgress.js'
import { listProducts } from '../lib/productTaxonomy.js'
import { filterRecordsForScope } from '../snapshots/recordScope.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { shouldShowRemoteRecordStale } from '../domain/recordRemoteStale.js'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import PermissionGate from '../components/auth/PermissionGate.jsx'
import ActionItemProductStatusChart from '../components/charts/ActionItemProductStatusChart.jsx'
import ActionItemStatusTag from '../components/tags/ActionItemStatusTag.jsx'
import ActionItemConflictModal from '../components/ActionItemConflictModal.jsx'
import ActionItemCompositeFilter from '../components/actions/ActionItemCompositeFilter.jsx'
import LinkedTicketsCell from '../components/actions/LinkedTicketsCell.jsx'
import RequirementTicketsCell from '../components/actions/RequirementTicketsCell.jsx'
import ActionItemRequirementLinkFields, {
  normalizeRequirementTicketIdsFromForm,
  toRequirementTicketFormList,
} from '../components/actions/ActionItemRequirementLinkFields.jsx'
import {
  actionItemFiltersToListQuery,
  clearAllActionItemFilters,
  createEmptyActionItemFilters,
} from '../lib/actionItemFilterModel.js'
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

/** 举措表单弹窗：限制整体高度，内容区滚动，标题栏与底部按钮固定（antd 6：container/wrapper） */
const ACTION_FORM_MODAL_CLASS_NAMES = {
  wrapper: 'action-form-modal-wrap',
}

const ACTION_FORM_MODAL_STYLES = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'calc(100vh - 48px)',
    overflow: 'hidden',
  },
  body: {
    flex: '1 1 auto',
    overflowY: 'auto',
    minHeight: 0,
  },
}

const FILTER_STATUS_OPTIONS = ACTION_ITEM_STATUSES.map((value) => ({
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

const LINKED_FEEDBACK_HEADER_HINT =
  '用户原始反馈（投诉/咨询工单、用后即评等）'
const REQUIREMENT_TICKET_HEADER_HINT = `需求工单号：${REQUIREMENT_TICKET_FIELD_TIP}`

/**
 * @param {Object} props
 * @param {string} props.title
 * @param {string} props.hint
 * @param {import('react').ReactNode} [props.extra]
 */
function ColumnTitleWithHint({ title, hint, extra }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{title}</span>
      {extra}
      <Tooltip title={hint} getPopupContainer={() => document.body}>
        <span className="inline-flex cursor-help align-middle" aria-label={`${title}说明`}>
          <QuestionCircleOutlined className="text-xs text-ink-400" />
        </span>
      </Tooltip>
    </span>
  )
}

/** @param {{ text?: string | null; className?: string }} props */
function TableEllipsisCell({ text, className }) {
  const value = text?.trim() || ''
  if (!value) return <Typography.Text type="secondary">—</Typography.Text>
  return (
    <Tooltip title={value} getPopupContainer={() => document.body}>
      <Typography.Text className={className} ellipsis>
        {value}
      </Typography.Text>
    </Tooltip>
  )
}

function formatTicketIdsForInput(ids) {
  return (ids || []).filter(Boolean).join('\n')
}

function parseTicketIdsFromInput(text) {
  return parseLinkedTicketIdsCell(text)
}

export default function Actions() {
  const { user } = useAuth()
  const { feedbacks, updateFeedback, retagSession, importSession, sharedBackgroundTask, reprocessing } =
    useInsights()
  const [items, setItems] = useState(/** @type {ActionItem[]} */ ([]))
  const [total, setTotal] = useState(0)
  const [allTotal, setAllTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [stats, setStats] = useState(
    /** @type {Record<ActionItemStatus, number>} */ (createEmptyActionItemStatusCounts()),
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

  const [filters, setFilters] = useState(createEmptyActionItemFilters)
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
    /** @type {{ content: string; detail: string; status: ActionItemStatus; scheduleAt: string; linkedRequirementTicketIds: string[] } | null} */ (null),
  )
  const [forceSaving, setForceSaving] = useState(false)
  const baseRevisionRef = useRef(0)
  /** 编辑弹窗打开时的状态，用于状态下拉始终展示全部可选项 */
  const editStatusBaseRef = useRef(/** @type {ActionItemStatus | null} */ (null))
  /** 打开弹窗时「进行中」的排期（dayjs），切走再切回进行中时恢复 */
  const editScheduleAtBaseRef = useRef(/** @type {import('dayjs').Dayjs | null} */ (null))
  const [listRefreshing, setListRefreshing] = useState(false)
  const importInputRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const watchedSchedule = Form.useWatch('scheduleAt', editForm)
  const watchedEditStatus = Form.useWatch('status', editForm)
  const watchedRequirementLinkEnabled = Form.useWatch('requirementLinkEnabled', editForm)

  const [addOpen, setAddOpen] = useState(false)
  const [addForm] = Form.useForm()
  const [adding, setAdding] = useState(false)
  const watchedAddStatus = Form.useWatch('status', addForm)
  const watchedAddRequirementLinkEnabled = Form.useWatch('requirementLinkEnabled', addForm)

  const [importOpen, setImportOpen] = useState(false)
  const [importPreview, setImportPreview] = useState(
    /** @type {{ rows: Partial<ActionItem>[]; errors: { row: number; error: string }[]; warnings: { row: number; message: string }[] } | null} */ (null),
  )
  const [importing, setImporting] = useState(false)

  const editLocked = Boolean(editing && isActionItemLocked(editing.status))
  const editRequirementLinked = Boolean(watchedRequirementLinkEnabled)
  const editCoreFieldsLocked = editLocked || editRequirementLinked

  const editStatusOptions = useMemo(() => {
    if (!editing) return FILTER_STATUS_OPTIONS
    const base = editStatusBaseRef.current ?? editing.status
    return getActionItemStatusSelectOptions(base)
  }, [editing?.id, editing?.status])

  const editScheduleDisabled = useMemo(() => {
    const status = watchedEditStatus ?? editing?.status
    return editCoreFieldsLocked || actionItemStatusRequiresEmptySchedule(status)
  }, [editCoreFieldsLocked, watchedEditStatus, editing?.status])

  const editScheduleRequired = useMemo(
    () => actionItemStatusRequiresSchedule(watchedEditStatus ?? editing?.status ?? 'pending_evaluation'),
    [watchedEditStatus, editing?.status],
  )

  const addScheduleDisabled = useMemo(
    () =>
      watchedAddRequirementLinkEnabled ||
      actionItemStatusRequiresEmptySchedule(watchedAddStatus ?? 'pending_evaluation'),
    [watchedAddRequirementLinkEnabled, watchedAddStatus],
  )

  const addScheduleRequired = useMemo(
    () =>
      !watchedAddRequirementLinkEnabled &&
      actionItemStatusRequiresSchedule(watchedAddStatus ?? 'pending_evaluation'),
    [watchedAddRequirementLinkEnabled, watchedAddStatus],
  )

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

  const feedbackByTicketId = useMemo(
    () => buildFeedbackIndexByTicketId(feedbacks),
    [feedbacks],
  )

  const resolveLinkedTicketIds = useCallback(
    (/** @type {ActionItem} */ record) => {
      if (!periodFilterActive) return record.linkedTicketIds || []
      return linkedTicketIdsInPeriod(record.linkedTicketIds, periodTicketIdSet)
    },
    [periodFilterActive, periodTicketIdSet],
  )

  const productNameByKey = useMemo(
    () => new Map(productOptions.map((item) => [item.value, item.label])),
    [productOptions],
  )

  const handleFiltersChange = useCallback((next) => {
    setFilters(next)
    setPage(1)
  }, [])

  const handleClearFilters = useCallback(() => {
    setFilters(clearAllActionItemFilters())
    setPage(1)
  }, [])

  const tableFilters = useMemo(() => actionItemFiltersToListQuery(filters), [filters])

  const listQuery = useMemo(
    () => ({
      ...tableFilters,
      firstProposedFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
      firstProposedTo: dateRange?.[1]?.format('YYYY-MM-DD'),
      insightPeriodId: insightPeriodId || undefined,
    }),
    [tableFilters, dateRange, insightPeriodId],
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
      const counts = { ...createEmptyActionItemStatusCounts(), ...(data.counts || {}) }
      setStats(counts)

      let byProduct = Array.isArray(data.byProduct) ? data.byProduct : []
      const total = ACTION_ITEM_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0)
      if (!byProduct.length && total > 0) {
        const result = await listActionItems({ ...baseScopeQuery, limit: 500, offset: 0 })
        byProduct = aggregateActionItemsByProductStatus(result.items, {
          periodTicketIdSet: periodTicketIdSet,
        })
      } else if (byProduct.some((row) => !row.linkedFeedbackCounts)) {
        const result = await listActionItems({ ...baseScopeQuery, limit: 500, offset: 0 })
        const enriched = aggregateActionItemsByProductStatus(result.items, {
          periodTicketIdSet: periodTicketIdSet,
        })
        const enrichedByKey = new Map(enriched.map((row) => [row.productKey, row]))
        byProduct = byProduct.map((row) => {
          const full = enrichedByKey.get(row.productKey)
          if (!full?.linkedFeedbackCounts) return row
          return {
            ...row,
            linkedFeedbackCounts: full.linkedFeedbackCounts,
            linkedFeedbackTotal: full.linkedFeedbackTotal,
          }
        })
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
        feedbackByTicketId,
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

  const parseScheduleForPicker = (value) => {
    const normalized = normalizeActionSchedule(value)
    if (!normalized) return null
    const parsed = dayjs(normalized, 'YYYY-MM-DD', true)
    return parsed.isValid() ? parsed : null
  }

  const syncEditModalBaseline = (record) => {
    editStatusBaseRef.current = record.status
    const scheduleAt = parseScheduleForPicker(record.scheduleAt)
    editScheduleAtBaseRef.current = record.status === 'in_progress' ? scheduleAt : null
    return scheduleAt
  }

  const openEdit = (record) => {
    setEditing(record)
    baseRevisionRef.current = getActionItemRevision(record)
    setEditStale(false)
    setConflictOpen(false)
    const requirementLinked = record.requirementLinkMode || hasRequirementTicketLinks(record)
    const scheduleAt = syncEditModalBaseline(record)
    editForm.setFieldsValue({
      content: record.content,
      detail: record.detail || '',
      status: record.status,
      scheduleAt,
      requirementLinkEnabled: requirementLinked,
      requirementTicketIds: toRequirementTicketFormList(record.linkedRequirementTicketIds),
    })
    setEditOpen(true)
  }

  const handleEditRequirementLinkModeChange = (enabled) => {
    if (enabled || !editing) return
    editForm.setFieldsValue({
      status: editing.status,
      scheduleAt: syncEditModalBaseline(editing),
    })
  }

  useEffect(() => {
    if (!editOpen || !editing?.id) return
    const latest = items.find((item) => item.id === editing.id)
    if (!latest) return
    if (
      !shouldShowRemoteRecordStale(latest, baseRevisionRef.current, {
        userId: user?.id,
        retagActive: retagSession.active,
        importActive: importSession.active,
        reprocessingActive: reprocessing,
        sharedBackgroundTask,
      })
    ) {
      baseRevisionRef.current = getActionItemRevision(latest)
      setEditStale(false)
      return
    }
    setEditStale(true)
  }, [
    editOpen,
    editing?.id,
    items,
    user?.id,
    retagSession.active,
    importSession.active,
    reprocessing,
    sharedBackgroundTask,
  ])

  const handleEditStatusChange = (status) => {
    if (actionItemStatusRequiresEmptySchedule(status)) {
      editForm.setFieldsValue({ scheduleAt: null })
    }
    if (actionItemStatusRequiresSchedule(status)) {
      if (
        editStatusBaseRef.current === 'in_progress' &&
        editScheduleAtBaseRef.current != null
      ) {
        editForm.setFieldsValue({ scheduleAt: editScheduleAtBaseRef.current })
      }
      editForm.validateFields(['scheduleAt']).catch(() => {})
    }
  }

  const buildEditPatch = (values) => {
    const detail = String(values.detail ?? '').trim()
    const requirementLinkEnabled = Boolean(values.requirementLinkEnabled)
    const linkedRequirementTicketIds = requirementLinkEnabled
      ? normalizeRequirementTicketIdsFromForm(values.requirementTicketIds)
      : []

    if (requirementLinkEnabled) {
      return {
        detail,
        linkedRequirementTicketIds,
      }
    }

    const scheduleAt = values.scheduleAt
      ? dayjs(values.scheduleAt).format('YYYY-MM-DD')
      : ''
    const status = values.status
    if (actionItemStatusRequiresEmptySchedule(status)) {
      return {
        content: values.content.trim(),
        detail,
        status,
        scheduleAt: '',
        linkedRequirementTicketIds,
      }
    }
    return {
      content: values.content.trim(),
      detail,
      status,
      scheduleAt,
      linkedRequirementTicketIds,
    }
  }

  const applyEditFormFromItem = (item) => {
    const requirementLinked = item.requirementLinkMode || hasRequirementTicketLinks(item)
    editForm.setFieldsValue({
      content: item.content,
      detail: item.detail || '',
      status: item.status,
      scheduleAt: syncEditModalBaseline(item),
      requirementLinkEnabled: requirementLinked,
      requirementTicketIds: toRequirementTicketFormList(item.linkedRequirementTicketIds),
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
    message.success(synced > 0 ? `已保存，并同步 ${synced} 条关联反馈` : '已保存')
    setEditOpen(false)
    setConflictOpen(false)
    loadItems()
    loadStats()
  }

  const handleEditSave = async (saveOptions = {}) => {
    if (!editing) return
    const values = await editForm.validateFields()
    if (values.requirementLinkEnabled) {
      const ticketIds = normalizeRequirementTicketIdsFromForm(values.requirementTicketIds)
      if (!ticketIds.length) {
        message.warning('关联需求工单时请填写至少一个工单号')
        return
      }
    }
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
    addForm.setFieldsValue({
      status: 'pending_evaluation',
      requirementLinkEnabled: false,
      requirementTicketIds: [''],
    })
    setAddOpen(true)
  }

  const handleAddSave = async () => {
    const values = await addForm.validateFields()
    const productKey = values.productKey?.trim() || ''
    const productName =
      productOptions.find((option) => option.value === productKey)?.label?.trim() || ''
    const requirementLinkEnabled = Boolean(values.requirementLinkEnabled)
    const linkedRequirementTicketIds = requirementLinkEnabled
      ? normalizeRequirementTicketIdsFromForm(values.requirementTicketIds)
      : []
    if (requirementLinkEnabled && !linkedRequirementTicketIds.length) {
      message.warning('关联需求工单时请填写至少一个工单号')
      return
    }
    const scheduleAt =
      requirementLinkEnabled || !values.scheduleAt
        ? ''
        : dayjs(values.scheduleAt).format('YYYY-MM-DD')
    const status = requirementLinkEnabled
      ? 'pending_evaluation'
      : values.status ?? 'pending_evaluation'

    setAdding(true)
    try {
      await createActionItem({
        content: values.content.trim(),
        detail: values.detail?.trim() || '',
        productKey,
        productName,
        painPointSnapshot: values.painPointSnapshot?.trim() || '',
        problemTypeSnapshot: values.problemTypeSnapshot?.trim() || '',
        scheduleAt,
        status,
        linkedTicketIds: [],
        linkedRequirementTicketIds,
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
      render: (text) => <TableEllipsisCell text={text} />,
    },
    {
      title: '问题类型',
      dataIndex: 'problemTypeSnapshot',
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
      width: 180,
    },
    {
      title: '举措详情',
      dataIndex: 'detail',
      ellipsis: true,
      width: 140,
      render: (text) => <TableEllipsisCell text={text} />,
    },
    {
      title: (
        <ColumnTitleWithHint
          title="关联反馈"
          hint={LINKED_FEEDBACK_HEADER_HINT}
          extra={
            periodFilterActive ? (
              <Typography.Text type="secondary" className="text-[10px] font-normal">
                (本周期)
              </Typography.Text>
            ) : null
          }
        />
      ),
      key: 'linkedTickets',
      width: 110,
      render: (_, record) => (
        <LinkedTicketsCell
          ticketIds={resolveLinkedTicketIds(record)}
          feedbackByTicketId={feedbackByTicketId}
        />
      ),
    },
    {
      title: (
        <ColumnTitleWithHint title="需求工单" hint={REQUIREMENT_TICKET_HEADER_HINT} />
      ),
      key: 'linkedRequirementTickets',
      width: 160,
      render: (_, record) => (
        <RequirementTicketsCell
          ticketIds={record.linkedRequirementTicketIds}
          requirementTickets={record.requirementTickets}
        />
      ),
    },
    {
      title: <ColumnTitleWithHint title="排期时间" hint={SCHEDULE_AT_HEADER_HINT} />,
      key: 'scheduleAt',
      width: 120,
      render: (_, record) => {
        const linked = Boolean(record.requirementLinkMode)
        const scheduleText = linked
          ? record.derivedScheduleAt?.trim() || '—'
          : record.scheduleAt?.trim() || '—'
        const warningActive = linked
          ? Boolean(record.derivedScheduleAt)
          : record.status === 'in_progress'
        const warningLevel = linked ? record.derivedWarningLevel : record.warningLevel
        return (
          <Space size={4}>
            <span className={warningActive ? scheduleWarningClass(warningLevel) : undefined}>
              {scheduleText}
            </span>
            {!linked && record.scheduleChanged ? (
              <Tag color="orange" className="!m-0 !text-[10px]">
                变更
              </Tag>
            ) : null}
          </Space>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status, record) => {
        if (record.requirementLinkMode) {
          if (!record.derivedStatus) {
            return (
              <Tag color="warning" className="!m-0">
                待同步
              </Tag>
            )
          }
          return <ActionItemStatusTag status={record.derivedStatus} />
        }
        return <ActionItemStatusTag status={status} />
      },
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
      render: (_, record) => {
        const locked = isActionItemLocked(record.status)
        return (
          <PermissionGate permission="editRecord">
            <Tooltip title={locked ? '已结束，不可编辑' : '修改状态 / 内容 / 排期'}>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                className="!px-0"
                disabled={locked}
                onClick={() => openEdit(record)}
              />
            </Tooltip>
          </PermissionGate>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="举措与进展"
        desc="集中查看确立的举措及完成进展，支持更新状态、修改排期，及临期预警。"
        hint={ACTIONS_PAGE_SUBTITLE_HINT}
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
        <div className="mb-3 flex w-full flex-wrap items-start gap-2">
          <ActionItemCompositeFilter
            className="min-w-0 flex-1"
            filters={filters}
            onFiltersChange={handleFiltersChange}
            onClearFilters={handleClearFilters}
            options={{
              productOptions,
              statusOptions: FILTER_STATUS_OPTIONS,
              productNameByKey,
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
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={items}
          scroll={{ x: 1680 }}
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
        centered
        onCancel={() => setAddOpen(false)}
        onOk={handleAddSave}
        confirmLoading={adding}
        destroyOnClose
        classNames={ACTION_FORM_MODAL_CLASS_NAMES}
        styles={ACTION_FORM_MODAL_STYLES}
      >
        <Typography.Paragraph type="secondary" className="!mb-3 !text-xs">
          问题、问题类型、来源、关联反馈、需求工单均可留空；首次提出时间记为今天。后续在工单详情中首次关联该举措时，空字段将从该工单的「需求痛点」「问题类型」及来源自动补齐。
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
          <Form.Item
            name="detail"
            label="举措详情（可选）"
            rules={[{ max: ACTION_ITEM_DETAIL_MAX_LENGTH, message: `不超过 ${ACTION_ITEM_DETAIL_MAX_LENGTH} 字` }]}
          >
            <Input.TextArea rows={3} showCount maxLength={ACTION_ITEM_DETAIL_MAX_LENGTH} />
          </Form.Item>
          <Form.Item name="painPointSnapshot" label="问题（可选）">
            <Input placeholder="需求痛点摘要" />
          </Form.Item>
          <Form.Item name="problemTypeSnapshot" label="问题类型（可选）">
            <Input />
          </Form.Item>
          <ActionItemRequirementLinkFields form={addForm} />
          {!watchedAddRequirementLinkEnabled ? (
            <>
              <Form.Item name="status" label="状态" initialValue="pending_evaluation" rules={[{ required: true }]}>
                <Select
                  options={getActionItemStatusSelectOptions('pending_evaluation')}
                  onChange={(status) => {
                    if (actionItemStatusRequiresEmptySchedule(status)) {
                      addForm.setFieldsValue({ scheduleAt: null })
                    }
                    if (actionItemStatusRequiresSchedule(status)) {
                      addForm.validateFields(['scheduleAt']).catch(() => {})
                    }
                  }}
                />
              </Form.Item>
              <Form.Item
                name="scheduleAt"
                label="排期时间"
                dependencies={['status']}
                rules={
                  addScheduleRequired
                    ? [{ required: true, message: '进行中须填写排期时间' }]
                    : []
                }
              >
                <DatePicker
                  className="w-full"
                  format="YYYY-MM-DD"
                  placeholder={
                    addScheduleDisabled
                      ? '当前状态无需排期'
                      : addScheduleRequired
                        ? '请选择排期（必填）'
                        : undefined
                  }
                  allowClear
                  disabled={addScheduleDisabled}
                />
              </Form.Item>
            </>
          ) : null}
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
          ；仅「举措*（必填）」必填。问题等可选列留空时，首次关联反馈后自动补齐。填写需求工单时排期/状态列将被忽略。首次提出时间统一记为导入当天。
        </Typography.Paragraph>
        {importPreview ? (
          <>
            <Alert
              type={importPreview.errors.length ? 'warning' : 'info'}
              showIcon
              className="!mb-3"
              message={`解析到 ${importPreview.rows.length} 条可导入举措${
                importPreview.errors.length ? `，${importPreview.errors.length} 行有误将跳过` : ''
              }${importPreview.warnings?.length ? `，${importPreview.warnings.length} 条提示` : ''}`}
            />
            {importPreview.warnings?.length > 0 ? (
              <ul className="mb-3 max-h-32 overflow-y-auto pl-5 text-xs text-amber-700">
                {importPreview.warnings.slice(0, 8).map((warn) => (
                  <li key={`${warn.row}-${warn.message}`}>
                    第 {warn.row} 行：{warn.message}
                  </li>
                ))}
                {importPreview.warnings.length > 8 ? (
                  <li>另有 {importPreview.warnings.length - 8} 条提示未展示</li>
                ) : null}
              </ul>
            ) : null}
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
        centered
        onCancel={() => setEditOpen(false)}
        onOk={editLocked ? undefined : () => handleEditSave()}
        okButtonProps={{ style: editLocked ? { display: 'none' } : undefined }}
        cancelText={editLocked ? '关闭' : '取消'}
        confirmLoading={saving}
        destroyOnClose
        classNames={ACTION_FORM_MODAL_CLASS_NAMES}
        styles={ACTION_FORM_MODAL_STYLES}
      >
        {editLocked ? (
          <Alert
            type="info"
            showIcon
            className="!mb-3"
            message="该举措已结束"
            description="已完成、不予实施、异常终止的举措不可再修改内容、排期或状态。"
          />
        ) : null}
        {editRequirementLinked && !editLocked ? (
          <Alert
            type="info"
            showIcon
            className="!mb-3"
            message="已选择关联需求工单"
            description="各需求工单的排期与状态将自动从「需求工单进展同步」读取并展示，不可修改。切换为「不关联」后可自行填写举措排期与状态。"
          />
        ) : null}
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
            <Input.TextArea
              rows={4}
              showCount
              maxLength={ACTION_ITEM_CONTENT_MAX_LENGTH}
              disabled={editCoreFieldsLocked}
            />
          </Form.Item>
          <Form.Item
            name="detail"
            label="举措详情（可选）"
            rules={[{ max: ACTION_ITEM_DETAIL_MAX_LENGTH, message: `不超过 ${ACTION_ITEM_DETAIL_MAX_LENGTH} 字` }]}
          >
            <Input.TextArea
              rows={3}
              showCount
              maxLength={ACTION_ITEM_DETAIL_MAX_LENGTH}
              disabled={editLocked}
            />
          </Form.Item>
          <ActionItemRequirementLinkFields
            form={editForm}
            disabled={editLocked}
            initialTicketDetails={editing?.requirementTickets}
            onLinkModeChange={handleEditRequirementLinkModeChange}
          />
          {!editRequirementLinked ? (
            <>
              <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                <Select
                  options={editStatusOptions}
                  disabled={editCoreFieldsLocked}
                  onChange={handleEditStatusChange}
                />
              </Form.Item>
              <Form.Item
                name="scheduleAt"
                label="排期时间"
                dependencies={['status']}
                rules={
                  editScheduleRequired
                    ? [{ required: true, message: '进行中须填写排期时间' }]
                    : []
                }
              >
                <DatePicker
                  className="w-full"
                  format="YYYY-MM-DD"
                  placeholder={
                    editScheduleDisabled && !editLocked
                      ? '当前状态无需排期'
                      : editScheduleRequired
                        ? '请选择排期（必填）'
                        : undefined
                  }
                  allowClear
                  disabled={editScheduleDisabled}
                />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>

      <ActionItemConflictModal
        open={conflictOpen}
        actionLabel={editing?.productName || editing?.content?.slice(0, 20)}
        serverItem={conflictServerItem}
        draft={
          conflictDraft || {
            content: editing?.content || '',
            detail: editing?.detail || '',
            status: editing?.status || 'pending_evaluation',
            scheduleAt: editing?.scheduleAt || '',
            linkedRequirementTicketIds: editing?.linkedRequirementTicketIds || [],
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
