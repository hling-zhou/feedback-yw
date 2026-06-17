import { Tooltip, Typography, message } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { copyTextToClipboard } from '../../lib/clipboard.js'

/**
 * @param {{ text?: string | null; className?: string }} props
 */
export default function CopyableEllipsisCell({ text, className }) {
  const value = text?.trim() || ''
  if (!value) return <Typography.Text type="secondary">—</Typography.Text>

  const handleCopy = async (event) => {
    event.stopPropagation()
    const ok = await copyTextToClipboard(value)
    if (ok) message.success('已复制')
    else message.error('复制失败')
  }

  return (
    <Tooltip title={value} getPopupContainer={() => document.body}>
      <span className={`inline-flex max-w-full items-center gap-1 ${className || ''}`}>
        <Typography.Text className="min-w-0 flex-1" ellipsis>
          {value}
        </Typography.Text>
        <CopyOutlined
          className="shrink-0 cursor-pointer text-ink-400 hover:text-brand-600"
          onClick={(event) => void handleCopy(event)}
          role="button"
          aria-label="复制"
        />
      </span>
    </Tooltip>
  )
}
