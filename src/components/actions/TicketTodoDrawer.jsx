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
 *   processMode: 'establish_action' | 'no_action'
 *   establishedAction: string
 *   establishedActionDetail: string
 *   actionSchedule: string
 *   actionId: string
 *   linkedFromLibrary: boolean
 *   processNote: string
 *   markProcessed: boolean
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

  useEffect(() => {
    if (!open || !row) return
    setText(row.text || '')
    setAssignees(normalizeTicketTodoAssignees(row))
    setProcessNote(row.processNote || '')
    setMarkProcessed(true)
    setProcessMode(TICKET_TODO_PROCESS_MODE.ESTABLISH_ACTION)
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
        <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden">
          <section>
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
                    optionFilterProp="label"
                    allowClear
                    disabled={saving || !assigneeOptions.length}
                    value={assignees.map((item) => item.userId)}
                    options={assigneeOptions}
                    onChange={(values) => {
                      setAssignees(
                        (values || []).map((userId) => {
                          const option = assigneeOptions.find((item) => item.value === userId)
                          return { userId, username: option?.label || userId }
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
                  <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-sm">
                    {row.text || '—'}
                  </Typography.Paragraph>
                </div>
                <div>
                  <Typography.Text type="secondary" className="mb-1 block text-xs">
                    负责人
                  </Typography.Text>
                  <Typography.Text className="text-sm">
                    {formatTicketTodoAssigneeLabel(row)}
                  </Typography.Text>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <Typography.Title level={5} className="!mb-0 !text-sm !font-semibold">
              处理
            </Typography.Title>
            {processing ? (
              <div className="space-y-3">
                <Radio.Group
                  value={processMode}
                  disabled={saving}
                  onChange={(event) => setProcessMode(event.target.value)}
                >
                  <Radio value={TICKET_TODO_PROCESS_MODE.ESTABLISH_ACTION}>制定举措</Radio>
                  <Radio value={TICKET_TODO_PROCESS_MODE.NO_ACTION}>无举措</Radio>
                </Radio.Group>
                {processMode === TICKET_TODO_PROCESS_MODE.ESTABLISH_ACTION ? (
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
                ) : (
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
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {showViewAction ? (
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
                ) : null}
                {showViewNote && !showViewAction ? (
                  <div>
                    <Typography.Text type="secondary" className="mb-1 block text-xs">
                      处理备注
                    </Typography.Text>
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
          </section>

          <section className="space-y-3">
            <Typography.Title level={5} className="!mb-0 !text-sm !font-semibold">
              问题上下文
            </Typography.Title>
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
                className="!mb-0 text-sm text-ink-800"
                ellipsis={{ rows: 3, tooltip: row.painPoint || '—' }}
              >
                {row.painPoint || '—'}
              </Typography.Paragraph>
            </div>
            <Typography.Text type="secondary" className="block text-xs">
              提出时间 {formatTicketTodoDateTime(row.createdAt) || '—'}
              {row.updatedAt ? ` · 最近更新 ${formatTicketTodoDateTime(row.updatedAt)}` : ''}
            </Typography.Text>
          </section>

          <section className="space-y-3">
            <Typography.Title level={5} className="!mb-0 !text-sm !font-semibold">
              关联反馈（{ticketIds.length}）
            </Typography.Title>
            <LinkedTicketsInlineList
              ticketIds={ticketIds}
              feedbackByTicketId={feedbackByTicketId}
              onOpenTicket={onOpenTicket}
            />
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}
