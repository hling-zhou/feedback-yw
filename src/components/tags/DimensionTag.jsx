import { Tag } from 'antd'
import { resolveTagDefinition } from '../../lib/tagDefinitions.js'
import TagDefinitionTooltip from './TagDefinitionTooltip.jsx'

/**
 * @param {Object} props
 * @param {import('../../lib/tagDefinitions.js').TagDimension} props.dimension
 * @param {string} [props.label]
 * @param {string} [props.displayLabel]
 * @param {import('../../lib/sentiment.js').Sentiment | string} [props.sentimentKey]
 * @param {{ requestScenes?: object[]; problemTypes?: object[]; journeys?: object[] } | null} [props.taxonomy]
 * @param {string} [props.color] ant Tag color
 */
export default function DimensionTag({
  dimension,
  label = '',
  displayLabel,
  sentimentKey,
  taxonomy = null,
  color,
}) {
  const def = resolveTagDefinition({
    dimension,
    label,
    sentimentKey,
    taxonomy,
  })
  const text = displayLabel ?? (label || '未分类')

  return (
    <TagDefinitionTooltip definition={def}>
      <Tag color={color} className="!mr-0">
        {text}
      </Tag>
    </TagDefinitionTooltip>
  )
}
