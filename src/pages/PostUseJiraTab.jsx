import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Form,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import {
  deletePostUseJiraItem,
  deletePostUseJiraItems,
  listAssignees,
  listPostUseJiraItems,
  patchPostUseJiraItem,
} from '../lib/postUseJiraClient.js'
import { downloadPostUseJiraExcel } from '../lib/postUseRating/postUseJiraExport.js'
import { useAuth } from '../context/AuthContext.jsx'
import PostUseJiraDrawer from '../components/actions/PostUseJiraDrawer.jsx'
import PostUseJiraCompositeFilter from '../components/actions/PostUseJiraCompositeFilter.jsx'
import {
  clearAllPostUseJiraFilters,
  createEmptyPostUseJiraFilters,
  postUseJiraFiltersToListQuery,
} from '../lib/postUseJiraFilterModel.js'

const PAGE_SIZE = 20

/** 2026-11-05：状态自动流转后的视觉语义——待处理灰 / 处理中蓝 / 已处理绿 */
const STATUS_TAG_COLOR = /** @type {Record<string, string>} */ ({
  待处理: 'default',
  处理中: 'processing',
  已处理: 'success',
})

/**
 * 产品部溯源视图（反馈库 · 用后即评满意度 · 视图 2）。
 * 从建议回访/溯源清单一键存档而来；状态由操作自动流转（提交→已处理 / 暂存→处理中），
 * 支持经办人/回溯结果编辑、周期月份过滤。
 * 2026-11-05 拍板移除：状态下拉、列表个人标记勾选列与个人状态列（jira: 前缀个人标记体系整体下线）。
 *
 * @param {object} props
 * @param {string[]} [props.months] 当前周期覆盖的月份（YYYY-MM），空数组 = 不限周期
 * @param {string} [props.periodLabel] 周期标签（展示用）
 */
export default function PostUseJiraTab({ months = [], periodLabel = '' }) {
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
  const [assignees, setAssignees] = useState([])
  const [form] = Form.useForm()
  const stickyChromeRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [stickyChromeHeight, setStickyChromeHeight] = useState(0)

  useEffect(() => {
    const chrome = stickyChromeRef.current
    if (!chrome) return undefined
    const syncOffset = () => setStickyChromeHeight(chrome.offsetHeight)
    syncOffset()
    const ro = new ResizeObserver(syncOffset)
    ro.observe(chrome)
    return () => ro.disconnect()
  }, [])

  // 一次性拉取 ≤500 条 + 前端过滤分页（用户拍板：视图 2 跟随当前周期）
  const load = async () => {
    setLoading(true)
    try {
      const res = await listPostUseJiraItems({ limit: 500 })
      setItems(res?.items || [])
      setTotal(Number(res?.total) || 0)
    } catch (error) {
      message.error(error?.message || '加载产品部溯源失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    listAssignees()
      .then((res) => setAssignees(res?.users || []))
      .catch(() => {})
  }, [])

  const assigneeMap = useMemo(() => {
    /** @type {Map<string, string>} */
    const m = new Map()
    for (const u of assignees) m.set(u.id, u.username)
    return m
  }, [assignees])

  // 周期月份 + 复合筛选在前端过滤
  const monthSet = useMemo(() => new Set(months), [months])
  const filteredItems = useMemo(() => {
    const productName = String(filters.productName || '').trim()
    const status = String(filters.status || '').trim()
    const search = String(filters.search || '').trim().toLowerCase()
    const importMonth = String(filters.importMonth || '').trim()
    const assigneeId = String(filters.assigneeId || '').trim()
    return items.filter((item) => {
      if (monthSet.size) {
        const itemMonths = String(item.importMonth || '')
          .split('、')
          .map((m) => m.trim())
          .filter(Boolean)
        if (!itemMonths.some((m) => monthSet.has(m))) return false
      }
      if (importMonth && !String(item.importMonth || '').includes(importMonth)) return false
      if (productName && item.productName !== productName) return false
      if (status && item.status !== status) return false
      if (assigneeId && item.assigneeId !== assigneeId) return false
      if (search) {
        const haystack = [item.customerName, item.customerCode, item.customerFeedback]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
  }, [items, monthSet, filters.productName, filters.status, filters.search, filters.importMonth, filters.assigneeId])

  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, page])

  useEffect(() => {
    setPage(1)
  }, [filters, months])

  const openEdit = (item) => {
    setEditing(item)
    form.setFieldsValue({
      assigneeId: item.assigneeId || '',
      progress: item.progress || '',
    })
  }

  // 2026-11-05 拍板：状态由操作自动判定——提交=已处理（回溯结果必填校验在抽屉 Form rules）/ 暂存=处理中；成功后关抽屉
  const saveEdit = async (mode = 'draft') => {
    if (!editing) return
    if (mode === 'submit') {
      await form.validateFields() // 触发"回溯结果"必填校验，空则抛错留在抽屉
    }
    const values = form.getFieldsValue()
    setSaving(true)
    try {
      const { item } = await patchPostUseJiraItem(editing.id, {
        assigneeId: values.assigneeId,
        status: mode === 'submit' ? '已处理' : '处理中',
        progress: values.progress,
      })
      setItems((list) => list.map((row) => (row.id === item.id ? item : row)))
      setEditing(null)
      message.success(mode === 'submit' ? '回溯已完成' : '已暂存')
    } catch (error) {
      message.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 抽屉里保存确立举措（source=post_use）后回写 payload.actionId */
  const handleActionSaved = async (actionId) => {
    if (!editing?.id) return
    try {
      const { item } = await patchPostUseJiraItem(editing.id, { actionId })
      setItems((list) => list.map((row) => (row.id === item.id ? item : row)))
      setEditing(item)
    } catch (error) {
      message.error(error?.message || '举措关联失败')
    }
  }

  /** 抽屉里清除举措关联 */
  const handleActionCleared = async () => {
    if (!editing?.id) return
    try {
      const { item } = await patchPostUseJiraItem(editing.id, { actionId: '' })
      setItems((list) => list.map((row) => (row.id === item.id ? item : row)))
      setEditing(item)
    } catch (error) {
      message.error(error?.message || '清除举措关联失败')
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

  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    if (!filteredItems.length) {
      message.info('当前筛选范围内无数据')
      return
    }
    setExporting(true)
    try {
      await downloadPostUseJiraExcel(filteredItems, periodLabel || '当前范围')
      message.success(`已导出 ${filteredItems.length} 条产品部溯源记录`)
    } catch (error) {
      message.error(error?.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div
        ref={stickyChromeRef}
        // 布局一致性（11-09 方案 A 用户拍板）：卡片内嵌吸顶形态——与工单/原始数据
        // 视图的共享 sticky chrome 同款（白底 + -mx-4/px-4 抵消宿主 page-card 的 p-4），
        // 不再用页面级 .page-sticky-chrome（其负边距锚定外壳 padding，嵌卡片内会在
        // lg 断点溢出卡片边缘、灰底与白底卡片视觉割裂）
        className="sticky top-0 z-20 -mx-4 space-y-2 rounded-t-lg border-b border-ink-100 bg-white px-4 pb-3 pt-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新
            </Button>
            <Button
              icon={<UploadOutlined />}
              onClick={() => void handleExport()}
              loading={exporting}
              disabled={!filteredItems.length}
            >
              导出
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
        <div className="flex w-full flex-wrap items-start gap-2">
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
      </div>
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={pageItems}
        scroll={{ x: 1040 }}
        sticky={{ offsetHeader: stickyChromeHeight }}
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
          total: filteredItems.length,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
        onRow={(record) => ({
          onClick: () => openEdit(record),
          className: 'cursor-pointer',
        })}
        columns={[
          { title: '数据月份', dataIndex: 'importMonth', width: 90 },
          // 2026-11-10 拍板：客户编码主流 20 字符 → 宽 220 保完整不截断；客户名称截断时 hover 气泡（参考工单列表）
          {
            title: '客户名称',
            dataIndex: 'customerName',
            width: 150,
            ellipsis: true,
            render: (val) => (
              <Tooltip title={val || undefined} getPopupContainer={() => document.body}>
                <Typography.Text ellipsis>{val || '—'}</Typography.Text>
              </Tooltip>
            ),
          },
          { title: '客户编码', dataIndex: 'customerCode', width: 220 },
          { title: '产品名称', dataIndex: 'productName', width: 100, ellipsis: true },
          { title: '客户反馈', dataIndex: 'customerFeedback', ellipsis: true },
          { title: '经办人', dataIndex: 'assigneeName', width: 120, ellipsis: true,
            render: (v, row) => v || assigneeMap.get(row.assigneeId) || '—' },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (value) => <Tag color={STATUS_TAG_COLOR[value] || 'default'}>{value || '待处理'}</Tag>,
          },
          { title: '回溯结果', dataIndex: 'progress', width: 160, ellipsis: true },
          canEdit
            ? {
                title: '操作',
                key: 'actions',
                width: 56,
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
        onSave={(mode) => void saveEdit(mode)}
        onActionSaved={(actionId) => void handleActionSaved(actionId)}
        onActionCleared={() => void handleActionCleared()}
      />
    </div>
  )
}
