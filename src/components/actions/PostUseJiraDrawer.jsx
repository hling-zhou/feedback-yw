import { useEffect, useState } from 'react'
import { Button, Descriptions, Drawer, Form, Input, Popconfirm, Select, Space, Tag, Typography } from 'antd'
import { ACTION_ITEM_DRAWER_WIDTH } from '../../constants/appLayout.js'
import { listAssignees } from '../../lib/postUseJiraClient.js'
import { buildUserOption, userOptionFilterOption } from '../../lib/userSelectOptions.js'
import PostUseMultiActions from './PostUseMultiActions.jsx'
import PostUseReportIssueLinker from '../feedbacks/PostUseReportIssueLinker.jsx'
import PostUseAttachments from '../feedbacks/PostUseAttachments.jsx'
import FieldEditorMeta from '../feedbacks/FieldEditorMeta.jsx'

/**
 * @param {object} props
 * @param {Record<string, any> | null} props.item
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('antd').FormInstance} props.form
 * @param {boolean} props.canEdit
 * @param {boolean} props.saving
 * @param {(mode: 'submit' | 'draft') => void} props.onSave 2026-11-05：状态自动流转——提交→已处理 / 暂存→处理中；提交校验回溯结果必填
 * @param {(item: Record<string, any>) => void} [props.onActionOwnerSaved]
 */
export default function PostUseJiraDrawer({
  item,
  open,
  onClose,
  form,
  canEdit,
  saving,
  onSave,
  onActionOwnerSaved,
}) {
  const [assignees, setAssignees] = useState([])

  useEffect(() => {
    if (!open) return
    listAssignees()
      .then((res) => setAssignees(res?.users || []))
      .catch(() => {})
  }, [open])

  return (
    <Drawer
      title={
        <Space size={8}>
          <span>产品部溯源</span>
          <Tag color={{ 待处理: 'default', 处理中: 'processing', 已处理: 'success' }[item?.status] || 'default'}>
            {item?.status || '待处理'}
          </Tag>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={ACTION_ITEM_DRAWER_WIDTH}
      destroyOnClose
      footer={
        canEdit ? (
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button loading={saving} onClick={() => onSave('draft')}>
              暂存
            </Button>
            {/* 2026-11-05 用户拍板：完成前显式提示——回溯完结才点完成，过程性进展走暂存；2026-11-09 按钮文案改「回溯完成」 */}
            <Popconfirm
              title="请务必在回溯完结后再标记完成"
              description="过程性进展保存可点击「暂存」（暂存状态为处理中，可随时继续编辑）。"
              okText="确认完成"
              cancelText="再想想"
              onConfirm={() => onSave('submit')}
            >
              <Button type="primary" loading={saving}>
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
            <FieldEditorMeta meta={item.progressEditMeta} />
          </Form>

          <PostUseAttachments ownerType="trace" ownerId={item.id} open={open} canEdit={canEdit} />
          <PostUseMultiActions
            ownerType="trace"
            ownerId={item.id}
            productKey={item.productName || ''}
            open={open}
            canEdit={canEdit}
            onOwnerSaved={onActionOwnerSaved}
          />
          <PostUseReportIssueLinker sourceType="trace" sourceId={/** @type {any} */ (item).id} open={open} canEdit={canEdit} />
        </div>
      ) : null}
    </Drawer>
  )
}
