import { Tag } from 'antd'
import {
  normalizeSentiment,
  SENTIMENT_COLORS,
  SENTIMENT_LABELS,
  SENTIMENT_TAG_COLORS,
} from '../lib/sentiment.js'

export default function SentimentBadge({ sentiment }) {
  const key = normalizeSentiment(sentiment)
  const color = SENTIMENT_TAG_COLORS[key] || 'default'

  return (
    <Tag color={color} className={SENTIMENT_COLORS[key] ? '' : undefined}>
      {SENTIMENT_LABELS[key] || sentiment}
    </Tag>
  )
}
