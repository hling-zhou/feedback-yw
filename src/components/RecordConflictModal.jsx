import { Modal, Table, Typography, Button } from 'antd'
import {
  buildRecordConflictDiff,
  formatRecordUpdatedByLine,
} from '../lib/recordConflictDiff.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * @param {{
 *   open: boolean
 *   ticketLabel?: string
 *   serverRecord: FeedbackRecord | null
 *   draftRecord: FeedbackRecord
 *   onReloadLatest: () => void
 *   onForceSave: () => void
 *   onCancel: () => void
 *   forceSaving?: boolean
 *   canForceSave?: boolean
 * }} props
 */
export default function RecordConflictModal({
  open,
  ticketLabel,
  serverRecord,
  draftRecord,
  onReloadLatest,
  onForceSave,
  onCancel,
  forceSaving = false,
  canForceSave = true,
}) {
  const diffRows = buildRecordConflictDiff(serverRecord, draftRecord)
  const updatedLine = formatRecordUpdatedByLine(serverRecord)

  return (
    <Modal
      title={`保存冲突${ticketLabel ? ` — ${ticketLabel}` : ''}`}
      open={open}
      onCancel={onCancel}
      destroyOnClose
      width={720}
      okText="仍用我的修改覆盖"
      okButtonProps={{ danger: true, disabled: !canForceSave, loading: forceSaving }}
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
        此工单在您编辑期间已被他人更新。以下字段与服务器当前版本不一致。
        {updatedLine ? ` 最近更新：${updatedLine}。` : ''}
      </Typography.Paragraph>
      {diffRows.length ? (
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={diffRows}
          columns={[
            { title: '字段', dataIndex: 'label', width: 120 },
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
          可编辑字段内容相同，但版本号已变化（可能由批量任务更新）。建议加载最新后再保存。
        </Typography.Text>
      )}
    </Modal>
  )
}
