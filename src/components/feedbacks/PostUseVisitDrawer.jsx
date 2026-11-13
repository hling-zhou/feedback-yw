import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Descriptions, Drawer, Form, Input, Popconfirm, Select, Space, Tag, Typography, message } from 'antd'
import { TICKET_DETAIL_DRAWER_WIDTH } from '../../constants/appLayout.js'
import { patchPostUseVisit } from '../../lib/postUseVisitClient.js'
import { listAssignees } from '../../lib/postUseJiraClient.js'
import { buildUserOption, userOptionFilterOption } from '../../lib/userSelectOptions.js'
import PostUseMultiActions from '../actions/PostUseMultiActions.jsx'
import PermissionGate from '../auth/PermissionGate.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import PostUseReportIssueLinker from './PostUseReportIssueLinker.jsx'
import PostUseAttachments from './PostUseAttachments.jsx'
import FieldEditorMeta from './FieldEditorMeta.jsx'

/** @typedef {import('../../lib/postUseRating/visitRecords.js').PostUseVisitRecord} PostUseVisitRecord */

/**
 * 省代表回访详情抽屉：展示回访信息，内部评估/备注可编辑（editRecord 权限）。
 * 2026-11-05 评估状态自动流转（对齐产品部溯源）：提交=已评估（内部评估必填）/ 暂存=评估中；
 * 状态由评估字段 + evaluationSubmitted 派生，visit: 前缀个人标记体系下线。
 *
 * @param {object} props
 * @param {PostUseVisitRecord | null} props.record
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(record: PostUseVisitRecord) => void} props.onSaved
 */
export default function PostUseVisitDrawer({ record, open, onClose, onSaved }) {
  const { can } = useAuth()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [assignees, setAssignees] = useState([])
  const latestRecordRef = useRef(record)
  useEffect(() => { latestRecordRef.current = record }, [record])

  // 评估状态派生（2026-11-05）：空=待评估 / 非空未提交=评估中 / 已提交=已评估
  const evaluationState = useMemo(() => {
    const evaluation = String(record?.internalEvaluationDetail || record?.internalConclusion || '').trim()
    if (record?.evaluationSubmitted) return '已评估'
    if (evaluation) return '评估中'
    return '待评估'
  }, [record?.internalEvaluationDetail, record?.internalConclusion, record?.evaluationSubmitted])

  useEffect(() => {
    if (!open) return
    listAssignees()
      .then((res) => setAssignees(res?.users || []))
      .catch(() => {})
  }, [open])

  // 关联举措即时更新 record 时，不覆盖尚未暂存的评估、备注等表单草稿。
  useEffect(() => {
    if (open && record) {
      form.setFieldsValue({
        internalEvaluationDetail: record.internalEvaluationDetail || record.internalConclusion || '',
        remark: record.remark || '',
        assigneeName: record.assigneeName || '',
      })
    }
  }, [open, record?.id, form])

  // 2026-11-05 状态自动流转：提交=已评估（内部评估必填校验）/ 暂存=评估中（不校验）；成功后都关抽屉
  const handleSave = async (mode = 'draft', currentRecord = record, values = form.getFieldsValue()) => {
    if (!currentRecord?.id) return
    const patch = { baseUpdatedAt: currentRecord.updatedAt }
    const evaluation = String(values.internalEvaluationDetail || '')
    const remark = String(values.remark || '')
    const assigneeName = String(values.assigneeName || '')
    if (evaluation !== String(currentRecord.internalEvaluationDetail || currentRecord.internalConclusion || '')) {
      patch.internalEvaluationDetail = evaluation
    }
    if (remark !== String(currentRecord.remark || '')) patch.remark = remark
    if (assigneeName !== String(currentRecord.assigneeName || '')) patch.assigneeName = assigneeName
    if ((mode === 'submit') !== Boolean(currentRecord.evaluationSubmitted)) {
      patch.evaluationSubmitted = mode === 'submit'
    }
    if (Object.keys(patch).length === 1) {
      message.success('没有需要保存的变化')
      onClose?.()
      return
    }
    setSaving(true)
    try {
      const data = await patchPostUseVisit(currentRecord.id, patch)
      const item = data?.item
      if (item) {
        message.success(mode === 'submit' ? '评估已完成' : '已暂存')
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

  /** 举措在区块内逐条保存；页脚仅保存经办人、评估和备注。 */
  const handleSaveAll = async (mode = 'draft') => {
    if (mode === 'submit') {
      try {
        await form.validateFields()
      } catch {
        return
      }
    }
    await handleSave(mode, latestRecordRef.current, form.getFieldsValue())
  }

  const handleActionOwnerSaved = (item) => {
    latestRecordRef.current = item
    onSaved?.(item)
  }

  const EVALUATION_TAG = /** @type {Record<string, string>} */ ({
    待评估: 'default',
    评估中: 'processing',
    已评估: 'success',
  })

  return (
    <Drawer
      title={
        <Space size={8}>
          <span>省代表回访</span>
          <Tag color={EVALUATION_TAG[evaluationState] || 'default'}>{evaluationState}</Tag>
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
            <Button loading={saving} onClick={() => void handleSaveAll('draft')}>
              暂存
            </Button>
            {/* 2026-11-05 用户拍板：完成前显式提示——评估完结才点完成，过程性评估走暂存；2026-11-09 按钮文案改「评估完成」 */}
            <Popconfirm
              title="请务必在内部评估完结后再标记完成"
              description="过程性评估保存可点击「暂存」（暂存状态为评估中，可随时继续编辑）。"
              okText="确认完成"
              cancelText="再想想"
              onConfirm={() => void handleSaveAll('submit')}
            >
              <Button type="primary" loading={saving}>
                评估完成
              </Button>
            </Popconfirm>
          </div>
        </PermissionGate>
      }
    >
      {record ? (
        <div className="space-y-4">
          <div>
            <Typography.Text type="secondary">基础信息</Typography.Text>
            <Descriptions size="small" column={1} className="mt-2" bordered labelStyle={{ whiteSpace: 'nowrap' }}>
              <Descriptions.Item label="数据月份">{record.importMonth || record.visitMonth || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户名称">{record.groupName || record.customerName || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户编码">{record.customerCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="登录账号名称">{record.loginAccountName || '—'}</Descriptions.Item>
              <Descriptions.Item label="产品名称">{record.productName || '—'}</Descriptions.Item>
              <Descriptions.Item label="用户反馈原文">{record.userFeedbackText || '—'}</Descriptions.Item>
              <Descriptions.Item label="回访结果">{record.visitResult || '—'}</Descriptions.Item>
              {record.scoreSource === '投诉回访' && (
                <Descriptions.Item label="相应投诉工单">{record.originalTicketId || '—'}</Descriptions.Item>
              )}
              <Descriptions.Item label="涉及评价">{record.ratingText || '—'}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{record.updatedAt || '—'}</Descriptions.Item>
            </Descriptions>
          </div>

          {/* 2026-11-05：个人标记勾选移除（visit: 前缀体系下线），评估状态由操作自动流转 */}

          <PermissionGate permission="editRecord">
            <Form form={form} layout="vertical">
              <Form.Item name="assigneeName" label="经办人">
                <Select
                  showSearch
                  allowClear
                  placeholder="选择经办人"
                  filterOption={userOptionFilterOption}
                  options={assignees.map((u) => ({ ...buildUserOption(u, assignees), value: u.username }))}
                />
              </Form.Item>
              {/* 提交时必填校验（暂存不触发）——2026-11-05 状态自动流转 */}
              <Form.Item
                name="internalEvaluationDetail"
                label="内部评估"
                rules={[{ required: true, message: '提交前请填写内部评估' }]}
              >
                <Input.TextArea rows={3} placeholder="填写内部评估结论" />
              </Form.Item>
              <FieldEditorMeta meta={record.fieldEditMeta?.internalEvaluation} />
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} placeholder="填写备注" />
              </Form.Item>
            </Form>
          </PermissionGate>
          {!can('editRecord') && (
            <div>
              <Typography.Text type="secondary">内部评估</Typography.Text>
              <div className="mt-2 whitespace-pre-wrap text-sm">
                {record.internalEvaluationDetail || record.internalConclusion || '—'}
              </div>
              <FieldEditorMeta meta={record.fieldEditMeta?.internalEvaluation} />
            </div>
          )}

          <PostUseAttachments ownerType="visit" ownerId={record.id} open={open} canEdit={can('editRecord')} />
          <PostUseMultiActions
            ownerType="visit"
            ownerId={record.id}
            productKey={record.productName || ''}
            open={open}
            canEdit={can('editRecord')}
            onOwnerSaved={handleActionOwnerSaved}
          />
          <PostUseReportIssueLinker sourceType="visit" sourceId={record.id} open={open} canEdit={can('editRecord')} />
        </div>
      ) : null}
    </Drawer>
  )
}
