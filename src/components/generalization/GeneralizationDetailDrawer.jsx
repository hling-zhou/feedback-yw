import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Drawer as AntDrawer,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  getGeneralizationIssue,
  updateGeneralizationIssue,
  detachGeneralizationLink,
  searchGeneralizationRecords,
  attachGeneralizationLink,
} from '../../lib/generalizationClient.js'
import {
  GENERALIZATION_ISSUE_STATUS_LABELS,
  GENERALIZATION_LINK_STATUS_LABELS,
  GENERALIZATION_LINK_SOURCE_LABELS,
  GENERALIZATION_CATEGORIES,
  GENERALIZATION_CATEGORY_LABELS,
  GENERALIZATION_SCOPES,
  GENERALIZATION_SCOPE_LABELS,
  GENERALIZATION_SUMMARY_MAX_LENGTH,
} from '../../domain/generalizationIssue.js'
import { useAuth } from '../../context/AuthContext.jsx'
import FieldLabel from '../FieldLabel.jsx'
import { useNavigate } from 'react-router-dom'

/** @typedef {import('../../domain/generalizationIssue.js').GeneralizationIssue} GeneralizationIssue */
/** @typedef {import('../../domain/generalizationIssue.js').GeneralizationIssueLink} GeneralizationIssueLink */

const STATUS_TAG_COLOR = {
  in_progress: 'processing',
  completed: 'success',
  terminated: 'default',
}

const DATA_SOURCE_LABELS = {
  complaint_ticket: '投诉工单',
  consultation_ticket: '咨询工单',
  post_use_rating: '用后即评',
}

/**
 * 举一反三详情抽屉（2026-11-04 从 GeneralizationTab 抽出——双宿主复用）：
 * - 举一反三 Tab（清单点标题 / 展开行）；
 * - 举措详情抽屉「已升级」列表（叠加打开——2026-11-04 用户拍板：抽屉一律叠加不跳转，
 *   zIndex 1020 盖过举措抽屉 1010 与工单抽屉 1000/1010 层级，关闭后宿主仍在）。
 *
 * 内容：本体编辑（root_cause/optimization 唯一编辑入口）+ 来源举措 + 证据与匹配历史
 * + 关闭备注弹窗 + 添加证据弹窗。全部状态自包含，宿主只传 issueId/open/onClose/onSaved。
 *
 * @param {Object} props
 * @param {string | null} props.issueId - 要打开的举一反三问题 id（null = 关闭态）
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {() => void} [props.onSaved] - 保存/删除/解除/挂证据后通知宿主刷新清单
 * @param {(link: { recordId?: string, recordDataSource?: string, ticketId?: string }) => void} [props.onOpenRecord]
 *   - 证据工单号点击 → 宿主开工单详情抽屉（叠加语义：本抽屉仍在其下）
 */
export default function GeneralizationDetailDrawer({
  issueId,
  open,
  onClose,
  onSaved,
  onOpenRecord,
}) {
  const { can } = useAuth()
  const canEdit = can('editRecord')
  const navigate = useNavigate()
  const [messageApi, contextHolder] = message.useMessage()

  const [detailIssue, setDetailIssue] = useState(/** @type {GeneralizationIssue | null} */ (null))
  const [detailLinks, setDetailLinks] = useState(/** @type {GeneralizationIssueLink[]} */ ([]))
  const [detailActionRefs, setDetailActionRefs] = useState(/** @type {any[]} */ ([]))
  const [savingDetail, setSavingDetail] = useState(false)
  const [editForm, setEditForm] = useState({
    title: '', summary: '', category: '', scope: '',
    rootCause: '', optimization: '', keywords: '', notes: '', status: '',
  })

  // 关闭弹窗（v3.3 ⑪：状态变更为终态时弹备注，可空保存）
  const [closeModalOpen, setCloseModalOpen] = useState(false)
  const [closeNote, setCloseNote] = useState('')
  const [closeTargetStatus, setCloseTargetStatus] = useState(/** @type {string | null} */ (null))

  // 添加证据弹窗（S1/S3 人工兜底）
  const [addEvidenceOpen, setAddEvidenceOpen] = useState(false)
  const [evidenceSelected, setEvidenceSelected] = useState(null)
  const [evidenceOptions, setEvidenceOptions] = useState(/** @type {any[]} */ ([]))
  const [evidenceSearching, setEvidenceSearching] = useState(false)
  const [overrideDismissed, setOverrideDismissed] = useState(false)

  /** 打开时按 issueId 拉全量详情（本体 + links + actionRefs）并初始化编辑表单 */
  const loadDetail = useCallback(async (id) => {
    try {
      const detail = await getGeneralizationIssue(id)
      if (!detail.issue) {
        setDetailIssue(null)
        return
      }
      setDetailIssue(detail.issue)
      setDetailLinks(detail.links)
      setDetailActionRefs(detail.actionRefs || [])
      setEditForm({
        title: detail.issue.title,
        summary: detail.issue.summary,
        category: detail.issue.category,
        scope: detail.issue.scope,
        rootCause: detail.issue.rootCause || '',
        optimization: detail.issue.optimization || '',
        keywords: (detail.issue.payload?.keywords || []).join('、'),
        notes: detail.issue.payload?.notes || '',
        status: detail.issue.status,
      })
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '加载举一反三详情失败')
      setDetailIssue(null)
    }
  }, [messageApi])

  useEffect(() => {
    if (open && issueId) void loadDetail(issueId)
    if (!open) {
      // 关闭时清状态（下次打开重拉——数据新鲜度优先）
      setDetailIssue(null)
      setDetailLinks([])
      setDetailActionRefs([])
      setAddEvidenceOpen(false)
      setCloseModalOpen(false)
    }
  }, [open, issueId, loadDetail])

  /**
   * 保存详情（root_cause/optimization 唯一编辑入口——空值禁保存，前端校验 + 后端 400 双保险）。
   * 状态变更到 completed/terminated 时先弹关闭备注弹窗（v3.3 ⑪）。
   */
  const handleSaveDetail = async (nextStatus, closeNoteText) => {
    if (!detailIssue) return
    const trimmedRoot = String(editForm.rootCause || '').trim()
    const trimmedOpt = String(editForm.optimization || '').trim()
    // v3.4：编辑保存时两字段必填（创建时可空）
    if (!trimmedRoot || !trimmedOpt) {
      messageApi.warning('根因分析与优化方案为必填项（创建时可空，编辑时需补全后保存）')
      return
    }
    setSavingDetail(true)
    try {
      const { issue } = await updateGeneralizationIssue(detailIssue.id, {
        title: editForm.title.trim() || undefined,
        summary: editForm.summary.trim() || undefined,
        category: /** @type {any} */ (editForm.category || undefined),
        scope: /** @type {any} */ (editForm.scope || undefined),
        rootCause: trimmedRoot,
        optimization: trimmedOpt,
        keywords: editForm.keywords
          ? editForm.keywords.split(/[,，、\s]+/).map((k) => k.trim()).filter(Boolean)
          : [],
        notes: closeNoteText || editForm.notes || '',
        status: /** @type {any} */ (nextStatus || editForm.status),
      })
      messageApi.success('已保存')
      setDetailIssue(issue)
      onClose()
      setCloseTargetStatus(null)
      setCloseNote('')
      onSaved?.()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSavingDetail(false)
    }
  }

  /** 状态选择变更：终态时弹关闭备注弹窗（可空保存） */
  const handleStatusChange = (status) => {
    if (status === 'completed' || status === 'terminated') {
      setCloseTargetStatus(status)
      setCloseNote('')
      setCloseModalOpen(true)
      return
    }
    setEditForm((f) => ({ ...f, status }))
  }

  /** 证据区就地刷新（解除/挂载后保持本抽屉数据新鲜） */
  const refreshLinks = async () => {
    if (!detailIssue) return
    const detail = await getGeneralizationIssue(detailIssue.id)
    setDetailLinks(detail.links)
    setDetailIssue(detail.issue)
    onSaved?.()
  }

  const handleEvidenceSearch = async (text) => {
    const q = String(text || '').trim()
    if (!q) return
    setEvidenceSearching(true)
    try {
      const { records } = await searchGeneralizationRecords({
        query: q,
        productKey: detailIssue?.productKey || undefined,
        limit: 20,
      })
      setEvidenceOptions(
        records.map((r) => ({
          value: r.recordId,
          label: `${r.ticketId || '无工单号'} · ${r.productName || ''} · ${r.summary.slice(0, 30)}`,
          record: r,
        })),
      )
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '搜索失败')
    } finally {
      setEvidenceSearching(false)
    }
  }

  const handleAttachEvidence = async () => {
    if (!detailIssue || !evidenceSelected) return
    const opt = evidenceOptions.find((o) => o.value === evidenceSelected)
    if (!opt) return
    try {
      await attachGeneralizationLink(detailIssue.id, {
        recordId: opt.value,
        recordDataSource: opt.record.dataSourceType || 'complaint_ticket',
        ticketId: opt.record.ticketId || undefined,
        overrideDismissed,
      })
      messageApi.success('已添加证据')
      setAddEvidenceOpen(false)
      setEvidenceSelected(null)
      setOverrideDismissed(false)
      await refreshLinks()
    } catch (err) {
      const text = err instanceof Error ? err.message : '添加失败'
      if (text.includes('此前被否决')) {
        messageApi.warning(text)
      } else if (text.includes('已存在关联')) {
        messageApi.warning('该记录与此问题已存在关联')
      } else {
        messageApi.error(text)
      }
    }
  }

  return (
    <>
      {contextHolder}
      <AntDrawer
        open={open && Boolean(detailIssue)}
        width={720}
        zIndex={1020}
        title={
          detailIssue ? (
            <div className="flex w-full min-w-0 flex-col gap-1 pr-6">
              <span className="text-base font-semibold leading-none">举一反三问题</span>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Typography.Text className="min-w-0 truncate text-xs" ellipsis={{ tooltip: detailIssue.title }}>
                  {detailIssue.title}
                </Typography.Text>
                <Tag color={STATUS_TAG_COLOR[detailIssue.status]}>
                  {GENERALIZATION_ISSUE_STATUS_LABELS[detailIssue.status] || detailIssue.status}
                </Tag>
                <Typography.Text type="secondary" className="text-xs">
                  出现 {detailIssue.occurrenceCount ?? '—'} 次
                </Typography.Text>
              </div>
            </div>
          ) : (
            <span>举一反三问题</span>
          )
        }
        onClose={onClose}
        styles={{ section: { overflow: 'hidden' }, body: { overflowX: 'hidden', overflowY: 'auto' } }}
        footer={
          canEdit ? (
            <Space className="w-full justify-end">
              <Button onClick={onClose}>取消</Button>
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
                  <div className="space-y-3">
                    <div>
                      <FieldLabel required>问题标题</FieldLabel>
                      <Input
                        value={editForm.title}
                        maxLength={GENERALIZATION_SUMMARY_MAX_LENGTH}
                        onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                      />
                    </div>
                    <div>
                      <FieldLabel required>问题描述</FieldLabel>
                      <Input.TextArea
                        rows={2}
                        value={editForm.summary}
                        maxLength={GENERALIZATION_SUMMARY_MAX_LENGTH}
                        showCount
                        onChange={(e) => setEditForm((f) => ({ ...f, summary: e.target.value }))}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <FieldLabel required>可介入原因范畴</FieldLabel>
                        <Select
                          className="!w-full"
                          value={editForm.category}
                          options={GENERALIZATION_CATEGORIES.map((c) => ({
                            value: c,
                            label: GENERALIZATION_CATEGORY_LABELS[c],
                          }))}
                          onChange={(v) => setEditForm((f) => ({ ...f, category: v }))}
                        />
                      </div>
                      <div>
                        <FieldLabel required>共性范围</FieldLabel>
                        <Radio.Group
                          value={editForm.scope}
                          onChange={(e) => setEditForm((f) => ({ ...f, scope: e.target.value }))}
                          options={GENERALIZATION_SCOPES.map((s) => ({
                            value: s,
                            label: GENERALIZATION_SCOPE_LABELS[s],
                          }))}
                        />
                      </div>
                    </div>
                    <div>
                      <FieldLabel required hint="创建时可空，编辑保存时必填">
                        根因分析
                      </FieldLabel>
                      <Input.TextArea
                        rows={3}
                        maxLength={2000}
                        showCount
                        value={editForm.rootCause}
                        placeholder="问题根因结论，如「批量接口事务未包裹，部分失败未回滚」"
                        onChange={(e) => setEditForm((f) => ({ ...f, rootCause: e.target.value }))}
                      />
                    </div>
                    <div>
                      <FieldLabel required hint="创建时可空，编辑保存时必填">
                        优化方案
                      </FieldLabel>
                      <Input.TextArea
                        rows={3}
                        maxLength={2000}
                        showCount
                        value={editForm.optimization}
                        placeholder="排查后的优化方案，如「包裹事务并对部分失败回滚」"
                        onChange={(e) => setEditForm((f) => ({ ...f, optimization: e.target.value }))}
                      />
                    </div>
                    <div>
                      <FieldLabel hint="顿号或逗号分隔，供自动召回">关键词</FieldLabel>
                      <Input
                        value={editForm.keywords}
                        maxLength={200}
                        onChange={(e) => setEditForm((f) => ({ ...f, keywords: e.target.value }))}
                      />
                    </div>
                    <div>
                      <FieldLabel hint="关闭问题时可记录复盘">备注</FieldLabel>
                      <Input.TextArea
                        rows={2}
                        maxLength={2000}
                        value={editForm.notes}
                        onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                    </div>
                    <div>
                      <FieldLabel>状态</FieldLabel>
                      <Select
                        className="!w-40"
                        value={editForm.status}
                        options={Object.entries(GENERALIZATION_ISSUE_STATUS_LABELS).map(
                          ([value, label]) => ({ value, label }),
                        )}
                        onChange={handleStatusChange}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {[
                      { key: 'title', label: '问题标题', value: detailIssue.title || '—' },
                      { key: 'summary', label: '问题描述', value: detailIssue.summary || '—' },
                      { key: 'status', label: '状态', value: GENERALIZATION_ISSUE_STATUS_LABELS[detailIssue.status] || detailIssue.status },
                      { key: 'rootCause', label: '根因分析', value: detailIssue.rootCause || '—' },
                      { key: 'optimization', label: '优化方案', value: detailIssue.optimization || '—' },
                      { key: 'keywords', label: '关键词', value: (detailIssue.payload?.keywords || []).join('、') || '—' },
                      { key: 'notes', label: '备注', value: detailIssue.payload?.notes || '—' },
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

            {/* 来源举措（中间表反查——v3.1/v3.3；删除降级） */}
            {detailActionRefs.length ? (
              <div className="drawer-section-gap">
                <div className="section-title">来源举措</div>
                <div className="page-card-sm space-y-1.5">
                  {detailActionRefs.map((ref) => (
                    <div
                      key={ref.actionItemId}
                      className="flex items-center justify-between gap-2 rounded-md border border-ink-100 p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Tag className="!m-0">{ref.kind === 'created' ? '升级新建' : '升级关联'}</Tag>
                          {ref.actionExists ? (
                            <Typography.Text className="min-w-0 truncate text-[13px]">
                              {ref.actionTitle || '（无标题）'}
                            </Typography.Text>
                          ) : (
                            <Typography.Text type="secondary" className="text-[13px]">
                              来源举措已删除
                            </Typography.Text>
                          )}
                        </div>
                        {ref.actionExists && ref.actionStatus ? (
                          <Typography.Text type="secondary" className="text-xs">
                            举措状态：{ref.actionStatus} · {ref.actionProductName || ''}
                          </Typography.Text>
                        ) : null}
                      </div>
                      {ref.actionExists ? (
                        <Button
                          size="small"
                          type="link"
                          onClick={() => navigate(`/actions?tab=product&actionItemId=${encodeURIComponent(ref.actionItemId)}`)}
                        >
                          前往举措
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 证据与匹配历史 */}
            <div className="drawer-section-gap">
              <div className="section-title">证据与匹配历史</div>
              <div className="page-card-sm">
                <div className="mb-2 flex items-center justify-between">
                  <Typography.Text type="secondary" className="text-xs">
                    含已否决的匹配记录 · 点击工单号可跳转对应详情
                  </Typography.Text>
                  {canEdit ? (
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setEvidenceSelected(null)
                        setOverrideDismissed(false)
                        setAddEvidenceOpen(true)
                      }}
                    >
                      添加证据
                    </Button>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  {detailLinks.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-ink-100 p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Tag>{GENERALIZATION_LINK_STATUS_LABELS[link.linkStatus] || link.linkStatus}</Tag>
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
                            {GENERALIZATION_LINK_SOURCE_LABELS[link.linkSource] || ''} · {link.matchReason}
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
                              await detachGeneralizationLink(link.issueId, link.id)
                              messageApi.success('已解除关联')
                              await refreshLinks()
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

      {/* 关闭弹窗（v3.3 ⑪：终态备注，可空保存） */}
      <Modal
        open={closeModalOpen}
        title={`标记为「${closeTargetStatus === 'completed' ? '已完成' : '未完成终止'}」`}
        onCancel={() => setCloseModalOpen(false)}
        onOk={() => {
          setCloseModalOpen(false)
          void handleSaveDetail(closeTargetStatus || undefined, closeNote.trim() || undefined)
        }}
        okText="确认"
      >
        <div className="space-y-3">
          <Typography.Text type="secondary" className="block text-xs">
            备注（可选）：记录排查结论或终止原因，将写入问题备注。
          </Typography.Text>
          <Input.TextArea
            rows={3}
            maxLength={500}
            value={closeNote}
            placeholder="如：已全量排查同类接口并修复，验证通过"
            onChange={(e) => setCloseNote(e.target.value)}
          />
        </div>
      </Modal>

      {/* 添加证据弹窗（S1/S3 人工兜底） */}
      <Modal
        open={addEvidenceOpen}
        title="添加证据（搜投诉/咨询工单）"
        onCancel={() => setAddEvidenceOpen(false)}
        onOk={() => void handleAttachEvidence()}
        okText="添加"
      >
        <div className="space-y-3">
          <Typography.Text type="secondary" className="block text-xs">
            按 recordId 关联；同记录此前被否决过时勾选「覆盖否决」。
          </Typography.Text>
          <Select
            showSearch
            filterOption={false}
            className="!w-full"
            placeholder="输入关键词搜索工单"
            value={evidenceSelected}
            onSearch={(v) => void handleEvidenceSearch(v)}
            onChange={setEvidenceSelected}
            options={evidenceOptions}
            loading={evidenceSearching}
            notFoundContent={evidenceSearching ? '搜索中…' : '输入关键词搜索'}
            allowClear
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={overrideDismissed}
              onChange={(e) => setOverrideDismissed(e.target.checked)}
            />
            覆盖否决（该记录此前被人工否决过仍强制关联）
          </label>
        </div>
      </Modal>
    </>
  )
}
