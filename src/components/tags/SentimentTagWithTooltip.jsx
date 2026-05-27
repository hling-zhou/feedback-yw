import { resolveTagDefinition } from '../../lib/tagDefinitions.js'
import SentimentBadge from '../SentimentBadge.jsx'
import TagDefinitionTooltip from './TagDefinitionTooltip.jsx'

/**
 * @param {Object} props
 * @param {import('../../lib/sentiment.js').Sentiment | string} props.sentiment
 */
export default function SentimentTagWithTooltip({ sentiment }) {
  const def = resolveTagDefinition({ dimension: 'sentiment', sentimentKey: sentiment })
  return (
    <TagDefinitionTooltip definition={def}>
      <SentimentBadge sentiment={sentiment} />
    </TagDefinitionTooltip>
  )
}
