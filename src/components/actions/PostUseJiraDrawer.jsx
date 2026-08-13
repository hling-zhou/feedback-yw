import { Button, Descriptions, Drawer, Form, Input, Select, Space, Typography } from 'antd'
import { ACTION_ITEM_DRAWER_WIDTH } from '../../constants/appLayout.js'
import { POST_USE_JIRA_STATUSES } from '../../domain/postUseJira.js'

/**
 * @param {object} props
 * @param {object | null} props.item
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('antd').FormInstance} props.form
 * @param {boolean} props.canEdit
 * @param {boolean} props.saving
 * @param {() => void} props.onSave
 */
export default function PostUseJiraDrawer({
  item,
  open,
  onClose,
  form,
  canEdit,
  saving,
  onSave,
}) {
  return (
    <Drawer
      title="用后即评JIRA"
      open={open}
      onClose={onClose}
      width={ACTION_ITEM_DRAWER_WIDTH}
      destroyOnClose
      extra={
        canEdit ? (
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={onSave}>
              保存
            </Button>
          </Space>
        ) : null
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
            </Descriptions>
          </div>
          <Form form={form} layout="vertical" disabled={!canEdit}>
            <Form.Item name="jiraTicket" label="JIRA工单">
              <Input placeholder="填写 JIRA 工单号或链接" />
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
        </div>
      ) : null}
    </Drawer>
  )
}
