import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Drawer as AntDrawer,
  Dropdown,
  Tooltip,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import {
  listObservationIssues,
  promoteObservationIssue,
  getObservationIssue,
  updateObservationIssue,
  deleteObservationIssue,
  detachObservationLink,
  reviewObservationMatch,
} from '../../lib/observationClient.js'
import {
  OBSERVATION_ISSUE_STATUS_LABELS,
  OBSERVATION_LINK_STATUS_LABELS,
  OBSERVATION_LINK_SOURCE_LABELS,
  OBSERVATION_SUMMARY_MAX_LENGTH,
} from '../../domain/observationIssue.js'
import { DEFAULT_OBSERVATION_PROMOTION_THRESHOLD } from '../../lib/storage.js'
import { suggestObservationKeywords } from '../../lib/observation/keywordSuggest.js'
import {
  buildObservationIssuesCsv,
  downloadObservationCsv,
} from '../../lib/observation/observationExportCsv.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useFeedbacks } from '../../context/FeedbackContext.jsx'

/** @typedef {import('../../domain/observationIssue.js').ObservationIssue} ObservationIssue */
/** @typedef {import('../../domain/observationIssue.js').ObservationIssueLink} ObservationIssueLink */

const STATUS_TAG_COLOR = {
  watching: 'processing',
  promoted: 'purple',
  archived: 'default',
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

const SOURCE_MIX_LABELS = {
  all: '全部',
  has_ticket: '含工单证据',
  rating_only: '仅评价证据',
}

/**
 * 留观问题 Tab（/actions?tab=observation）：上段清单 + 下段待复核队列。
 * 展开行 = 快速读证据；详情侧滑 = 维护问题本体（两入口设计）。
 *
 * @param {Object} props
 * @param {(link: { recordId?: string, recordDataSource?: string, ticketId?: string }) => void | Promise<void>} [props.onOpenRecord] - 跳转记录 drawer（由 Tab 宿主注入，反馈库联动）
 */
export default function ObservationTab({ onOpenRecord }) {
  const { can } = useAuth()
  const canEdit = can('editRecord')
  const navigate = useNavigate()
  const { settings } = useFeedbacks()
  const [promotingId, setPromotingId] = useState(null)
  const [exporting, setExporting] = useState(false)

  const handleExport = async (scope) => {
    setExporting(true)
    try {
      const result = await listObservationIssues({
        ...(scope === 'filtered'
          ? {
              keyword: filters.keyword || undefined,
              status: filters.status || undefined,
              sourceMix: filters.sourceMix,
            }
          : {}),
        page: 1,
        pageSize: 100,
      })
      // 分页取全（pageSize 上限 100）：循环取完
      /** @type {typeof result.issues} */
      let allIssues = result.issues
      const totalPages = Math.ceil(result.total / result.pageSize)
      for (let p = 2; p <= totalPages; p += 1) {
        const next = await listObservationIssues({
          ...(scope === 'filtered'
            ? {
                keyword: filters.keyword || undefined,
                status: filters.status || undefined,
                sourceMix: filters.sourceMix,
              }
            : {}),
          page: p,
          pageSize: 100,
        })
        allIssues = allIssues.concat(next.issues)
      }
      // 证据明细：逐 issue 拉 links（cap 内）
      const capped = allIssues.slice(0, 5000)
      const linksByIssue = []
      for (const issue of capped) {
        const detail = await getObservationIssue(issue.id)
        linksByIssue.push({ issueId: issue.id, links: detail.links })
      }
      const { csv, rowCount, truncated } = buildObservationIssuesCsv({
        issues: capped,
        linksByIssue,
      })
      const datePart = new Date().toISOString().slice(0, 10)
      const scopePart = scope === 'filtered' ? '当前筛选' : '全部'
      downloadObservationCsv(csv, `留观问题-${scopePart}-${datePart}.csv`)
      messageApi.success(`已导出 ${rowCount} 条留观问题${truncated ? '（超出上限已截断）' : ''}`)
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const handlePromote = async (issue) => {
    setPromotingId(issue.id)
    try {
      const res = await promoteObservationIssue(issue.id)
      messageApi.success(`已升级为举措（待评估），可前往「问题与举措 · 产品举措与进展」跟进`)
      await reload()
      void res.actionItemId
    } catch (err) {
      const text = err instanceof Error ? err.message : '升级失败'
      if (text.includes('不能重复升级')) messageApi.warning(text)
      else messageApi.error(text)
    } finally {
      setPromotingId(null)
    }
  }
  const promotionThreshold =
    typeof settings?.observationPromotionThreshold === 'number'
      ? settings.observationPromotionThreshold
      : DEFAULT_OBSERVATION_PROMOTION_THRESHOLD
  const [messageApi, contextHolder] = message.useMessage()

  const [issues, setIssues] = useState(/** @type {(ObservationIssue & { ticketCount: number, ratingCount: number })[]} */ ([]))
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ keyword: '', status: '', sourceMix: 'all' })

  // 展开行状态（快速读证据）
  const [expandedIssueId, setExpandedIssueId] = useState(null)
  const [issueLinks, setIssueLinks] = useState(/** @type {ObservationIssueLink[]} */ ([]))
  const [linksLoading, setLinksLoading] = useState(false)

  // 详情侧滑状态（维护本体）
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailIssue, setDetailIssue] = useState(/** @type {ObservationIssue | null} */ (null))
  const [detailLinks, setDetailLinks] = useState(/** @type {ObservationIssueLink[]} */ ([]))
  const [detailForm] = Form.useForm()
  const [savingDetail, setSavingDetail] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listObservationIssues({
        page,
        pageSize,
        keyword: filters.keyword || undefined,
        status: filters.status || undefined,
        sourceMix: filters.sourceMix,
      })
      setIssues(result.issues)
      setTotal(result.total)
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '加载留观问题失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filters, messageApi])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadLinksFor = useCallback(async (issueId) => {
    setLinksLoading(true)
    try {
      const { links } = await getObservationIssue(issueId)
      setIssueLinks(links)
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
      await reviewObservationMatch(link.id, action)
      messageApi.success(action === 'confirm' ? '已确认关联' : '已否决建议')
      if (expandedIssueId) await loadLinksFor(expandedIssueId)
      await reload()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  const handleDetachFromExpanded = async (link) => {
    try {
      await detachObservationLink(link.issueId, link.id)
      messageApi.success('已解除关联')
      if (expandedIssueId) await loadLinksFor(expandedIssueId)
      await reload()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '解除失败')
    }
  }

  const keywordSuggestions = useMemo(() => {
    if (!detailIssue) return []
    return suggestObservationKeywords({
      summary: detailIssue.summary || detailIssue.title,
      existingKeywords: detailIssue.payload?.keywords || [],
      limit: 4,
    })
  }, [detailIssue])

  const adoptKeyword = (kw) => {
    const cur = String(detailForm.getFieldValue('keywords') || '').trim()
    const parts = cur ? cur.split(/[,，、\s]+/).filter(Boolean) : []
    if (parts.includes(kw)) return
    detailForm.setFieldsValue({ keywords: [...parts, kw].join('、') })
  }

  const openDetail = async (issue) => {
    setDetailIssue(issue)
    setDetailOpen(true)
    detailForm.setFieldsValue({
      title: issue.title,
      summary: issue.summary,
      keywords: (issue.payload?.keywords || []).join('、'),
      notes: issue.payload?.notes || '',
      status: issue.status,
    })
    try {
      const { links } = await getObservationIssue(issue.id)
      setDetailLinks(links)
    } catch {
      setDetailLinks([])
    }
  }

  const handleSaveDetail = async () => {
    if (!detailIssue) return
    const values = await detailForm.validateFields()
    setSavingDetail(true)
    try {
      const { issue } = await updateObservationIssue(detailIssue.id, {
        title: values.title,
        summary: values.summary,
        keywords: values.keywords
          ? values.keywords.split(/[,，、\s]+/).map((k) => k.trim()).filter(Boolean)
          : [],
        notes: values.notes || '',
        status: values.status,
      })
      messageApi.success('已保存')
      setDetailIssue(issue)
      setDetailOpen(false)
      await reload()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSavingDetail(false)
    }
  }

  const handleDeleteIssue = async (issue) => {
    try {
      await deleteObservationIssue(issue.id)
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

  const columns = [
    { title: '产品', dataIndex: 'productName', width: 140, ellipsis: true },
    { title: '问题标题', dataIndex: 'title', ellipsis: true,
      render: (v, record) => (
        <span className="inline-flex items-center gap-1.5">
          <Button type="link" size="small" className="!px-0" onClick={() => void openDetail(record)}>
            {v}
          </Button>
          {record.status === 'watching' && record.occurrenceCount >= promotionThreshold ? (
            <Tooltip title={`出现次数已达 ${record.occurrenceCount} 次（阈值 ${promotionThreshold}），建议升级为正式举措`}>
              <Tag color="orange" className="!m-0">建议升级</Tag>
            </Tooltip>
          ) : null}
        </span>
      ) },
    { title: '出现', dataIndex: 'occurrenceCount', width: 70, align: 'center' },
    { title: '工单', dataIndex: 'ticketCount', width: 60, align: 'center' },
    { title: '评价', dataIndex: 'ratingCount', width: 60, align: 'center' },
    { title: '最近出现', dataIndex: 'lastSeenAt', width: 110,
      render: (v) => (v ? v.slice(0, 10) : '—') },
    { title: '状态', dataIndex: 'status', width: 90,
      render: (v) => <Tag color={STATUS_TAG_COLOR[v]}>{OBSERVATION_ISSUE_STATUS_LABELS[v] || v}</Tag> },
    { title: '操作', key: 'actions', width: 230, fixed: 'right',
      render: (_, record) => (
        <Space size={0} onClick={(e) => e.stopPropagation()}>
          <Button size="small" type="link" onClick={() => void openDetail(record)}>
            详情
          </Button>
          {canEdit && record.status === 'watching' ? (
            <Popconfirm
              title={`升级为正式举措？将创建待评估举措（关联 ${record.occurrenceCount} 条证据），本问题转为「已升级」。`}
              okText="升级"
              onConfirm={() => void handlePromote(record)}
            >
              <Button
                size="small"
                type="link"
                loading={promotingId === record.id}
                className={record.occurrenceCount >= promotionThreshold ? 'font-medium' : undefined}
              >
                升级
              </Button>
            </Popconfirm>
          ) : null}
          {record.status === 'promoted' ? (
            <Tooltip title="已升级为举措，点击前往查看">
              <Button
                size="small"
                type="link"
                onClick={() => navigate('/actions?tab=product')}
              >
                已升级
              </Button>
            </Tooltip>
          ) : null}
          {canEdit ? (
            <Popconfirm
              title="删除该留观问题及其全部关联证据？"
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
      ) },
  ]

  return (
    <div className="space-y-4">
      {contextHolder}
      <div className="page-card-sm page-section-sm space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input.Search
          allowClear
          placeholder="搜索问题标题或描述"
          className="!w-64"
          defaultValue=""
          onSearch={(v) => { setPage(1); setFilters((f) => ({ ...f, keyword: v })) }}
        />
        <Select
          className="!w-36"
          value={filters.status || undefined}
          allowClear
          placeholder="状态"
          options={Object.entries(OBSERVATION_ISSUE_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, status: v || '' })) }}
        />
        <Select
          className="!w-36"
          value={filters.sourceMix}
          options={Object.entries(SOURCE_MIX_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, sourceMix: v || 'all' })) }}
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
            onClick: ({ key }) => void handleExport(key),
          }}
        >
          <Button icon={<DownloadOutlined />} loading={exporting}>
            导出
          </Button>
        </Dropdown>
        <Typography.Text type="secondary" className="text-xs">
          共 {total} 个留观问题
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
              ? '暂无留观问题。在工单/评价详情的「留观问题」卡片点「纳入观察」，或在处理待办时选「转留观」即可创建。'
              : '没有匹配的留观问题，试试调整筛选条件。',
        }}
        expandable={{
          expandedRowKeys: expandedIssueId ? [expandedIssueId] : [],
          onExpand: (expanded, record) => setExpandedIssueId(expanded ? record.id : null),
          expandedRowRender: () => (
            <div className="space-y-2 py-1">
              {detailOfExpanded(linksLoading, issueLinks, {
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

      <AntDrawer
        open={detailOpen}
        width={720}
        title={
          detailIssue ? (
            <div className="flex w-full min-w-0 flex-col gap-1 pr-6">
              <span className="text-base font-semibold leading-none">留观问题</span>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Typography.Text className="min-w-0 truncate text-xs" ellipsis={{ tooltip: detailIssue.title }}>
                  {detailIssue.title}
                </Typography.Text>
                <Tag color={STATUS_TAG_COLOR[detailIssue.status]}>
                  {OBSERVATION_ISSUE_STATUS_LABELS[detailIssue.status] || detailIssue.status}
                </Tag>
                <Typography.Text type="secondary" className="text-xs">
                  出现 {detailIssue.occurrenceCount ?? '—'} 次
                </Typography.Text>
              </div>
            </div>
          ) : (
            <span>留观问题</span>
          )
        }
        onClose={() => setDetailOpen(false)}
        styles={{
          section: { overflow: 'hidden' },
          body: { overflowX: 'hidden', overflowY: 'auto' },
        }}
        footer={
          canEdit ? (
            <Space className="w-full justify-end">
              <Button onClick={() => setDetailOpen(false)}>取消</Button>
              <Button type="primary" loading={savingDetail} onClick={() => void handleSaveDetail()}>
                保存
              </Button>
            </Space>
          ) : null
        }
      >
        {detailIssue ? (
          <div className="min-w-0 max-w-full drawer-space-y overflow-x-hidden">
            <div className="drawer-section-gap">
              <div className="section-title">问题本体</div>
              <div className="page-card-sm">
                {canEdit ? (
                <Form form={detailForm} layout="vertical">
                  <Form.Item
                    label="问题标题"
                    name="title"
                    rules={[{ required: true, message: '标题不能为空' }]}
                  >
                    <Input maxLength={OBSERVATION_SUMMARY_MAX_LENGTH} showCount />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span className="inline-flex flex-wrap items-center gap-1">
                        问题描述
                        <Tooltip title="修改后，后续自动识别将按此描述判断（自动识别新反馈的判断依据）">
                          <Typography.Text type="warning" className="cursor-help text-xs">
                            ⓘ 修改后影响自动识别
                          </Typography.Text>
                        </Tooltip>
                      </span>
                    }
                    name="summary"
                    rules={[{ required: true, message: '描述不能为空' }]}
                  >
                    <Input.TextArea rows={3} maxLength={OBSERVATION_SUMMARY_MAX_LENGTH} showCount />
                  </Form.Item>
                  <Form.Item label="关键词" name="keywords" extra="顿号或逗号分隔；供自动召回使用">
                    <Input maxLength={200} />
                  </Form.Item>
                  {canEdit && keywordSuggestions.length ? (
                <div className="-mt-2 mb-3 flex flex-wrap items-center gap-1.5">
                  <Typography.Text type="secondary" className="text-xs">
                    建议：
                  </Typography.Text>
                  {keywordSuggestions.map((kw) => (
                    <Button
                      key={kw}
                      size="small"
                      className="!h-6 !px-2 !text-xs"
                      onClick={() => adoptKeyword(kw)}
                    >
                      + {kw}
                    </Button>
                  ))}
                </div>
              ) : null}
              <Form.Item label="备注" name="notes">
                <Input.TextArea rows={2} maxLength={2000} />
              </Form.Item>
              <Form.Item label="状态" name="status">
                <Select options={Object.entries(OBSERVATION_ISSUE_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              </Form>
                ) : (
                  <div className="space-y-3">
                    {[
                      { key: 'title', label: '问题标题', value: detailIssue.title || '—' },
                      { key: 'summary', label: '问题描述', value: detailIssue.summary || '—' },
                      {
                        key: 'keywords',
                        label: '关键词',
                        value: (detailIssue.payload?.keywords || []).join('、') || '—',
                      },
                      { key: 'notes', label: '备注', value: detailIssue.payload?.notes || '—' },
                      {
                        key: 'status',
                        label: '状态',
                        value: OBSERVATION_ISSUE_STATUS_LABELS[detailIssue.status] || detailIssue.status,
                      },
                    ].map((row) => (
                      <div key={row.key}>
                        <Typography.Text type="secondary" className="mb-1 block text-xs">
                          {row.label}
                        </Typography.Text>
                        <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-[13px]">
                          {row.value}
                        </Typography.Paragraph>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 分区二：证据与匹配历史 */}
            <div className="drawer-section-gap">
              <div className="section-title">证据与匹配历史</div>
              <div className="page-card-sm">
                <Typography.Text type="secondary" className="mb-2 block text-xs">
                  含已否决的匹配记录 · 点击工单号/评价可跳转对应详情
                </Typography.Text>
                <div className="space-y-1.5">
                  {detailLinks.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-ink-100 p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Tag>{OBSERVATION_LINK_STATUS_LABELS[link.linkStatus] || link.linkStatus}</Tag>
                          {link.recordDataSource ? (
                            <Typography.Text type="secondary" className="text-xs">
                              {DATA_SOURCE_LABELS[link.recordDataSource] || link.recordDataSource}
                            </Typography.Text>
                          ) : null}
                          {link.ticketId ? (
                            onOpenRecord ? (
                              <Button
                                type="link"
                                size="small"
                                className="!h-auto !px-0 !py-0 text-[13px]"
                                onClick={() => onOpenRecord(link)}
                              >
                                {link.ticketId}
                              </Button>
                            ) : (
                              <Typography.Text className="text-[13px]">{link.ticketId}</Typography.Text>
                            )
                          ) : onOpenRecord ? (
                            <Button
                              type="link"
                              size="small"
                              className="!h-auto !px-0 !py-0 text-[13px]"
                              onClick={() => onOpenRecord(link)}
                            >
                              评价详情
                            </Button>
                          ) : null}
                        </div>
                        {link.matchedExcerpt ? (
                          <Typography.Paragraph
                            className="!mb-0 !mt-1 text-[13px]"
                            ellipsis={{ rows: 2, tooltip: link.matchedExcerpt }}
                          >
                            {link.matchedExcerpt}
                          </Typography.Paragraph>
                        ) : null}
                        {link.matchReason ? (
                          <Typography.Text type="secondary" className="mt-1 block text-xs">
                            {OBSERVATION_LINK_SOURCE_LABELS[link.linkSource] || ''} · {link.matchReason}
                          </Typography.Text>
                        ) : null}
                      </div>
                      {canEdit && link.linkStatus === 'confirmed' ? (
                        <Popconfirm
                          title="解除此证据关联？"
                          okText="解除"
                          okButtonProps={{ danger: true }}
                          onConfirm={async () => {
                            try {
                              await detachObservationLink(link.issueId, link.id)
                              messageApi.success('已解除关联')
                              const { links } = await getObservationIssue(link.issueId)
                              setDetailLinks(links)
                              await reload()
                            } catch (err) {
                              messageApi.error(err instanceof Error ? err.message : '解除失败')
                            }
                          }}
                        >
                          <Button size="small" type="link" danger>
                            解除
                          </Button>
                        </Popconfirm>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </AntDrawer>
    </div>
  )
}

/**
 * 展开行内容：描述 + 证据两小节 + pending 就地三选一。
 * 独立函数避免组件内 jsx 膨胀。
 */
function detailOfExpanded(loading, links, ctx) {
  const { ticketLinks, ratingLinks, pendingLinks, canEdit, onReview, onDetach, onOpenRecord } = ctx
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
          {ticketLinks.length ? ticketLinks.map(renderLinkRow) : (
            <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
          )}
        </div>
      </div>

      <div>
        <Typography.Text type="secondary" className="mb-1 block text-xs">
          评价证据（{ratingLinks.length}）
        </Typography.Text>
        <div className="space-y-1.5">
          {ratingLinks.length ? ratingLinks.map(renderLinkRow) : (
            <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
          )}
        </div>
      </div>
    </>
  )
}
