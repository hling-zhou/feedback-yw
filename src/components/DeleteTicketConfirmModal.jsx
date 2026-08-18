import { useEffect, useState } from 'react'
import { Alert, Input, Modal, Typography } from 'antd'
import {
  DELETE_TICKET_CONFIRM_PHRASE,
  matchesDeleteTicketConfirmPhrase,
} from '../lib/deleteTicketConfirm.js'

/**
 * @param {{
 *   open: boolean
 *   ticketId?: string
 *   confirming?: boolean
 *   onCancel: () => void
 *   onConfirm: () => void | Promise<void>
 * }} props
 */
export default function DeleteTicketConfirmModal({
  open,
  ticketId,
  confirming = false,
  onCancel,
  onConfirm,
}) {
  const [phrase, setPhrase] = useState('')

  useEffect(() => {
    if (open) setPhrase('')
  }, [open])

  const matched = matchesDeleteTicketConfirmPhrase(phrase)

  return (
    <Modal
      title="确认删除工单"
      open={open}
      onCancel={onCancel}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ danger: true, disabled: !matched, loading: confirming }}
      onOk={onConfirm}
      destroyOnClose
    >
      <div className="space-y-3">
        <Alert
          type="warning"
          showIcon
          message="删除后无法恢复"
          description={
            ticketId
              ? `将删除工单 ${ticketId}。补录工单没有系统标识，请人工确认后再删。`
              : '补录工单没有系统标识，请人工确认后再删。'
          }
        />
        <div>
          <Typography.Paragraph className="!mb-2">
            请复制并粘贴
            <Typography.Text className="mx-1" copyable={{ text: DELETE_TICKET_CONFIRM_PHRASE }} code>
              {DELETE_TICKET_CONFIRM_PHRASE}
            </Typography.Text>
            到下方输入框，再点击确定。
          </Typography.Paragraph>
          <Input
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            placeholder={`请粘贴：${DELETE_TICKET_CONFIRM_PHRASE}`}
            autoFocus
          />
        </div>
      </div>
    </Modal>
  )
}
