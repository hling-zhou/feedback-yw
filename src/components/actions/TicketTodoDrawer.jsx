import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd'
import { ACTION_ITEM_DRAWER_WIDTH } from '../../constants/appLayout.js'
import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import {
  TICKET_TODO_PROCESS_MODE,
  TICKET_TODO_PROCESS_NOTE_MAX_LENGTH,
  TICKET_TODO_TEXT_MAX_LENGTH,
  formatTicketTodoAssigneeLabel,
  formatTicketTodoDateTime,
  getTicketTodoResolution,
  isTicketTodoOpen,
  normalizeTicketTodoAssignees,
} from '../../domain/ticketTodo.js'
import {
  getEstablishedActionDetailDisplay,
  getEstablishedActionDisplay,
} from '../../domain/establishedAction.js'
import { getActionScheduleDisplay } from '../../domain/actionSchedule.js'
import EstablishedActionFields, {
  getActionItemDisplayScheduleAt,
} from './EstablishedActionFields.jsx'
import LinkedTicketsInlineList from './LinkedTicketsInlineList.jsx'
import TicketTodoStatusTag from '../tags/TicketTodoStatusTag.jsx'
import {
  OBSERVATION_SUMMARY_MAX_LENGTH,
} from '../../domain/observationIssue.js'
import {
  listObservationIssues,
} from '../../lib/observationClient.js'
import { userOptionFilterOption } from '../../lib/userSelectOptions.js'

/** @typedef {import('../../domain/ticketTodo.js').TicketTodoRow} TicketTodoRow */
/** @typedef {import('../../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../../domain/actionItem.js').ActionItem} ActionItem */

/**
 * @param {Object} props
 * @param {TicketTodoRow | null} props.row
 * @param {FeedbackRecord | null} [props.record]
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {boolean} props.canProcess
 * @param {boolean} props.saving
 * @param {(payload: {
 *   text: string
 *   assigneeUserId: string
 *   assigneeUsername: string
 *   assignees: { userId: string; username: string }[]
 *   processMode: 'establish_action' | 'convert_observation' | 'no_action'
 *   establishedAction: string
 *   establishedActionDetail: string
 *   actionSchedule: string
 *   actionId: string
 *   linkedFromLibrary: boolean
 *   processNote: string
 *   markProcessed: boolean
 *   observationSummary?: string
 *   observationIssueId?: string
 *   observationCreateNew?: boolean
 * }) => void | Promise<void>} props.onSave
 * @param {Map<string, FeedbackRecord>} [props.feedbackByTicketId]
 * @param {(ticketId: string) => void} [props.onOpenTicket]
 * @param {{ value: string; label: string }[]} [props.assigneeOptions]
 */
export default function TicketTodoDrawer({
  row,
  record,
  open,
  onClose,
  canProcess,
  saving,
  onSave,
  feedbackByTicketId,
  onOpenTicket,
  assigneeOptions = [],
}) {
  const processing = Boolean(canProcess && row && isTicketTodoOpen(row))
  const [text, setText] = useState('')
  const [assignees, setAssignees] = useState(/** @type {{ userId: string; username: string }[]} */ ([]))
  const [processMode, setProcessMode] = useState(TICKET_TODO_PROCESS_MODE.ESTABLISH_ACTION)
  const [actionId, setActionId] = useState('')
  const [establishedAction, setEstablishedAction] = useState('')
  const [establishedActionDetail, setEstablishedActionDetail] = useState('')
  const [actionSchedule, setActionSchedule] = useState('')
  const [linkedFromLibrary, setLinkedFromLibrary] = useState(false)
  const [processNote, setProcessNote] = useState('')
  const [markProcessed, setMarkProcessed] = useState(true)
  const [observationCreateNew, setObservationCreateNew] = useState(true)
  const [observationSummary, setObservationSummary] = useState('')
  const [observationIssueId, setObservationIssueId] = useState('')
  const [observationOptions, setObservationOptions] = useState(/** @type {{ value: string; label: string }[]} */ ([]))
  const [observationSearching, setObservationSearching] = useState(false)

  useEffect(() => {
    if (!open || !row) return
    setText(row.text || '')
    setAssignees(normalizeTicketTodoAssignees(row))
    setProcessNote(row.processNote || '')
    setMarkProcessed(true)
    setProcessMode(TICKET_TODO_PROCESS_MODE.ESTABLISH_ACTION)
    setObservationCreateNew(true)
    setObservationIssueId('')
    setObservationOptions([])
    setObservationSummary((row.text || '').slice(0, OBSERVATION_SUMMARY_MAX_LENGTH))
    const ticket = record
    const existingId = String(ticket?.actionId || '').trim()
    setActionId(existingId)
    setEstablishedAction(getEstablishedActionDisplay(ticket) || '')
    setEstablishedActionDetail(getEstablishedActionDetailDisplay(ticket) || '')
    setActionSchedule(String(ticket?.actionSchedule || '').trim())
    setLinkedFromLibrary(Boolean(existingId))
  }, [open, row, record])

  const title = useMemo(() => {
    if (!row) return '会议待办'
    return (
      <div className="flex w-full min-w-0 flex-col gap-1 pr-6">
        <span className="text-base font-semibold leading-none">
          {processing ? '处理会议待办' : '查看会议待办'}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <Typography.Text type="secondary" className="min-w-0 text-xs" ellipsis={{ tooltip: row.productName }}>
            {row.productName || '未指定产品'}
          </Typography.Text>
          <TicketTodoStatusTag resolution={getTicketTodoResolution(row)} />
        </div>
      </div>
    )
  }, [processing, row])

  const ticketIds = row
    ? [...new Set((row.linkedTicketIds?.length ? row.linkedTicketIds : [row.ticketId]).filter(Boolean))]
    : []
  const sourceLabel = DATA_SOURCE_LABELS[row?.dataSourceType] || row?.dataSourceType || '—'
  const viewResolution = row ? getTicketTodoResolution(row) : 'open'
  const showViewAction = viewResolution === 'converted_to_action'
  const showViewNote = viewResolution === 'processed_without_action'

  const handleSave = () => {
    const first = assignees[0]
    void onSave({
      text,
      assigneeUserId: first?.userId || '',
      assigneeUsername: first?.username || '',
      assignees,
      processMode,
      establishedAction,
      establishedActionDetail,
      actionSchedule,
      actionId,
      linkedFromLibrary,
      processNote,
      markProcessed,
      observationSummary,
      observationIssueId,
      observationCreateNew,
    })
  }

  return (
    <Drawer
      title={title}
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
        processing ? (
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              提交
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button onClick={onClose}>关闭</Button>
          </div>
        )
      }
    >
      {row ? (
        <div className="min-w-0 max-w-full drawer-space-y overflow-x-hidden">
          {/* ── 分区 1：待办信息 ── */}
          <div className="drawer-section-gap">
            <div className="section-title">待办信息</div>
            <div className="page-card-sm">
              {processing ? (
                <Form layout="vertical" className="!mb-0">
                  <Form.Item label="待办" className="!mb-3">
                    <Input.TextArea
                      rows={3}
                      maxLength={TICKET_TODO_TEXT_MAX_LENGTH}
                      showCount
                      value={text}
                      disabled={saving}
                      onChange={(event) =>
                        setText(event.target.value.slice(0, TICKET_TODO_TEXT_MAX_LENGTH))
                      }
                    />
                  </Form.Item>
                  <Form.Item label="负责人" className="!mb-0">
                    <Select
                      className="w-full"
                      mode="multiple"
                      placeholder="负责人"
                      showSearch
                      filterOption={userOptionFilterOption}
                      allowClear
                      disabled={saving || !assigneeOptions.length}
                      value={assignees.map((item) => item.userId)}
                      options={assigneeOptions}
                      onChange={(values) => {
                        setAssignees(
                          (values || []).map((userId) => {
                            const option = assigneeOptions.find((item) => item.value === userId)
                            return { userId, username: option?.username || userId }
                          }),
                        )
                      }}
                    />
                  </Form.Item>
                </Form>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Typography.Text type="secondary" className="mb-1 block text-xs">
                      待办
                    </Typography.Text>
                    <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-[13px] font-medium">
                      {row.text || '—'}
                    </Typography.Paragraph>
                  </div>
                  <div>
                    <Typography.Text type="secondary" className="mb-1 block text-xs">
                      负责人
                    </Typography.Text>
                    <Typography.Text className="text-[13px]">
                      {formatTicketTodoAssigneeLabel(row)}
                    </Typography.Text>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── 分区 2：处理 ── */}
          <div className="drawer-section-gap">
            <div className="section-title">处理</div>
            <div className="page-card-sm">
              {processing ? (
                <div className="space-y-3">
                  <Radio.Group
                    value={processMode}
                    disabled={saving}
                    onChange={(event) => setProcessMode(event.target.value)}
                  >
                    <Radio value={TICKET_TODO_PROCESS_MODE.ESTABLISH_ACTION}>制定举措</Radio>
                    <Radio value={TICKET_TODO_PROCESS_MODE.CONVERT_OBSERVATION}>转留观</Radio>
                    <Radio value={TICKET_TODO_PROCESS_MODE.NO_ACTION}>无举措</Radio>
                  </Radio.Group>
                  {processMode === TICKET_TODO_PROCESS_MODE.CONVERT_OBSERVATION ? (
                    <div className="sub-section-box">
                      <div className="sub-section-label">
                        <span>转留观</span>
                      </div>
                      <div className="space-y-3">
                        <Radio.Group
                          value={observationCreateNew ? 'new' : 'attach'}
                          disabled={saving}
                          onChange={(event) => setObservationCreateNew(event.target.value === 'new')}
                        >
                          <Radio value="new">新建留观问题</Radio>
                          <Radio value="attach">关联已有</Radio>
                        </Radio.Group>
                        {observationCreateNew ? (
                          <Input.TextArea
                            rows={3}
                            placeholder="问题摘要（预填待办文本，可修改）"
                            maxLength={OBSERVATION_SUMMARY_MAX_LENGTH}
                            showCount
                            value={observationSummary}
                            disabled={saving}
                            onChange={(event) => setObservationSummary(event.target.value)}
                          />
                        ) : (
                          <Select
                            showSearch
                            filterOption={false}
                            placeholder={`搜索同产品留观问题${record?.productKey ? '（当前产品）' : ''}`}
                            value={observationIssueId || undefined}
                            disabled={saving}
                            loading={observationSearching}
                            options={observationOptions}
                            onSearch={(q) => {
                              const text = String(q || '').trim()
                              if (!text) return
                              setObservationSearching(true)
                              listObservationIssues({
                                keyword: text,
                                productKey: record?.productKey || row.productKey || undefined,
                                pageSize: 20,
                              })
                                .then((result) => {
                                  setObservationOptions(
                                    result.issues.map((issue) => ({
                                      value: issue.id,
                                      label: `${issue.title} · ${issue.occurrenceCount} 次 · 最近 ${issue.lastSeenAt?.slice(0, 10) || '—'}`,
                                    })),
                                  )
                                })
                                .catch(() => setObservationOptions([]))
                                .finally(() => setObservationSearching(false))
                            }}
                            onChange={(v) => setObservationIssueId(v || '')}
                            allowClear
                          />
                        )}
                        <Typography.Text type="secondary" className="block text-xs">
                          转留观后待办标记为「已转留观」，宿主工单将作为该留观问题的首条证据。
                        </Typography.Text>
                      </div>
                    </div>
                  ) : processMode === TICKET_TODO_PROCESS_MODE.ESTABLISH_ACTION ? (
                    <div className="sub-section-box">
                      <div className="sub-section-label">
                        <span>制定举措</span>
                      </div>
                      <EstablishedActionFields
                        productKey={record?.productKey || row.productKey}
                        actionId={actionId}
                        establishedAction={establishedAction}
                        establishedActionDetail={establishedActionDetail}
                        actionSchedule={actionSchedule}
                        linkedFromLibrary={linkedFromLibrary}
                        disabled={saving}
                        onSelect={(item) => {
                          setActionId(item.id)
                          setEstablishedAction(item.content)
                          setEstablishedActionDetail(item.detail || '')
                          setActionSchedule(getActionItemDisplayScheduleAt(item))
                          setLinkedFromLibrary(true)
                        }}
                        onClear={() => {
                          setActionId('')
                          setEstablishedAction('')
                          setEstablishedActionDetail('')
                          setActionSchedule('')
                          setLinkedFromLibrary(false)
                        }}
                        onContentChange={setEstablishedAction}
                        onDetailChange={setEstablishedActionDetail}
                        onScheduleChange={setActionSchedule}
                      />
                    </div>
                  ) : (
                    <div className="sub-section-box">
                      <div className="sub-section-label">
                        <span>无举措</span>
                      </div>
                      <div className="space-y-3">
                        <Input.TextArea
                          rows={3}
                          placeholder="直接反馈一段话（备注）"
                          maxLength={TICKET_TODO_PROCESS_NOTE_MAX_LENGTH}
                          showCount
                          value={processNote}
                          disabled={saving}
                          onChange={(event) =>
                            setProcessNote(event.target.value.slice(0, TICKET_TODO_PROCESS_NOTE_MAX_LENGTH))
                          }
                        />
                        <Checkbox
                          checked={markProcessed}
                          disabled={saving}
                          onChange={(event) => setMarkProcessed(event.target.checked)}
                        >
                          标记为已处理
                        </Checkbox>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {showViewAction ? (
                    <div className="sub-section-box">
                      <div className="sub-section-label">
                        <span>已制定举措</span>
                      </div>
                      <div className="space-y-1">
                        <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-sm">
                          {getEstablishedActionDisplay(record) || '—'}
                        </Typography.Paragraph>
                        {getEstablishedActionDetailDisplay(record) ? (
                          <Typography.Paragraph type="secondary" className="!mb-0 whitespace-pre-wrap text-xs">
                            {getEstablishedActionDetailDisplay(record)}
                          </Typography.Paragraph>
                        ) : null}
                        <Typography.Text type="secondary" className="block text-xs">
                          排期：{getActionScheduleDisplay(record?.actionSchedule)}
                        </Typography.Text>
                      </div>
                    </div>
                  ) : null}
                  {showViewNote && !showViewAction ? (
                    <div className="sub-section-box">
                      <div className="sub-section-label">
                        <span>处理备注</span>
                      </div>
                      <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-sm">
                        {row.processNote || '—'}
                      </Typography.Paragraph>
                    </div>
                  ) : null}
                  {!showViewAction && !showViewNote ? (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {/* ── 分区 3：问题上下文 ── */}
          <div className="drawer-section-gap">
            <div className="section-title">问题上下文</div>
            <div className="page-card-sm">
              <div className="space-y-3">
                <Space size={[6, 6]} wrap>
                  <Tag className="!m-0">{row.problemType || '问题类型：—'}</Tag>
                  <Tag className="!m-0">
                    {row.journeyL1 || '用户旅程：—'}
                    {row.journeyL2 ? ` / ${row.journeyL2}` : ''}
                  </Tag>
                  <Tag className="!m-0">{sourceLabel}</Tag>
                </Space>
                <div>
                  <Typography.Text type="secondary" className="mb-1 block text-xs">
                    问题
                  </Typography.Text>
                  <Typography.Paragraph
                    className="!mb-0 text-[13px] font-medium text-ink-800"
                    ellipsis={{ rows: 2, tooltip: row.painPoint || '—' }}
                  >
                    {row.painPoint || '—'}
                  </Typography.Paragraph>
                </div>
                <Typography.Text type="secondary" className="block text-xs">
                  提出时间 {formatTicketTodoDateTime(row.createdAt) || '—'}
                  {row.updatedAt ? ` · 最近更新 ${formatTicketTodoDateTime(row.updatedAt)}` : ''}
                </Typography.Text>
              </div>
            </div>
          </div>

          {/* ── 分区 4：关联反馈 ── */}
          <div className="drawer-section-gap">
            <div className="section-title">关联反馈（{ticketIds.length}）</div>
            <div className="page-card-sm">
              <LinkedTicketsInlineList
                ticketIds={ticketIds}
                feedbackByTicketId={feedbackByTicketId}
                onOpenTicket={onOpenTicket}
              />
            </div>
          </div>
        </div>
      ) : null}
    </Drawer>
  )
}
