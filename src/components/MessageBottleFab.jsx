import { Tooltip } from 'antd'
import MessageBottleIcon from './MessageBottleIcon.jsx'

/**
 * @param {{ onClick: () => void }} props
 */
export default function MessageBottleFab({ onClick }) {
  return (
    <Tooltip title="不好用？有更多点子？戳我戳我" placement="left">
      <button
        type="button"
        aria-label="提交漂流瓶"
        className="message-bottle-fab"
        onClick={onClick}
      >
        <MessageBottleIcon className="message-bottle-fab__icon" />
      </button>
    </Tooltip>
  )
}
