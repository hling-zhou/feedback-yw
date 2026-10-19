import { useEffect, useMemo, useState } from 'react'
import { Button, Descriptions, Drawer, Form, Input, Select, Typography, message } from 'antd'
import { ACTION_ITEM_DRAWER_WIDTH } from '../../constants/appLayout.js'
import { POST_USE_JIRA_STATUSES } from '../../domain/postUseJira.js'
import { listAssignees } from '../../lib/postUseJiraClient.js'
import {
  createActionItem,
  getActionItem,
  updateActionItem,
} from '../../lib/actionItemClient.js'
import EstablishedActionFields from './EstablishedActionFields.jsx'

/**
 * @param {object} props
 * @param {object | null} props.item
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('antd').FormInstance} props.form
 * @param {boolean} props.canEdit
 * @param {boolean} props.saving
 * @param {() => void} props.onSave
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

  /** 合并保存：先保存举措（如有内容），再保存表单 */
  const handleSaveAll = async () => {
    const ok = await handleSaveAction()
    if (!ok) return
    onSave()
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
            <Button type="primary" loading={saving || actionSaving} onClick={() => void handleSaveAll()}>
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
        <div className="space-y-4">
          <div>
            <Typography.Text type="secondary">基础信息</Typography.Text>
            <Descriptions size="small" column={1} className="mt-2" bordered>
              <Descriptions.Item label="数据月份">{item.importMonth || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户名称">{item.customerName || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户编码">{item.customerCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="产品名称">{item.productName || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户反馈">{item.customerFeedback || '—'}</Descriptions.Item>
              <Descriptions.Item label="经办人">{assigneeName || '—'}</Descriptions.Item>
            </Descriptions>
          </div>
          <Form form={form} layout="vertical" disabled={!canEdit}>
            <Form.Item name="assigneeId" label="经办人">
              <Select
                showSearch
                allowClear
                placeholder="选择经办人"
                optionFilterProp="label"
                options={assignees.map((u) => ({ label: u.username, value: u.id }))}
              />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                options={POST_USE_JIRA_STATUSES.map((value) => ({ label: value, value }))}
              />
            </Form.Item>
            <Form.Item name="progress" label="进展">
              <Input.TextArea rows={4} placeholder="填写当前进展" />
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
        </div>
      ) : null}
    </Drawer>
  )
}
