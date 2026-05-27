import { Button, Tooltip } from 'antd'
import { IMPORT_REBUILD_DISABLED_TIP } from '../../lib/importSession.js'

/**
 * @param {Object} props
 * @param {boolean} [props.loading]
 * @param {boolean} [props.disabled]
 * @param {string} [props.disabledTip]
 * @param {() => void} [props.onClick]
 * @param {'small' | 'middle' | 'large'} [props.size]
 * @param {'primary' | 'default' | 'link' | 'text' | 'dashed'} [props.type]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} [props.children]
 */
export default function RebuildInsightsButton({
  loading,
  disabled,
  disabledTip = IMPORT_REBUILD_DISABLED_TIP,
  onClick,
  size,
  type = 'primary',
  className,
  children = '生成 / 刷新洞察',
}) {
  const btn = (
    <Button
      type={type}
      size={size}
      className={className}
      loading={loading}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
  if (!disabled) return btn
  return (
    <Tooltip title={disabledTip}>
      <span className="inline-block">{btn}</span>
    </Tooltip>
  )
}
