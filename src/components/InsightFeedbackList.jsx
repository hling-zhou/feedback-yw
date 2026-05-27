import { Button, Card, Empty, Space, Tag, Typography } from 'antd'
import SimpleList from './ui/SimpleList.jsx'
import SentimentBadge from './SentimentBadge.jsx'
import { topSolutionsByJourney } from '../lib/productAnalytics.js'

/**
 * @param {{
 *   items: import('../lib/types.js').FeedbackRecord[];
 *   title: string;
 *   subtitle?: string;
 *   journeyL1?: string;
 *   journeyL2?: string;
 *   onItemClick?: (fb: import('../lib/types.js').FeedbackRecord) => void;
 *   onMarkActioned?: () => void;
 *   onClear?: () => void;
 *   emptyHint?: string;
 * }}
 */
export default function InsightFeedbackList({
  items,
  title,
  subtitle,
  journeyL1,
  journeyL2,
  onItemClick,
  onMarkActioned,
  onClear,
  emptyHint = '点击左侧条目查看工单明细',
}) {
  const solutions = topSolutionsByJourney(items, journeyL1, journeyL2)

  return (
    <Card className="flex min-h-[320px] flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Typography.Title level={5} className="!mb-0">{title}</Typography.Title>
          {subtitle && (
            <Typography.Text type="secondary" className="mt-1 block text-xs">
              {subtitle}
            </Typography.Text>
          )}
        </div>
        <Space className="shrink-0">
          {onMarkActioned && items.length > 0 && (
            <Button size="small" onClick={onMarkActioned}>
              全部标为已行动
            </Button>
          )}
          {onClear && (
            <Button type="link" size="small" onClick={onClear}>
              清除
            </Button>
          )}
        </Space>
      </div>

      {solutions.length > 0 && (
        <div className="mt-4 rounded-lg bg-ink-50 p-3">
          <Typography.Text strong className="text-xs">常见解决方案</Typography.Text>
          <ul className="mt-2 space-y-1 text-xs text-ink-600">
            {solutions.map((s) => (
              <li key={s.text}>
                <Tag className="mr-2">{s.count}</Tag>
                {s.text}…
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex-1 space-y-2 overflow-y-auto max-h-[480px]">
        {items.length === 0 ? (
          <Empty className="py-8" description={emptyHint} />
        ) : (
          <SimpleList
            dataSource={items.slice(0, 50)}
            renderItem={(fb) => (
              <div
                role="button"
                tabIndex={0}
                className="cursor-pointer rounded-lg border border-ink-100 px-3 py-3 hover:border-brand-200 hover:bg-brand-50/20"
                onClick={() => onItemClick?.(fb)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onItemClick?.(fb)
                }}
              >
                <div className="flex flex-wrap gap-1.5">
                  <SentimentBadge sentiment={fb.sentiment} />
                  <Tag color="blue">{fb.requestScene || '未分类'}</Tag>
                  <Tag>{fb.problemType || '未分类'}</Tag>
                  {fb.journeyL1 && <Tag color="blue">{fb.journeyL1}</Tag>}
                  {fb.resourcePool && <Tag>{fb.resourcePool}</Tag>}
                </div>
                <Typography.Paragraph className="!mb-0 !mt-2 font-medium line-clamp-2">
                  {fb.problemSummary || fb.customerQuote || '—'}
                </Typography.Paragraph>
                {fb.solutionSummary && (
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 !text-xs line-clamp-2">
                    <span className="font-medium">方案：</span>
                    {fb.solutionSummary}
                  </Typography.Paragraph>
                )}
                {fb.optimizationSuggestion && (
                  <Typography.Paragraph className="!mb-0 !mt-1 !text-xs !text-brand-700 line-clamp-1">
                    <span className="font-medium text-ink-500">建议：</span>
                    {fb.optimizationSuggestion}
                  </Typography.Paragraph>
                )}
                <Typography.Text type="secondary" className="mt-2 block text-[10px]">
                  {fb.ticketId || '—'} · {fb.product || '—'}
                  {fb.productSpec && fb.productSpec !== fb.product ? ` / ${fb.productSpec}` : ''} ·{' '}
                  {fb.createdAt || '—'}
                </Typography.Text>
              </div>
            )}
          />
        )}
        {items.length > 50 && (
          <Typography.Text type="secondary" className="block text-center text-xs">
            仅展示前 50 条
          </Typography.Text>
        )}
      </div>
    </Card>
  )
}
