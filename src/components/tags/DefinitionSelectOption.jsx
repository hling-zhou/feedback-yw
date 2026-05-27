import { Tooltip } from 'antd'

/**
 * Ant Design Select optionRender：选项 hover 显示释义。
 *
 * @param {{ label?: import('react').ReactNode; data?: { title?: string } }} option
 */
export function renderDefinitionSelectOption(option) {
  const hint = option.data?.title
  const label = option.label ?? option.value
  if (!hint) return <span>{label}</span>
  return (
    <Tooltip title={hint} placement="right" mouseEnterDelay={0.3}>
      <span className="block w-full">{label}</span>
    </Tooltip>
  )
}
