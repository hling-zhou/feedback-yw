import { Space, Tag } from 'antd'
import {
  getUrgencyLevel,
  normalizeSentiment,
  SENTIMENT_COLORS,
  SENTIMENT_LABELS,
  SENTIMENT_TAG_COLORS,
  URGENCY_LABELS,
  URGENCY_TAG_COLOR,
} from '../lib/sentiment.js'

/**
 * @param {Object} props
 * @param {import('../lib/sentiment.js').Sentiment | string} props.sentiment
 * @param {import('../lib/sentiment.js').UrgencyLevel | string} [props.urgencyLevel]
 * @param {{ sentiment?: string; urgencyLevel?: string }} [props.record] - 可传整条记录以解析加急
 */
export default function SentimentBadge({ sentiment, urgencyLevel, record }) {
  const key = normalizeSentiment(sentiment ?? record?.sentiment)
  const color = SENTIMENT_TAG_COLORS[key] || 'default'
  const urgent = getUrgencyLevel(
    urgencyLevel != null
      ? { urgencyLevel, sentiment: sentiment ?? record?.sentiment }
      : record ?? { sentiment },
  )

  return (
    <Space size={4} wrap>
      <Tag color={color} className={SENTIMENT_COLORS[key] ? '' : undefined}>
        {SENTIMENT_LABELS[key] || sentiment}
      </Tag>
      {urgent === 'high' ? (
        <Tag color={URGENCY_TAG_COLOR}>{URGENCY_LABELS.high}</Tag>
      ) : null}
    </Space>
  )
}
