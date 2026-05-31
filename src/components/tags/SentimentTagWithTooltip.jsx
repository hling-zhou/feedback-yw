import { resolveTagDefinition } from '../../lib/tagDefinitions.js'
import SentimentBadge from '../SentimentBadge.jsx'
import TagDefinitionTooltip from './TagDefinitionTooltip.jsx'
import { URGENCY_DESCRIPTION } from '../../lib/sentiment.js'

/**
 * @param {Object} props
 * @param {import('../../lib/sentiment.js').Sentiment | string} [props.sentiment]
 * @param {{ sentiment?: string; urgencyLevel?: string }} [props.record]
 */
export default function SentimentTagWithTooltip({ sentiment, record }) {
  const def = resolveTagDefinition({
    dimension: 'sentiment',
    sentimentKey: sentiment ?? record?.sentiment,
  })
  const title =
    record?.urgencyLevel === 'high' || record?.sentiment === 'urgent'
      ? `${def.body}\n\n加急：${URGENCY_DESCRIPTION}`
      : def.body
  return (
    <TagDefinitionTooltip definition={{ ...def, body: title }}>
      <SentimentBadge sentiment={sentiment} record={record} />
    </TagDefinitionTooltip>
  )
}
