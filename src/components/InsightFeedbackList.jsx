import { Card, Empty, Tag, Typography } from 'antd'
import SimpleList from './ui/SimpleList.jsx'
import SentimentBadge from './SentimentBadge.jsx'
import { topCommonOptimizations } from '../lib/productAnalytics.js'
import {
  formatListOptimizationPreview,
  getDisplayCustomerRequest,
  getDisplayPainPoint,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'

/**
 * @param {{
 *   items: import('../lib/types.js').FeedbackRecord[];
 *   title: string;
 *   subtitle?: string;
 *   journeyL1?: string;
 *   journeyL2?: string;
 *   onItemClick?: (fb: import('../lib/types.js').FeedbackRecord) => void;
 *   emptyHint?: string;
 *   fillHeight?: boolean;
 * }}
 */
export default function InsightFeedbackList({
  items,
  title,
  subtitle,
  journeyL1,
  journeyL2,
  onItemClick,
  emptyHint = '暂无工单',
  fillHeight = false,
}) {
  const solutions = topCommonOptimizations(items, journeyL1, journeyL2)

  return (
    <Card
      className={`flex flex-col ${fillHeight ? 'min-h-0 h-full max-h-full' : 'min-h-[320px]'}`}
      styles={{ body: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }}
    >
      <div>
        <Typography.Title level={5} className="!mb-0">{title}</Typography.Title>
        {subtitle && (
          <Typography.Text type="secondary" className="mt-1 block text-xs">
            {subtitle}
          </Typography.Text>
        )}
      </div>

      {solutions.length > 0 && (
        <div className="mt-4 shrink-0 rounded-lg bg-ink-50 p-3">
          <Typography.Text strong className="text-xs">常见优化建议</Typography.Text>
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

      <div
        className={`mt-4 flex-1 space-y-2 overflow-y-auto ${fillHeight ? 'min-h-0' : 'max-h-[480px]'}`}
      >
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
                  <SentimentBadge record={fb} />
                  <Tag color="blue">{fb.requestScene || '未分类'}</Tag>
                  <Tag>{fb.problemType || '未分类'}</Tag>
                  {fb.journeyL1 && <Tag color="blue">{fb.journeyL1}</Tag>}
                  {fb.resourcePool && <Tag>{fb.resourcePool}</Tag>}
                </div>
                <Typography.Paragraph className="!mb-0 !mt-2 font-medium line-clamp-2">
                  {getDisplayCustomerRequest(fb) || getDisplayPainPoint(fb) || '—'}
                </Typography.Paragraph>
                {getDisplayPainPoint(fb) && getDisplayCustomerRequest(fb) && (
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 !text-xs line-clamp-2">
                    <span className="font-medium">痛点：</span>
                    {getDisplayPainPoint(fb)}
                  </Typography.Paragraph>
                )}
                {(fb.optimizationProduct || fb.optimizationService) && (
                  <Typography.Paragraph className="!mb-0 !mt-1 !text-xs !text-brand-700 line-clamp-2">
                    <span className="font-medium text-ink-500">建议：</span>
                    {formatListOptimizationPreview(fb)}
                  </Typography.Paragraph>
                )}
                {!fb.optimizationProduct && !fb.optimizationService && fb.optimizationSuggestion && (
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
