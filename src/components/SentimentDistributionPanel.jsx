import { useMemo } from 'react'
import { Card, Tag, Typography } from 'antd'
import SentimentChart from './charts/SentimentChart.jsx'
import { sentimentStats } from '../lib/analytics.js'

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
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-ink-50 px-3 py-2 text-center">
              <Typography.Text type="secondary" className="block text-[10px]">
                工单总数
              </Typography.Text>
              <Typography.Text strong className="text-lg">
                {stats.total}
              </Typography.Text>
            </div>
            <div className="rounded-lg bg-red-50 px-3 py-2 text-center">
              <Typography.Text type="secondary" className="block text-[10px]">
                负面类占比
              </Typography.Text>
              <Typography.Text strong className="text-lg text-red-600">
                {stats.negativePct}%
              </Typography.Text>
              <Typography.Text type="secondary" className="block text-[10px]">
                {stats.negativeCount} 条
              </Typography.Text>
            </div>
            <div className="rounded-lg bg-brand-50 px-3 py-2 text-center">
              <Typography.Text type="secondary" className="block text-[10px]">
                最多情绪
              </Typography.Text>
              <Typography.Text strong className="text-sm">
                {stats.topLabel}
              </Typography.Text>
              <Typography.Text type="secondary" className="block text-[10px]">
                {stats.topCount} 条 · {stats.topPct}%
              </Typography.Text>
            </div>
          </div>

          <SentimentChart data={stats.distribution} total={stats.total} />

          <div className="mt-3 flex flex-wrap gap-2">
            {stats.distribution.map((d) => (
              <Tag key={d.key} className="!text-xs">
                {d.name} {d.value}（{d.pct}%）
              </Tag>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}
