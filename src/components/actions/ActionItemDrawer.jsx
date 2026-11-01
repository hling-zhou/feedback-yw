import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  ACTION_ITEM_CONTENT_MAX_LENGTH,
  ACTION_ITEM_DETAIL_MAX_LENGTH,
  resolveActionItemProductDisplayName,
} from '../../domain/actionItem.js'
import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import {
  formatActionItemUpdatedAtDisplay,
  formatActionItemUpdatedByDisplay,
  formatActionItemUpdatedByLine,
} from '../../domain/actionItemRevision.js'
import { ACTION_ITEM_DRAWER_WIDTH } from '../../constants/appLayout.js'
import { resolveJourneyDisplay } from '../../domain/actionItemDisplay.js'
import ActionItemRequirementLinkFields from './ActionItemRequirementLinkFields.jsx'
import ActionItemStatusTag from '../tags/ActionItemStatusTag.jsx'
import LinkedTicketsInlineList from './LinkedTicketsInlineList.jsx'
import ActionProblemScopePanel from './ActionProblemScopePanel.jsx'
import { buildActionProblemScope } from '../../domain/actionProblemScope.js'
import { useEffect, useMemo, useState } from 'react'
import { getObservationIssue } from '../../lib/observationClient.js'

/** @typedef {import('../../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../../domain/actionItem.js').ActionItemStatus} ActionItemStatus */

/**
 * @param {{ item: ActionItem | null; productNameByKey?: Map<string, string>; requirementLinked?: boolean }} props
 */
function ActionItemDrawerTitle({ item, productNameByKey, requirementLinked }) {
  if (!item) return <span>举措详情</span>
  const product =
    resolveActionItemProductDisplayName(item, productNameByKey) || '未指定产品'
  const status = requirementLinked ? item.derivedStatus : item.status
  return (
    <div className="flex w-full min-w-0 flex-col gap-1 pr-6">
      <span className="text-base font-semibold leading-none">举措详情</span>
      <div className="flex min-w-0 items-center gap-2">
        <Typography.Text type="secondary" className="min-w-0 text-xs" ellipsis={{ tooltip: product }}>
          {product}
        </Typography.Text>
        {status ? (
          <ActionItemStatusTag status={status} />
        ) : requirementLinked ? (
          <Tag className="!m-0">待同步</Tag>
        ) : null}
      </div>
    </div>
  )
}

/**
 * @param {Object} props
 * @param {ActionItem | null} props.item
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('antd').FormInstance} props.form
 * @param {boolean} props.canEdit
 * @param {boolean} props.locked
 * @param {boolean} props.requirementLinked
 * @param {boolean} props.coreFieldsLocked
 * @param {boolean} props.scheduleDisabled
 * @param {boolean} props.scheduleRequired
 * @param {{ value: ActionItemStatus; label: string }[]} props.statusOptions
 * @param {false | 'own_task' | 'other'} props.stale
 * @param {() => void} props.onReloadStale
 * @param {boolean} props.saving
 * @param {() => void} props.onSave
 * @param {(enabled: boolean) => void} props.onRequirementLinkModeChange
 * @param {(status: ActionItemStatus) => void} props.onStatusChange
 * @param {Map<string, import('../../lib/types.js').FeedbackRecord>} [props.feedbackByTicketId]
 * @param {(ticketId: string) => void} [props.onOpenTicket]
 * @param {Map<string, string>} [props.productNameByKey]
 * @param {string[]} [props.linkedTicketIds]
 */
export default function ActionItemDrawer({
  item,
  open,
  onClose,
  form,
  canEdit,
  locked,
  requirementLinked,
  coreFieldsLocked,
  scheduleDisabled,
  scheduleRequired,
  statusOptions,
  stale,
  onReloadStale,
  saving,
  onSave,
  onRequirementLinkModeChange,
  onStatusChange,
  feedbackByTicketId,
  onOpenTicket,
  productNameByKey,
  linkedTicketIds = [],
}) {

  // 留观证据（F-合并方案）：source=observation 的举措在分区 4 展示留观问题的分源证据
  const [observationLinks, setObservationLinks] = useState(
    /** @type {import('../../domain/observationIssue.js').ObservationIssueLink[]} */ ([]),
  )
  const observationIssueId = item?.source === 'observation' ? item.promotedFromObservation?.issueId : null
  useEffect(() => {
    let cancelled = false
    if (!observationIssueId) {
      setObservationLinks([])
      return undefined
    }
    getObservationIssue(observationIssueId)
      .then(({ links }) => {
        if (!cancelled) setObservationLinks(links || [])
      })
      .catch(() => {
        if (!cancelled) setObservationLinks([])
      })
    return () => {
      cancelled = true
    }
  }, [observationIssueId])
  const fieldsDisabled = !canEdit || locked
  const coreDisabled = !canEdit || coreFieldsLocked
  const journey = item ? resolveJourneyDisplay(item, feedbackByTicketId) : null
  const sources = item?.linkedDataSources || []
  const linkedTicketCount = new Set(linkedTicketIds.map((id) => String(id).trim()).filter(Boolean)).size
  const problemScope = useMemo(
    () => (item ? buildActionProblemScope(item, feedbackByTicketId, productNameByKey) : null),
    [item, feedbackByTicketId, productNameByKey],
  )

  return (
    <Drawer
      title={
        <ActionItemDrawerTitle
          item={item}
          productNameByKey={productNameByKey}
          requirementLinked={requirementLinked}
        />
      }
      size={ACTION_ITEM_DRAWER_WIDTH}
      open={open}
      onClose={onClose}
      closable={{ placement: 'end' }}
      destroyOnClose
      styles={{
        section: { overflow: 'hidden' },
        body: { overflowX: 'hidden', overflowY: 'auto' },
      }}
      footer={
        canEdit && !locked ? (
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={onSave}>
              保存
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button onClick={onClose}>关闭</Button>
          </div>
        )
      }
    >
      {item ? (
        <div className="min-w-0 max-w-full drawer-space-y overflow-x-hidden">
          {/* ── 分区 1：举措内容 ── */}
          <div className="drawer-section-gap">
            <div className="section-title">举措</div>
            <div className="page-card-sm">
              {/* 状态型信息由状态位承载（标题状态Tag + 表单只读 + footer 关闭），不再用 Alert；
                  关联模式的说明由子模块说明行 + 「自动同步」徽章承载 */}
              {stale === 'other' ? (
                <Alert
                  type="warning"
                  showIcon
                  message="此举措已被他人更新"
                  description={
                    <>
                      {formatActionItemUpdatedByLine(item) || '列表数据已同步为较新版本。'}{' '}
                      继续编辑可能覆盖他人修改；保存时将再次校验。
                    </>
                  }
                  action={
                    <Button size="small" onClick={onReloadStale}>
                      加载最新
                    </Button>
                  }
                />
              ) : null}
              {stale === 'own_task' ? (
                <Alert
                  type="info"
                  showIcon
                  message="此举措已被你发起的批量任务更新"
                  description="列表数据已同步为较新版本，如需基于最新内容继续编辑请加载。"
                  action={
                    <Button size="small" onClick={onReloadStale}>
                      加载最新
                    </Button>
                  }
                />
              ) : null}

              <Form form={form} layout="vertical">
                <Form.Item
                  name="content"
                  label="举措内容"
                  rules={[
                    { required: true, message: '请输入举措内容' },
                    {
                      max: ACTION_ITEM_CONTENT_MAX_LENGTH,
                      message: `不超过 ${ACTION_ITEM_CONTENT_MAX_LENGTH} 字`,
                    },
                  ]}
                >
                  <Input.TextArea
                    rows={4}
                    showCount
                    maxLength={ACTION_ITEM_CONTENT_MAX_LENGTH}
                    disabled={coreDisabled}
                  />
                </Form.Item>
                <Form.Item
                  name="detail"
                  label="举措详情（可选）"
                  rules={[
                    {
                      max: ACTION_ITEM_DETAIL_MAX_LENGTH,
                      message: `不超过 ${ACTION_ITEM_DETAIL_MAX_LENGTH} 字`,
                    },
                  ]}
                >
                  <Input.TextArea
                    rows={5}
                    showCount
                    maxLength={ACTION_ITEM_DETAIL_MAX_LENGTH}
                    disabled={fieldsDisabled}
                  />
                </Form.Item>
                {!requirementLinked ? (
                  <>
                    <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                      <Select
                        options={statusOptions}
                        disabled={coreDisabled}
                        onChange={onStatusChange}
                      />
                    </Form.Item>
                    <Form.Item
                      name="scheduleAt"
                      label="排期时间"
                      dependencies={['status']}
                      rules={
                        scheduleRequired
                          ? [{ required: true, message: '进行中须填写排期时间' }]
                          : []
                      }
                    >
                      <DatePicker
                        className="w-full"
                        format="YYYY-MM-DD"
                        placeholder={
                          scheduleDisabled && !locked
                            ? '当前状态无需排期'
                            : scheduleRequired
                              ? '请选择排期（必填）'
                              : undefined
                        }
                        allowClear
                        disabled={scheduleDisabled || !canEdit}
                      />
                    </Form.Item>
                  </>
                ) : null}
                <ActionItemRequirementLinkFields
                  form={form}
                  disabled={fieldsDisabled}
                  initialTicketDetails={item.requirementTickets}
                  onLinkModeChange={onRequirementLinkModeChange}
                />
              </Form>
            </div>
          </div>

          {/* ── 分区 2：洞察（瘦身后仅立项依据；恢复验证移入分区五效果验证） ── */}
          {(item.insightTheme || item.linkedInsightIds?.length || item.evidenceRecordIds?.length || item.triggerMetric) ? (
            <div className="drawer-section-gap">
              <div className="section-title">洞察</div>
              <div className="page-card-sm">
                <div className="space-y-3">
                  <Space size={[6, 6]} wrap>
                    {item.insightTheme ? <Tag color="blue" className="!m-0">{item.insightTheme}</Tag> : null}
                    <Tag className="!m-0">洞察 {item.linkedInsightIds?.length || 0}</Tag>
                    <Tag className="!m-0">证据 {item.evidenceRecordIds?.length || 0}</Tag>
                  </Space>
                  {item.triggerMetric ? (
                    <Typography.Text type="secondary" className="block text-xs">
                      触发指标：{item.triggerMetric.metric || '体验指标'} · {item.triggerMetric.period || '—'} · {item.triggerMetric.value ?? '—'}{item.triggerMetric.unit || ''}
                      {item.triggerMetric.baseline != null ? ` · 目标 ${item.triggerMetric.baseline}${item.triggerMetric.unit || ''}` : ''}
                    </Typography.Text>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* ── 分区 3：关联问题 ── */}
          <div className="drawer-section-gap">
            <div className="section-title">
              关联问题{problemScope && problemScope.problems.length > 1 ? `（共 ${problemScope.problems.length} 类）` : ''}
            </div>
            <div className="page-card-sm">
              <div className="space-y-3">
                {problemScope && problemScope.problems.some((p) => p.ticketCount > 0) ? (
                  <Space direction="vertical" size={6} className="w-full">
                    {problemScope.problems
                      .filter((p) => p.ticketCount > 0)
                      .map((p) => (
                        <div key={p.key} className="sub-section-box">
                          <Space size={6} wrap>
                            <Typography.Text strong className="!text-sm">{p.productName}</Typography.Text>
                            <Typography.Text type="secondary" className="!text-xs">
                              {p.journeyL1}
                              {p.journeyL2 && p.journeyL2 !== p.journeyL1 ? ` / ${p.journeyL2}` : ''}
                            </Typography.Text>
                            <Tag className="!m-0 !text-xs">{p.ticketCount} 单</Tag>
                            {p.problemTypeLabel ? <Tag className="!m-0 !text-xs">{p.problemTypeLabel}</Tag> : null}
                            {p.requestSceneLabel ? <Tag className="!m-0 !text-xs">{p.requestSceneLabel}</Tag> : null}
                          </Space>
                          {p.painPointSample ? (
                            <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 !text-[13px]" ellipsis={{ rows: 2, tooltip: p.painPointSample }}>
                              {p.painPointSample}
                            </Typography.Paragraph>
                          ) : null}
                        </div>
                      ))}
                  </Space>
                ) : (
                  <Space size={[6, 6]} wrap>
                    <Tag className="!m-0">{item.problemTypeSnapshot?.trim() || '问题类型：—'}</Tag>
                    <Tag className="!m-0">
                      {journey?.journeyL1 || '用户旅程：—'}
                      {journey?.journeyL2 ? ` / ${journey.journeyL2}` : ''}
                    </Tag>
                    {sources.map((source) => (
                      <Tag key={source} className="!m-0">
                        {DATA_SOURCE_LABELS[source] || source}
                      </Tag>
                    ))}
                    {!sources.length ? <Tag className="!m-0">来源：—</Tag> : null}
                  </Space>
                )}
                {item.painPointSnapshot?.trim() ? (
                  <div className="sub-section-box">
                    <div className="sub-section-label">
                      <span>问题（举措快照）</span>
                    </div>
                    <Typography.Paragraph
                      className="!mb-0 text-sm text-ink-800"
                      ellipsis={{ rows: 3, tooltip: item.painPointSnapshot?.trim() || '—' }}
                    >
                      {item.painPointSnapshot?.trim() || '—'}
                    </Typography.Paragraph>
                  </div>
                ) : null}
                <Typography.Text type="secondary" className="block text-xs">
                  首次提出 {item.firstProposedAt || '—'} · 最近更新{' '}
                  {formatActionItemUpdatedByDisplay(item)} · {formatActionItemUpdatedAtDisplay(item)}
                </Typography.Text>
              </div>
            </div>
          </div>

          {/* ── 分区 4：关联反馈 ── */}
          <div className="drawer-section-gap">
            <div className="section-title">关联反馈（{linkedTicketCount}）</div>
            <div className="page-card-sm">
              <LinkedTicketsInlineList
                ticketIds={linkedTicketIds}
                feedbackByTicketId={feedbackByTicketId}
                onOpenTicket={onOpenTicket}
              />
            </div>
            {observationIssueId ? (
              <div className="mt-2">
                <div className="section-title">留观证据（{observationLinks.length}）</div>
                <div className="page-card-sm space-y-2">
                  {(() => {
                    const ticketEv = observationLinks.filter(
                      (l) => l.linkStatus === 'confirmed' && l.recordDataSource !== 'post_use_rating',
                    )
                    const ratingEv = observationLinks.filter(
                      (l) => l.linkStatus === 'confirmed' && l.recordDataSource === 'post_use_rating',
                    )
                    return (
                      <>
                        <div>
                          <Typography.Text type="secondary" className="mb-1 block text-xs">
                            工单证据（{ticketEv.length}）
                          </Typography.Text>
                          <div className="space-y-1">
                            {ticketEv.length ? ticketEv.map((l) => (
                              <div
                                key={l.id}
                                className="flex items-center gap-2 rounded-md border border-ink-100 px-2 py-1"
                              >
                                {l.ticketId && onOpenTicket ? (
                                  <Button
                                    size="small"
                                    type="link"
                                    className="!px-0"
                                    onClick={() => onOpenTicket(l.ticketId)}
                                  >
                                    {l.ticketId}
                                  </Button>
                                ) : (
                                  l.ticketId ? (
                                    <Typography.Text className="text-xs">{l.ticketId}</Typography.Text>
                                  ) : null
                                )}
                                <Typography.Text type="secondary" className="text-xs">
                                  {DATA_SOURCE_LABELS[l.recordDataSource] || l.recordDataSource}
                                </Typography.Text>
                              </div>
                            )) : (
                              <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
                            )}
                          </div>
                        </div>
                        <div>
                          <Typography.Text type="secondary" className="mb-1 block text-xs">
                            评价证据（{ratingEv.length}）
                          </Typography.Text>
                          <div className="space-y-1">
                            {ratingEv.length ? ratingEv.map((l) => (
                              <div
                                key={l.id}
                                className="rounded-md border border-ink-100 px-2 py-1"
                              >
                                <div className="flex items-center gap-2">
                                  <Tag color="blue" className="!m-0">用后即评</Tag>
                                  <Typography.Text type="secondary" className="text-xs">
                                    {l.lastSeenAt?.slice(0, 10) || l.linkedAt?.slice(0, 10) || ''}
                                  </Typography.Text>
                                </div>
                                {l.matchedExcerpt ? (
                                  <Typography.Text className="mt-0.5 block text-xs" ellipsis={{ tooltip: l.matchedExcerpt }}>
                                    {l.matchedExcerpt}
                                  </Typography.Text>
                                ) : null}
                              </div>
                            )) : (
                              <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
                            )}
                          </div>
                        </div>
                        <Typography.Text type="secondary" className="block text-xs">
                          证据来自留观问题「{item?.content}」升级时确认的关联记录。
                        </Typography.Text>
                      </>
                    )
                  })()}
                </div>
              </div>
            ) : null}
          </div>

          {/* ── 分区 5：效果验证（压降 + 恢复两口径合并，方案 A） ── */}
          <div className="drawer-section-gap">
            <div className="section-title">效果验证</div>
            <div className="page-card-sm">
              {(item.recoveryValidation?.label || item.recoveryValidation?.explanation) ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Typography.Text type="secondary" className="text-xs">
                      用户评分：
                    </Typography.Text>
                    <Typography.Text className="text-[13px]">
                      {item.triggerMetric?.value ?? '—'}{item.triggerMetric?.unit || ''}
                      {item.triggerMetric?.baseline != null ? `（目标 ≥ ${item.triggerMetric.baseline}${item.triggerMetric.unit || ''}）` : ''}
                    </Typography.Text>
                    {item.recoveryValidation?.label ? (
                      <Tag
                        color={item.recoveryValidation.status === 'recovered' ? 'green' : item.recoveryValidation.status === 'not_recovered' ? 'red' : 'gold'}
                        className="!m-0"
                      >
                        {item.recoveryValidation.label}
                      </Tag>
                    ) : null}
                  </div>
                  {item.recoveryValidation?.explanation ? (
                    <div className="rounded bg-ink-50 px-2 py-1 text-xs text-secondary">
                      {item.recoveryValidation.explanation}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <ActionProblemScopePanel
                action={item}
                feedbackByTicketId={feedbackByTicketId}
                productNameByKey={productNameByKey}
              />
            </div>
          </div>
        </div>
      ) : null}
    </Drawer>
  )
}
