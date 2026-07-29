import { Badge, Tooltip } from 'antd'
import { NotificationOutlined } from '@ant-design/icons'

/**
 * @param {{
 *   onClick: () => void
 *   hasUnread?: boolean
 * }} props
 */
export default function WhatsNewFab({ onClick, hasUnread = false }) {
  return (
    <Tooltip title="更新动态" placement="left">
      <Badge dot={hasUnread} offset={[-2, 2]}>
        <button
          type="button"
          aria-label="更新动态"
          className="whats-new-fab"
          onClick={onClick}
        >
          <NotificationOutlined className="whats-new-fab__icon" />
        </button>
      </Badge>
    </Tooltip>
  )
}
