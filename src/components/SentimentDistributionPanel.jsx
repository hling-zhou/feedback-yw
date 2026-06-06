import { useMemo } from 'react'
import { Card, Typography } from 'antd'
import SentimentChart from './charts/SentimentChart.jsx'
import { sentimentStats } from '../lib/analytics.js'

/**
 * @param {{ label: string; children: import('react').ReactNode; tone?: 'default' | 'negative' | 'urgent' | 'accent' }}
 */
function SentimentStatCell({ label, children, tone = 'default' }) {
  const toneClass =
    tone === 'negative'
      ? 'border-red-100 bg-red-50/70'
      : tone === 'urgent'
        ? 'border-rose-100 bg-rose-50/70'
        : tone === 'accent'
          ? 'border-brand-100 bg-brand-50/70'
          : 'border-ink-100 bg-ink-50/80'

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums leading-snug text-ink-900">
        {children}
      </div>
    </div>
  )
}

/**
 * @param {{
 *   items: import('../lib/types.js').FeedbackRecord[];
 *   title?: string;
 *   subtitle?: string;
 *   className?: string;
 * }}
 */
export default function SentimentDistributionPanel({
  items,
  title = '用户情绪分布',
  subtitle,
  className,
}) {
  const stats = useMemo(() => sentimentStats(items), [items])

  return (
    <Card
      className={className}
      title={<Typography.Text strong>{title}</Typography.Text>}
      extra={
        subtitle ? (
          <Typography.Text type="secondary" className="text-xs">
            {subtitle}
          </Typography.Text>
        ) : null
      }
    >
      {stats.total === 0 ? (
        <Typography.Text type="secondary">暂无数据</Typography.Text>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SentimentStatCell label="工单总数">{stats.total}</SentimentStatCell>
            <SentimentStatCell label="负面类" tone="negative">
              <span className="text-red-600">
                {stats.negativeCount}（{stats.negativePct}%）
              </span>
            </SentimentStatCell>
            <SentimentStatCell label="加急" tone="urgent">
              <span className="text-rose-600">
                {stats.urgentCount}（{stats.urgentPct}%）
              </span>
            </SentimentStatCell>
            <SentimentStatCell label="最多情绪" tone="accent">
              <span className="text-brand-700">
                {stats.topLabel} {stats.topCount}（{stats.topPct}%）
              </span>
            </SentimentStatCell>
          </div>

          <SentimentChart data={stats.distribution} total={stats.total} />
        </>
      )}
    </Card>
  )
}
