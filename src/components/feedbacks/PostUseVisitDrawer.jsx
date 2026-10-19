import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Descriptions, Drawer, Form, Input, Select, Space, Tag, Typography, message } from 'antd'
import { TICKET_DETAIL_DRAWER_WIDTH } from '../../constants/appLayout.js'
import { patchPostUseVisit, postUseVisitReviewId } from '../../lib/postUseVisitClient.js'
import { listAssignees } from '../../lib/postUseJiraClient.js'
import {
  createActionItem,
  getActionItem,
  updateActionItem,
} from '../../lib/actionItemClient.js'
import { useUserTicketReviews } from '../../context/UserTicketReviewContext.jsx'
import EstablishedActionFields from '../actions/EstablishedActionFields.jsx'
import PermissionGate from '../auth/PermissionGate.jsx'

/** @typedef {import('../../lib/postUseRating/visitRecords.js').PostUseVisitRecord} PostUseVisitRecord */

/**
 * 客服部回访详情抽屉：展示回访信息，内部评估/备注可编辑（editRecord 权限），
 * 已处理状态写入 user_ticket_review（visit: 前缀）。
 *
 * @param {object} props
 * @param {PostUseVisitRecord | null} props.record
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(record: PostUseVisitRecord) => void} props.onSaved
 */
export default function PostUseVisitDrawer({ record, open, onClose, onSaved }) {
  const { markReviewDone, clearReview, isReviewDone } = useUserTicketReviews()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [assignees, setAssignees] = useState([])
  const [actionItem, setActionItem] = useState(null)
  const [actionSaving, setActionSaving] = useState(false)
  const [actionDraft, setActionDraft] = useState({
    establishedAction: '',
    establishedActionDetail: '',
    actionSchedule: '',
  })

  const reviewId = useMemo(
    () => (record?.id ? postUseVisitReviewId(record.id) : ''),
    [record?.id],
  )
  const reviewDone = useMemo(
    () => (reviewId ? isReviewDone(reviewId) : false),
    [reviewId, isReviewDone],
  )

  useEffect(() => {
    if (!open) return
    listAssignees()
      .then((res) => setAssignees(res?.users || []))
      .catch(() => {})
  }, [open])

  // 打开时若有 actionId，加载 action_item 全量数据
  useEffect(() => {
    if (!open || !record?.actionId) {
      setActionItem(null)
      setActionDraft({ establishedAction: '', establishedActionDetail: '', actionSchedule: '' })
      return
    }
    let cancelled = false
    getActionItem(record.actionId)
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
  }, [open, record?.actionId])

  useEffect(() => {
    if (open && record) {
      form.setFieldsValue({
        internalEvaluationDetail: record.internalEvaluationDetail || record.internalConclusion || '',
        remark: record.remark || '',
        assigneeName: record.assigneeName || '',
      })
    }
  }, [open, record, form])

  const handleSave = async () => {
    if (!record?.id) return
    const values = await form.validateFields()
    setSaving(true)
    try {
      const data = await patchPostUseVisit(record.id, {
        internalEvaluationDetail: String(values.internalEvaluationDetail || ''),
        remark: String(values.remark || ''),
        assigneeName: String(values.assigneeName || ''),
        baseUpdatedAt: record.updatedAt,
      })
      const item = data?.item
      if (item) {
        message.success('已保存')
        onSaved?.(item)
        onClose?.()
      } else {
        message.error('保存失败：响应缺少记录')
      }
    } catch (err) {
      const status = /** @type {any} */ (err)?.status
      if (status === 409) {
        message.error('该回访已被他人更新，请刷新后重试')
      } else {
        message.error(err instanceof Error ? err.message : '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  /** 从举措库选择已有 action_item → 回写 meta.actionId */
  const handleSelect = async (selected) => {
    setActionItem(selected)
    setActionDraft({
      establishedAction: selected?.content || '',
      establishedActionDetail: selected?.detail || '',
      actionSchedule: selected?.scheduleAt || '',
    })
    if (selected?.id && record?.id) {
      try {
        const data = await patchPostUseVisit(record.id, { actionId: selected.id, baseUpdatedAt: record.updatedAt })
        const item = data?.item
        if (item) {
          message.success('已关联举措')
          onSaved?.(item)
        }
      } catch (err) {
        message.error(err?.message || '关联举措失败')
      }
    }
  }

  /** 清除关联 */
  const handleClear = async () => {
    setActionItem(null)
    setActionDraft({ establishedAction: '', establishedActionDetail: '', actionSchedule: '' })
    if (record?.id) {
      try {
        const data = await patchPostUseVisit(record.id, { actionId: '', baseUpdatedAt: record.updatedAt })
        const item = data?.item
        if (item) {
          message.success('已清除举措关联')
          onSaved?.(item)
        }
      } catch (err) {
        message.error(err?.message || '清除举措关联失败')
      }
    }
  }

  const handleContentChange = (value) => {
    setActionDraft((prev) => ({ ...prev, establishedAction: value }))
  }
  const handleDetailChange = (value) => {
    setActionDraft((prev) => ({ ...prev, establishedActionDetail: value }))
  }
  const handleScheduleChange = (value) => {
    setActionDraft((prev) => ({ ...prev, actionSchedule: value }))
  }

  /** 保存举措（新建 or 更新）→ 回写 meta.actionId → 返回是否成功 */
  const handleSaveAction = async () => {
    const content = actionDraft.establishedAction.trim()
    if (!content) return true // 无举措内容视为无需保存，不阻断
    if (!record?.id) return false
    setActionSaving(true)
    try {
      const payload = {
        productKey: record?.productName || '',
        productName: record?.productName || '',
        content,
        detail: actionDraft.establishedActionDetail || '',
        scheduleAt: actionDraft.actionSchedule || '',
        source: 'post_use',
      }
      let savedActionId = actionItem?.id || ''
      if (actionItem?.id) {
        const updated = await updateActionItem(actionItem.id, payload)
        setActionItem(updated)
      } else {
        const created = await createActionItem(payload)
        setActionItem(created)
        savedActionId = created.id
      }
      // 回写 meta.actionId
      const data = await patchPostUseVisit(record.id, { actionId: savedActionId, baseUpdatedAt: record.updatedAt })
      const visitItem = data?.item
      if (visitItem) {
        onSaved?.(visitItem)
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
    await handleSave()
  }

  const handleReviewChange = async (checked) => {
    if (!reviewId) return
    setReviewBusy(true)
    try {
      if (checked) {
        await markReviewDone(reviewId, 'manual')
      } else {
        await clearReview(reviewId)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '处理状态更新失败')
    } finally {
      setReviewBusy(false)
    }
  }

  return (
    <Drawer
      title={
        <Space size={8}>
          <span>客服部回访</span>
          {reviewDone ? <Tag color="green">已处理</Tag> : <Tag>未处理</Tag>}
        </Space>
      }
      open={open}
      onClose={onClose}
      width={TICKET_DETAIL_DRAWER_WIDTH}
      destroyOnClose
      footer={
        <PermissionGate permission="editRecord">
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving || actionSaving} onClick={() => void handleSaveAll()}>
              保存
            </Button>
          </div>
        </PermissionGate>
      }
    >
      {record ? (
        <div className="space-y-4">
          <div>
            <Typography.Text type="secondary">基础信息</Typography.Text>
            <Descriptions size="small" column={1} className="mt-2" bordered>
              <Descriptions.Item label="数据月份">{record.importMonth || record.visitMonth || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户名称">{record.customerName || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户编码">{record.customerCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="产品名称">{record.productName || '—'}</Descriptions.Item>
              <Descriptions.Item label="用户反馈原文">{record.userFeedbackText || '—'}</Descriptions.Item>
              <Descriptions.Item label="回访结果">{record.visitResult || '—'}</Descriptions.Item>
              <Descriptions.Item label="涉及评价">{record.ratingText || '—'}</Descriptions.Item>
              <Descriptions.Item label="经办人">{record.assigneeName || '—'}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{record.updatedAt || '—'}</Descriptions.Item>
            </Descriptions>
          </div>

          <Checkbox
            checked={reviewDone}
            disabled={reviewBusy || !reviewId}
            onChange={(e) => void handleReviewChange(e.target.checked)}
          >
            标记为已处理（仅自己的处理状态）
          </Checkbox>

          <PermissionGate permission="editRecord">
            <Form form={form} layout="vertical">
              <Form.Item name="assigneeName" label="经办人">
                <Select
                  showSearch
                  allowClear
                  placeholder="选择经办人"
                  optionFilterProp="label"
                  options={assignees.map((u) => ({ label: u.username, value: u.username }))}
                />
              </Form.Item>
              <Form.Item name="internalEvaluationDetail" label="内部评估">
                <Input.TextArea rows={3} placeholder="填写内部评估结论" />
              </Form.Item>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} placeholder="填写备注" />
              </Form.Item>
            </Form>
          </PermissionGate>

          <PermissionGate permission="editRecord">
            <div>
              <Typography.Text type="secondary">确立举措</Typography.Text>
              <div className="mt-2">
                <EstablishedActionFields
                  productKey={record?.productName || ''}
                  actionId={actionItem?.id || ''}
                  source="post_use"
                  establishedAction={actionDraft.establishedAction}
                  establishedActionDetail={actionDraft.establishedActionDetail}
                  actionSchedule={actionDraft.actionSchedule}
                  linkedFromLibrary={Boolean(actionItem?.id)}
                  onSelect={handleSelect}
                  onClear={handleClear}
                  onContentChange={handleContentChange}
                  onDetailChange={handleDetailChange}
                  onScheduleChange={handleScheduleChange}
                />
              </div>
            </div>
          </PermissionGate>
        </div>
      ) : null}
    </Drawer>
  )
}
