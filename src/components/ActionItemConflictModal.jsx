import { Button, Modal, Table, Typography } from 'antd'
import { buildActionItemConflictDiff } from '../lib/actionItemConflictDiff.js'
import { formatActionItemUpdatedByLine } from '../domain/actionItemRevision.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../domain/actionItem.js').ActionItemStatus} ActionItemStatus */

/**
 * @param {{
 *   open: boolean
 *   actionLabel?: string
 *   serverItem: ActionItem | null
 *   draft: { content: string; status: ActionItemStatus; scheduleAt: string }
 *   onReloadLatest: () => void
 *   onForceSave: () => void
 *   onCancel: () => void
 *   forceSaving?: boolean
 * }} props
 */
export default function ActionItemConflictModal({
  open,
  actionLabel,
  serverItem,
  draft,
  onReloadLatest,
  onForceSave,
  onCancel,
  forceSaving = false,
}) {
  const diffRows = buildActionItemConflictDiff(serverItem, draft)
  const updatedLine = formatActionItemUpdatedByLine(serverItem)

  return (
    <Modal
      title={`保存冲突${actionLabel ? ` — ${actionLabel}` : ''}`}
      open={open}
      onCancel={onCancel}
      destroyOnClose
      width={640}
      okText="仍用我的修改覆盖"
      okButtonProps={{ danger: true, loading: forceSaving }}
      onOk={onForceSave}
      cancelText="取消"
      footer={(_, { OkBtn, CancelBtn }) => (
        <div className="flex flex-wrap justify-end gap-2">
          <CancelBtn />
          <Button onClick={onReloadLatest}>加载最新并放弃我的修改</Button>
          <OkBtn />
        </div>
      )}
    >
      <Typography.Paragraph type="secondary" className="!mb-3 text-sm">
        此举措在您编辑期间已被他人更新。
        {updatedLine ? ` 最近更新：${updatedLine}。` : ''}
      </Typography.Paragraph>
      {diffRows.length ? (
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={diffRows}
          columns={[
            { title: '字段', dataIndex: 'label', width: 88 },
            {
              title: '服务器当前',
              dataIndex: 'server',
              render: (text) => (
                <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-xs">
                  {text}
                </Typography.Paragraph>
              ),
            },
            {
              title: '你的修改',
              dataIndex: 'yours',
              render: (text) => (
                <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-xs">
                  {text}
                </Typography.Paragraph>
              ),
            },
          ]}
        />
      ) : (
        <Typography.Text type="secondary" className="text-sm">
          可编辑字段内容相同，但版本号已变化。建议加载最新后再保存。
        </Typography.Text>
      )}
    </Modal>
  )
}
