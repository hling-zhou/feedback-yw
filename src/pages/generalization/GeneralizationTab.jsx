import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Drawer as AntDrawer,
  Dropdown,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  listGeneralizationIssues,
  getGeneralizationIssue,
  updateGeneralizationIssue,
  deleteGeneralizationIssue,
  detachGeneralizationLink,
  reviewGeneralizationMatch,
  searchGeneralizationRecords,
  attachGeneralizationLink,
} from '../../lib/generalizationClient.js'
import {
  buildGeneralizationIssuesCsv,
  downloadGeneralizationCsv,
} from '../../lib/generalization/generalizationExportCsv.js'
import {
  GENERALIZATION_ISSUE_STATUS_LABELS,
  GENERALIZATION_LINK_STATUS_LABELS,
  GENERALIZATION_LINK_SOURCE_LABELS,
  GENERALIZATION_CATEGORIES,
  GENERALIZATION_CATEGORY_LABELS,
  formatGeneralizationCategoryLabel,
  GENERALIZATION_SCOPES,
  GENERALIZATION_SCOPE_LABELS,
  GENERALIZATION_SUMMARY_MAX_LENGTH,
} from '../../domain/generalizationIssue.js'
import { useAuth } from '../../context/AuthContext.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import GeneralizationMatchQueue from './GeneralizationMatchQueue.jsx'
import GeneralizationDetailDrawer from '../../components/generalization/GeneralizationDetailDrawer.jsx'

/** @typedef {import('../../domain/generalizationIssue.js').GeneralizationIssue} GeneralizationIssue */
/** @typedef {import('../../domain/generalizationIssue.js').GeneralizationIssueLink} GeneralizationIssueLink */

const STATUS_TAG_COLOR = {
  in_progress: 'processing',
  completed: 'success',
  terminated: 'default',
}

const CATEGORY_TAG_COLOR = {
  code_logic: 'geekblue',
  special_scenario: 'orange',
  console_ux: 'cyan',
  api_doc: 'purple',
  business_rule: 'volcano',
  other_intervenable: 'default',
}

const CONFIDENCE_TAG_COLOR = {
  high: 'gold',
  medium: 'blue',
  low: 'default',
}

const DATA_SOURCE_LABELS = {
  complaint_ticket: '投诉工单',
  consultation_ticket: '咨询工单',
  post_use_rating: '用后即评',
}

/** 清单两新列截断（v3.4：截断 30 字 + tooltip 全文） */
const clipCol = (t) => {
  const s = String(t || '').trim()
  return s ? (s.length > 30 ? `${s.slice(0, 30)}…` : s) : '待补全'
}

/**
 * 举一反三 Tab（/actions?tab=generalization）：上段清单 + 下段待复核队列（队列独立组件）。
 * 展开行 = 快速读证据 + pending 三选一；详情侧滑 = 本体编辑（root_cause/optimization 唯一编辑入口）+ 来源举措。
 *
 * @param {Object} props
 * @param {(link: { recordId?: string, recordDataSource?: string, ticketId?: string }) => void | Promise<void>} [props.onOpenRecord]
 */
export default function GeneralizationTab({ onOpenRecord }) {
  const { can } = useAuth()
  const canEdit = can('editRecord')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [messageApi, contextHolder] = message.useMessage()

  const [issues, setIssues] = useState(
    /** @type {(GeneralizationIssue & { ticketCount: number, ratingCount: number })[]} */ ([]),
  )
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ keyword: '', status: '', category: '', scope: '' })
  const [exporting, setExporting] = useState(false)

  // 展开行状态
  const [expandedIssueId, setExpandedIssueId] = useState(null)
  const [issueLinks, setIssueLinks] = useState(/** @type {GeneralizationIssueLink[]} */ ([]))
  const [linksLoading, setLinksLoading] = useState(false)

  // 详情侧滑（11-04 抽出为 GeneralizationDetailDrawer——issueId 驱动，编辑表单与保存逻辑均在组件内）
  const [detailIssueId, setDetailIssueId] = useState(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)

  // URL 参数 issueId：举措抽屉「已升级」跳转入口（?issueId=xxx 自动打开侧滑，消费后清参）
  useEffect(() => {
    const issueId = searchParams.get('issueId')
    if (!issueId) return
    void (async () => {
      try {
        const detail = await getGeneralizationIssue(issueId)
        if (detail.issue) {
          void openDetail(detail.issue)
        }
      } catch {
        // issue 不存在时静默忽略
      }
    })()
    const next = new URLSearchParams(searchParams)
    next.delete('issueId')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listGeneralizationIssues({
        page,
        pageSize,
        keyword: filters.keyword || undefined,
        status: /** @type {any} */ (filters.status || undefined),
        category: /** @type {any} */ (filters.category || undefined),
        scope: /** @type {any} */ (filters.scope || undefined),
      })
      setIssues(result.issues)
      setTotal(result.total)
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '加载举一反三问题失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filters, messageApi])

  /**
   * CSV 导出（G3-1）：当前筛选 / 全部 两档——分页取全（pageSize 上限 100 循环）+
   * 逐 issue 拉 links + actionRefs 组证据明细与来源举措列；cap 5000。
   * @param {'filtered' | 'all'} scope
   */
  const handleExport = async (scope) => {
    setExporting(true)
    try {
      const filterParams =
        scope === 'filtered'
          ? {
              keyword: filters.keyword || undefined,
              status: /** @type {any} */ (filters.status || undefined),
              category: /** @type {any} */ (filters.category || undefined),
              scope: /** @type {any} */ (filters.scope || undefined),
            }
          : {}
      const result = await listGeneralizationIssues({ ...filterParams, page: 1, pageSize: 100 })
      let allIssues = result.issues
      const totalPages = Math.ceil(result.total / result.pageSize)
      for (let p = 2; p <= totalPages; p += 1) {
        const next = await listGeneralizationIssues({ ...filterParams, page: p, pageSize: 100 })
        allIssues = allIssues.concat(next.issues)
      }
      // 证据明细 + 来源举措：逐 issue 拉详情（cap 内）
      const capped = allIssues.slice(0, 5000)
      const linksByIssue = []
      for (const issue of capped) {
        const detail = await getGeneralizationIssue(issue.id)
        linksByIssue.push({ issueId: issue.id, links: detail.links, actionRefs: detail.actionRefs })
      }
      const { csv, rowCount, truncated } = buildGeneralizationIssuesCsv({
        issues: capped,
        linksByIssue,
      })
      const datePart = new Date().toISOString().slice(0, 10)
      const scopePart = scope === 'filtered' ? '当前筛选' : '全部'
      downloadGeneralizationCsv(csv, `举一反三问题-${scopePart}-${datePart}.csv`)
      messageApi.success(`已导出 ${rowCount} 条举一反三问题${truncated ? '（超出上限已截断）' : ''}`)
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [reload])

  const loadLinksFor = useCallback(async (issueId) => {
    setLinksLoading(true)
    try {
      const detail = await getGeneralizationIssue(issueId)
      setIssueLinks(detail.links)
    } catch {
      setIssueLinks([])
    } finally {
      setLinksLoading(false)
    }
  }, [])

  useEffect(() => {
    if (expandedIssueId) void loadLinksFor(expandedIssueId)
  }, [expandedIssueId, loadLinksFor])

  const handleReviewPending = async (link, action) => {
    try {
      await reviewGeneralizationMatch(link.id, action)
      messageApi.success(action === 'confirm' ? '已确认关联' : '已否决建议')
      if (expandedIssueId) await loadLinksFor(expandedIssueId)
      await reload()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  const handleDetachFromExpanded = async (link) => {
    try {
      await detachGeneralizationLink(link.issueId, link.id)
      messageApi.success('已解除关联')
      if (expandedIssueId) await loadLinksFor(expandedIssueId)
      await reload()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '解除失败')
    }
  }

  const openDetail = (issue) => {
    // 11-04：详情抽屉抽出为独立组件（issueId 驱动——组件内自拉全量并自管编辑表单）
    setDetailIssueId(issue.id)
    setDetailDrawerOpen(true)
  }

  const handleDeleteIssue = async (issue) => {
    try {
      await deleteGeneralizationIssue(issue.id)
      messageApi.success('已删除')
      await reload()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '删除失败')
    }
  }


  const confirmedLinks = useMemo(
    () => issueLinks.filter((l) => l.linkStatus === 'confirmed'),
    [issueLinks],
  )
  const ticketLinks = confirmedLinks.filter((l) => l.recordDataSource !== 'post_use_rating')
  const ratingLinks = confirmedLinks.filter((l) => l.recordDataSource === 'post_use_rating')
  const pendingLinks = issueLinks.filter((l) => l.linkStatus === 'pending_suggest')

  const columns = /** @type {import('antd').TableColumnsType<GeneralizationIssue & { ticketCount: number, ratingCount: number }>} */ ([
    { title: '产品', dataIndex: 'productName', width: 120, ellipsis: true },
    {
      title: '问题标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (v, record) => (
        <Button type="link" size="small" className="!px-0" onClick={() => void openDetail(record)}>
          {v}
        </Button>
      ),
    },
    {
      title: '范畴',
      dataIndex: 'category',
      width: 110,
      // 11-04：「其他」带自定义说明拼「其他：xxx」（payload.categoryOther）
      render: (v, record) => {
        const label = formatGeneralizationCategoryLabel(v, record?.payload?.categoryOther)
        return (
          <Tooltip title={label}>
            <Tag color={CATEGORY_TAG_COLOR[v] || 'default'} className="!m-0">
              {label}
            </Tag>
          </Tooltip>
        )
      },
    },
    {
      title: '共性',
      dataIndex: 'scope',
      width: 95,
      render: (v) =>
        v ? GENERALIZATION_SCOPE_LABELS[v] || v : '—',
    },
    {
      title: '根因分析',
      dataIndex: 'rootCause',
      width: 130,
      ellipsis: true,
      render: (v) => (
        <Tooltip title={v || '待补全（侧滑编辑）'}>
          <span className={v ? '' : 'text-ink-400'}>{clipCol(v)}</span>
        </Tooltip>
      ),
    },
    {
      title: '优化方案',
      dataIndex: 'optimization',
      width: 130,
      ellipsis: true,
      render: (v) => (
        <Tooltip title={v || '待补全（侧滑编辑）'}>
          <span className={v ? '' : 'text-ink-400'}>{clipCol(v)}</span>
        </Tooltip>
      ),
    },
    { title: '出现', dataIndex: 'occurrenceCount', width: 60, align: 'center' },
    { title: '工单', dataIndex: 'ticketCount', width: 60, align: 'center' },
    {
      title: '最近出现',
      dataIndex: 'lastSeenAt',
      width: 100,
      render: (v) => (v ? v.slice(0, 10) : '—'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => <Tag color={STATUS_TAG_COLOR[v]}>{GENERALIZATION_ISSUE_STATUS_LABELS[v] || v}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} onClick={(e) => e.stopPropagation()}>
          <Button size="small" type="link" onClick={() => void openDetail(record)}>
            详情
          </Button>
          {canEdit ? (
            <Popconfirm
              title="删除该举一反三问题及其全部关联证据？"
              okText="删除"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDeleteIssue(record)}
            >
              <Button size="small" type="link" danger>
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ])

  return (
    <div className="space-y-4">
      {contextHolder}
      <div className="page-card-sm page-section-sm space-y-4">
        <div className="flex flex-wrap items-center gap-1">
          <Typography.Text type="secondary" className="text-xs">
            举一反三：把<span className="font-medium">同类问题</span>（在多个场景或多个产品反复出现、原因可改进）的工单沉淀为问题库，一次排查、处处预防。
          </Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            三轨分工——留观=不紧迫先观察；举措=当下就处理；举一反三=同类问题系统性排查（举措可在详情中「升级为举一反三」）。
          </Typography.Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input.Search
            allowClear
            placeholder="搜索问题标题或描述"
            className="!w-56"
            onSearch={(v) => {
              setPage(1)
              setFilters((f) => ({ ...f, keyword: v }))
            }}
          />
          <Select
            className="!w-32"
            value={filters.status || undefined}
            allowClear
            placeholder="状态"
            options={Object.entries(GENERALIZATION_ISSUE_STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
            onChange={(v) => {
              setPage(1)
              setFilters((f) => ({ ...f, status: v || '' }))
            }}
          />
          <Select
            className="!w-36"
            value={filters.category || undefined}
            allowClear
            placeholder="范畴"
            options={GENERALIZATION_CATEGORIES.map((c) => ({ value: c, label: GENERALIZATION_CATEGORY_LABELS[c] }))}
            onChange={(v) => {
              setPage(1)
              setFilters((f) => ({ ...f, category: v || '' }))
            }}
          />
          <Select
            className="!w-32"
            value={filters.scope || undefined}
            allowClear
            placeholder="共性范围"
            options={GENERALIZATION_SCOPES.map((s) => ({ value: s, label: GENERALIZATION_SCOPE_LABELS[s] }))}
            onChange={(v) => {
              setPage(1)
              setFilters((f) => ({ ...f, scope: v || '' }))
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            刷新
          </Button>
          <Dropdown
            menu={{
              items: [
                { key: 'filtered', label: '导出当前筛选' },
                { key: 'all', label: '导出全部' },
              ],
              onClick: ({ key }) => void handleExport(/** @type {'all' | 'filtered'} */ (key)),
            }}
          >
            <Button icon={<DownloadOutlined />} loading={exporting}>
              导出
            </Button>
          </Dropdown>
          <Typography.Text type="secondary" className="text-xs">
            共 {total} 个举一反三问题
          </Typography.Text>
        </div>

        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={issues}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            onChange: (p) => setPage(p),
          }}
          locale={{
            emptyText:
              total === 0 && !loading
                ? '暂无举一反三问题。在工单详情的「举一反三」卡点「纳入举一反三」，或在举措详情点「升级为举一反三」即可创建。'
                : '没有匹配的举一反三问题，试试调整筛选条件。',
          }}
          expandable={{
            expandedRowKeys: expandedIssueId ? [expandedIssueId] : [],
            onExpand: (expanded, record) => setExpandedIssueId(expanded ? record.id : null),
            expandedRowRender: () => (
              <div className="space-y-2 py-1">
                {renderExpandedDetail({
                  loading: linksLoading,
                  links: issueLinks,
                  ticketLinks,
                  ratingLinks,
                  pendingLinks,
                  canEdit,
                  onReview: handleReviewPending,
                  onDetach: handleDetachFromExpanded,
                  onOpenRecord,
                })}
              </div>
            ),
          }}
        />
      </div>

      {/* 下段：待复核队列（pending_suggest 反向集中视图） */}
      <GeneralizationMatchQueue
        onOpenRecord={
          onOpenRecord
            ? (recordId, dataSourceType) =>
                void onOpenRecord({ recordId, recordDataSource: dataSourceType })
            : undefined
        }
      />

      {/* 详情侧滑：本体编辑（root_cause/optimization 唯一编辑入口）+ 来源举措 + 证据历史 */}
      {/* 详情侧滑：抽出为 GeneralizationDetailDrawer（11-04 双宿主复用——Tab 清单/展开行 + 举措抽屉叠加） */}
      <GeneralizationDetailDrawer
        issueId={detailIssueId}
        open={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        onSaved={() => void reload()}
        onOpenRecord={onOpenRecord}
      />
    </div>
  )
}

/**
 * 展开行内容：pending 三选一 + 证据列表（match_reason/excerpt 列——v3.3 ⑦）。
 */
function renderExpandedDetail({ loading, links, ticketLinks, ratingLinks, pendingLinks, canEdit, onReview, onDetach, onOpenRecord }) {
  if (loading) return <Typography.Text type="secondary">证据加载中…</Typography.Text>
  if (!links.length) return <Typography.Text type="secondary">暂无证据</Typography.Text>

  const renderLinkRow = (link) => (
    <div
      key={link.id}
      className="flex items-center justify-between gap-2 rounded-md border border-ink-100 p-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {link.ticketId ? (
            onOpenRecord ? (
              <Button size="small" type="link" className="!px-0" onClick={() => onOpenRecord(link)}>
                {link.ticketId}
              </Button>
            ) : (
              <Typography.Text className="text-xs">{link.ticketId}</Typography.Text>
            )
          ) : null}
          <Typography.Text type="secondary" className="text-xs">
            {DATA_SOURCE_LABELS[link.recordDataSource] || ''}
          </Typography.Text>
          {link.matchConfidence ? (
            <Tag color={CONFIDENCE_TAG_COLOR[link.matchConfidence]} className="!m-0">
              {link.matchConfidence}
            </Tag>
          ) : null}
        </div>
        {link.matchedExcerpt ? (
          <Typography.Text className="mt-0.5 block truncate text-xs">
            {link.matchedExcerpt}
          </Typography.Text>
        ) : null}
        {link.matchReason ? (
          <Typography.Text type="secondary" className="mt-0.5 block truncate text-xs">
            理由：{link.matchReason}
          </Typography.Text>
        ) : null}
      </div>
      {canEdit && link.linkStatus === 'confirmed' ? (
        <Button size="small" type="link" danger onClick={() => void onDetach(link)}>
          解除
        </Button>
      ) : null}
    </div>
  )

  return (
    <>
      {pendingLinks.length ? (
        <div>
          <Typography.Text type="secondary" className="mb-1 block text-xs">
            待复核建议（{pendingLinks.length}）
          </Typography.Text>
          {pendingLinks.map((link) => (
            <div key={link.id} className="mb-1.5 rounded-md border border-amber-200 bg-amber-50/60 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {link.matchConfidence ? (
                  <Tag color={CONFIDENCE_TAG_COLOR[link.matchConfidence]} className="!m-0">
                    {link.matchConfidence}
                  </Tag>
                ) : null}
                <Typography.Text className="text-xs">{link.matchedExcerpt || '—'}</Typography.Text>
              </div>
              {link.matchReason ? (
                <Typography.Text type="secondary" className="mt-0.5 block text-xs">
                  理由：{link.matchReason}
                </Typography.Text>
              ) : null}
              <Space size="small" className="mt-1.5">
                <Button size="small" type="primary" onClick={() => void onReview(link, 'confirm')}>
                  确认关联
                </Button>
                <Button size="small" onClick={() => void onReview(link, 'dismiss')}>
                  不纳入
                </Button>
              </Space>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <Typography.Text type="secondary" className="mb-1 block text-xs">
          工单证据（{ticketLinks.length}）
        </Typography.Text>
        <div className="space-y-1.5">
          {ticketLinks.length ? (
            ticketLinks.map(renderLinkRow)
          ) : (
            <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
          )}
        </div>
      </div>

      <div>
        <Typography.Text type="secondary" className="mb-1 block text-xs">
          评价证据（{ratingLinks.length}）
        </Typography.Text>
        <div className="space-y-1.5">
          {ratingLinks.length ? (
            ratingLinks.map(renderLinkRow)
          ) : (
            <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
          )}
        </div>
      </div>
    </>
  )
}
