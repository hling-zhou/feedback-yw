import { useEffect, useMemo, useState } from 'react'
import { Button, Descriptions, Drawer, Form, Input, Popconfirm, Select, Typography, message } from 'antd'
import { ACTION_ITEM_DRAWER_WIDTH } from '../../constants/appLayout.js'
import { listAssignees } from '../../lib/postUseJiraClient.js'
import { buildUserOption, userOptionFilterOption } from '../../lib/userSelectOptions.js'
import {
  createActionItem,
  getActionItem,
  updateActionItem,
} from '../../lib/actionItemClient.js'
import EstablishedActionFields from './EstablishedActionFields.jsx'
import PostUseReportIssueLinker from '../feedbacks/PostUseReportIssueLinker.jsx'

/**
 * @param {object} props
 * @param {object | null} props.item
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('antd').FormInstance} props.form
 * @param {boolean} props.canEdit
 * @param {boolean} props.saving
 * @param {(mode: 'submit' | 'draft') => void} props.onSave 2026-11-05：状态自动流转——提交→已处理 / 暂存→处理中；提交校验回溯结果必填
 * @param {(actionId: string) => void} [props.onActionSaved]
 * @param {() => void} [props.onActionCleared]
 */
export default function PostUseJiraDrawer({
  item,
  open,
  onClose,
  form,
  canEdit,
  saving,
  onSave,
  onActionSaved,
  onActionCleared,
}) {
  const [assignees, setAssignees] = useState([])
  const [actionItem, setActionItem] = useState(null)
  const [actionSaving, setActionSaving] = useState(false)
  const [actionDraft, setActionDraft] = useState({
    establishedAction: '',
    establishedActionDetail: '',
    actionSchedule: '',
  })

  useEffect(() => {
    if (!open) return
    listAssignees()
      .then((res) => setAssignees(res?.users || []))
      .catch(() => {})
  }, [open])

  // 打开时若有 actionId，加载 action_item 全量数据（含 establishedAction 等）
  useEffect(() => {
    if (!open || !item?.actionId) {
      setActionItem(null)
      setActionDraft({ establishedAction: '', establishedActionDetail: '', actionSchedule: '' })
      return
    }
    let cancelled = false
    getActionItem(item.actionId)
      .then((full) => {
        if (cancelled) return
        setActionItem(full)
        setActionDraft({
          establishedAction: full?.content || '',
          establishedActionDetail: full?.detail || '',
          actionSchedule: full?.scheduleAt || '',
        })
      })
      .catch(() => {
        if (cancelled) return
        setActionItem(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, item?.actionId])

  const assigneeName = useMemo(() => {
    const id = item?.assigneeId
    if (!id) return ''
    const found = assignees.find((u) => u.id === id)
    return found?.username || item?.assigneeName || ''
  }, [item, assignees])

  /** 从举措库选择已有 action_item → 回写 payload.actionId */
  const handleSelect = (selected) => {
    setActionItem(selected)
    setActionDraft({
      establishedAction: selected?.content || '',
      establishedActionDetail: selected?.detail || '',
      actionSchedule: selected?.scheduleAt || '',
    })
    if (selected?.id) onActionSaved?.(selected.id)
  }

  /** 清除关联 */
  const handleClear = () => {
    setActionItem(null)
    setActionDraft({ establishedAction: '', establishedActionDetail: '', actionSchedule: '' })
    onActionCleared?.()
  }

  /** 直接编辑举措内容（非库关联）→ 新建或更新 action_item */
  const handleContentChange = async (value) => {
    setActionDraft((prev) => ({ ...prev, establishedAction: value }))
  }
  const handleDetailChange = async (value) => {
    setActionDraft((prev) => ({ ...prev, establishedActionDetail: value }))
  }
  const handleScheduleChange = async (value) => {
    setActionDraft((prev) => ({ ...prev, actionSchedule: value }))
  }

  /** 保存举措（新建 or 更新）→ 返回是否成功 */
  const handleSaveAction = async () => {
    const content = actionDraft.establishedAction.trim()
    if (!content) return true // 无举措内容视为无需保存，不阻断
    setActionSaving(true)
    try {
      const payload = {
        productKey: item?.productName || '',
        productName: item?.productName || '',
        content,
        detail: actionDraft.establishedActionDetail || '',
        scheduleAt: actionDraft.actionSchedule || '',
        source: 'post_use',
      }
      if (actionItem?.id) {
        const updated = await updateActionItem(actionItem.id, payload)
        setActionItem(updated)
      } else {
        const created = await createActionItem(payload)
        setActionItem(created)
        onActionSaved?.(created.id)
      }
      return true
    } catch (err) {
      message.error(err?.message || '举措保存失败')
      return false
    } finally {
      setActionSaving(false)
    }
  }

  /** 合并保存：先保存举措（如有内容），再按模式保存表单
   * 2026-11-05 拍板：状态由操作自动判定——提交=已处理（校验回溯结果必填）/ 暂存=处理中（不校验）；两者成功后都关抽屉 */
  const handleSubmit = async () => {
    const ok = await handleSaveAction()
    if (!ok) return
    onSave('submit')
  }

  const handleDraft = async () => {
    const ok = await handleSaveAction()
    if (!ok) return
    onSave('draft')
  }

  return (
    <Drawer
      title="产品部溯源"
      open={open}
      onClose={onClose}
      width={ACTION_ITEM_DRAWER_WIDTH}
      destroyOnClose
      footer={
        canEdit ? (
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button loading={saving || actionSaving} onClick={() => void handleDraft()}>
              暂存
            </Button>
            {/* 2026-11-05 用户拍板：完成前显式提示——回溯完结才点完成，过程性进展走暂存；2026-11-09 按钮文案改「回溯完成」 */}
            <Popconfirm
              title="请务必在回溯完结后再标记完成"
              description="过程性进展保存可点击「暂存」（暂存状态为处理中，可随时继续编辑）。"
              okText="确认完成"
              cancelText="再想想"
              onConfirm={() => void handleSubmit()}
            >
              <Button type="primary" loading={saving || actionSaving}>
                回溯完成
              </Button>
            </Popconfirm>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button onClick={onClose}>关闭</Button>
          </div>
        )
      }
    >
      {item ? (
        <div className="space-y-4">
          <div>
            <Typography.Text type="secondary">基础信息</Typography.Text>
            <Descriptions size="small" column={1} className="mt-2" bordered labelStyle={{ whiteSpace: 'nowrap' }}>
              <Descriptions.Item label="数据月份">{item.importMonth || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户名称">{item.customerName || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户编码">{item.customerCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="登录账号名称">{item.loginAccountName || '—'}</Descriptions.Item>
              <Descriptions.Item label="产品名称">{item.productName || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户反馈">{item.customerFeedback || '—'}</Descriptions.Item>
              {item.scoreSource === '投诉回访' && (
                <Descriptions.Item label="相应投诉工单">{item.originalTicketId || '—'}</Descriptions.Item>
              )}
              <Descriptions.Item label="经办人">{assigneeName || '—'}</Descriptions.Item>
            </Descriptions>
          </div>
          <Form form={form} layout="vertical" disabled={!canEdit}>
            <Form.Item name="assigneeId" label="经办人">
              <Select
                showSearch
                allowClear
                placeholder="选择经办人"
                filterOption={userOptionFilterOption}
                options={assignees.map((u) => buildUserOption(u, assignees))}
              />
            </Form.Item>
            {/* 2026-11-05：状态下拉移除——状态由操作自动流转（提交→已处理 / 暂存→处理中），提交时触发必填校验 */}
            <Form.Item
              name="progress"
              label="回溯结果"
              rules={[{ required: true, message: '提交前请填写回溯结果' }]}
            >
              <Input.TextArea rows={4} placeholder="填写回溯处理结果" />
            </Form.Item>
          </Form>

          {canEdit ? (
            <div>
              <Typography.Text type="secondary">确立举措</Typography.Text>
              <div className="mt-2">
                <EstablishedActionFields
                  productKey={item?.productName || ''}
                  actionId={actionItem?.id || ''}
                  source="post_use"
                  establishedAction={actionDraft.establishedAction}
                  establishedActionDetail={actionDraft.establishedActionDetail}
                  actionSchedule={actionDraft.actionSchedule}
                  linkedFromLibrary={Boolean(actionItem?.id)}
                  disabled={!canEdit}
                  onSelect={handleSelect}
                  onClear={handleClear}
                  onContentChange={handleContentChange}
                  onDetailChange={handleDetailChange}
                  onScheduleChange={handleScheduleChange}
                />
              </div>
            </div>
          ) : null}
          <PostUseReportIssueLinker sourceType="trace" sourceId={/** @type {any} */ (item).id} open={open} canEdit={canEdit} />
        </div>
      ) : null}
    </Drawer>
  )
}
