import { Tooltip } from 'antd'
import { MailOutlined } from '@ant-design/icons'

/**
 * @param {{ onClick: () => void }} props
 */
export default function ReminderFab({ onClick }) {
  return (
    <Tooltip title="发送提醒邮件" placement="left">
      <button
        type="button"
        aria-label="发送提醒邮件"
        className="reminder-fab"
        onClick={onClick}
      >
        <MailOutlined className="reminder-fab__icon" />
      </button>
    </Tooltip>
  )
}
