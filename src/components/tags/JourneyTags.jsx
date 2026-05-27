import { Tag } from 'antd'
import { themesFromJourney } from '../../lib/applyThemes.js'
import { resolveJourneyDefinition } from '../../lib/tagDefinitions.js'
import TagDefinitionTooltip from './TagDefinitionTooltip.jsx'

/**
 * @param {Object} props
 * @param {string} [props.journeyL1]
 * @param {string} [props.journeyL2]
 * @param {{ journeys?: object[] } | null} [props.taxonomy]
 * @param {number} [props.max]
 */
export default function JourneyTags({ journeyL1 = '', journeyL2 = '', taxonomy = null, max = 6 }) {
  const themes = themesFromJourney({ journeyL1, journeyL2 })
  const def = resolveJourneyDefinition({ taxonomy, journeyL1, journeyL2 })
  const shown = themes.slice(0, max)
  const rest = themes.length - shown.length

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <TagDefinitionTooltip key={t} definition={def}>
          <Tag className="!mr-0">{t}</Tag>
        </TagDefinitionTooltip>
      ))}
      {rest > 0 && <Tag className="!mr-0">+{rest}</Tag>}
    </div>
  )
}
