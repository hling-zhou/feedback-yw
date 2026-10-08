import { Tooltip } from 'antd'
import { RobotOutlined } from '@ant-design/icons'

/**
 * @param {{ onClick: () => void }} props
 */
export default function AssistantFab({ onClick }) {
  return (
    <Tooltip title="AI 助手" placement="left">
      <button
        type="button"
        aria-label="AI 助手"
        className="assistant-fab"
        onClick={onClick}
      >
        <RobotOutlined className="assistant-fab__icon" />
      </button>
    </Tooltip>
  )
}
