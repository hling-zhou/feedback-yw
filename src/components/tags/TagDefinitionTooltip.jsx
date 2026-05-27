import { Tooltip, Typography } from 'antd'

/**
 * @param {Object} props
 * @param {import('../../lib/tagDefinitions.js').TagDefinition} props.definition
 * @param {import('react').ReactNode} props.children
 */
export default function TagDefinitionTooltip({ definition, children }) {
  return (
    <Tooltip
      placement="top"
      styles={{ root: { maxWidth: 360 } }}
      title={
        <div className="text-xs leading-relaxed">
          <Typography.Text strong className="!text-white">
            {definition.title}
          </Typography.Text>
          <div className="mt-1 text-white/90">{definition.body}</div>
        </div>
      }
    >
      <span className="inline-flex cursor-help">{children}</span>
    </Tooltip>
  )
}
