import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Collapse, Empty, Tag, Typography } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import SimpleList from './ui/SimpleList.jsx'
import SentimentBadge from './SentimentBadge.jsx'
import { topCommonOptimizations } from '../lib/productAnalytics.js'
import {
  formatListOptimizationPreview,
  getDisplayCustomerRequest,
  getDisplayPainPoint,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'

export const INSIGHT_FEEDBACK_PREVIEW_LIMIT = 20

/**
 * @param {{
 *   items: import('../lib/types.js').FeedbackRecord[];
 *   title: string;
 *   subtitle?: string;
 *   journeyL1?: string;
 *   journeyL2?: string;
 *   onItemClick?: (fb: import('../lib/types.js').FeedbackRecord) => void;
 *   emptyHint?: string;
 *   compact?: boolean;
 *   previewLimit?: number;
 *   viewAllHref?: string;
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
  compact = true,
  previewLimit = INSIGHT_FEEDBACK_PREVIEW_LIMIT,
  viewAllHref,
}) {
  const solutions = topCommonOptimizations(items, journeyL1, journeyL2)
  const previewItems = items.slice(0, previewLimit)
  const hasMore = items.length > previewLimit

  return (
    <Card className="min-h-[320px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Typography.Title level={5} className="!mb-0">
            {title}
          </Typography.Title>
          {subtitle && (
            <Typography.Text type="secondary" className="mt-1 block text-xs">
              {subtitle}
            </Typography.Text>
          )}
        </div>
        {hasMore && (
          <div className="shrink-0 pt-0.5 text-right">
            {viewAllHref ? (
              <Link to={viewAllHref} className="whitespace-nowrap text-xs text-brand-600 hover:text-brand-700">
                共 {items.length} 条 · 在反馈库查看全部
              </Link>
            ) : (
              <Typography.Text type="secondary" className="whitespace-nowrap text-xs">
                共 {items.length} 条 · 仅展示前 {previewLimit} 条
              </Typography.Text>
            )}
          </div>
        )}
      </div>

      {solutions.length > 0 && (
        <Collapse
          ghost
          size="small"
          defaultActiveKey={['solutions']}
          className="mt-3 !bg-transparent [&_.ant-collapse-header]:!px-0 [&_.ant-collapse-content-box]:!px-0 [&_.ant-collapse-content-box]:!pb-0"
          items={[
            {
              key: 'solutions',
              label: (
                <Typography.Text strong className="text-xs">
                  常见优化建议（{solutions.length}）
                </Typography.Text>
              ),
              children: (
                <ul className="space-y-1 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
                  {solutions.map((s) => (
                    <li key={s.text}>
                      <Tag className="mr-2">{s.count}</Tag>
                      {s.text}…
                    </li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      )}

      <div className="mt-3 space-y-2">
        {items.length === 0 ? (
          <Empty className="py-8" description={emptyHint} />
        ) : (
          <SimpleList
            dataSource={previewItems}
            renderItem={(fb) => (
              <InsightFeedbackListItem
                fb={fb}
                compact={compact}
                onItemClick={onItemClick}
              />
            )}
          />
        )}
      </div>
    </Card>
  )
}

/**
 * @param {{
 *   fb: import('../lib/types.js').FeedbackRecord;
 *   compact: boolean;
 *   onItemClick?: (fb: import('../lib/types.js').FeedbackRecord) => void;
 * }}
 */
function InsightFeedbackListItem({ fb, compact, onItemClick }) {
  const [expanded, setExpanded] = useState(false)
  const summary =
    getDisplayCustomerRequest(fb) || getDisplayPainPoint(fb) || '—'
  const painPoint = getDisplayPainPoint(fb)
  const hasCustomerRequest = Boolean(getDisplayCustomerRequest(fb))
  const optimizationPreview =
    fb.optimizationProduct || fb.optimizationService
      ? formatListOptimizationPreview(fb)
      : fb.optimizationSuggestion || ''

  const handleActivate = () => onItemClick?.(fb)

  if (compact && !expanded) {
    return (
      <div
        role="button"
        tabIndex={0}
        className="cursor-pointer rounded-lg border border-ink-100 px-3 py-2 hover:border-brand-200 hover:bg-brand-50/20"
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleActivate()
        }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <SentimentBadge record={fb} />
              <Tag color="blue" className="!m-0 !text-[10px]">
                {fb.requestScene || '未分类'}
              </Tag>
              <Typography.Text type="secondary" className="text-[10px]">
                {fb.ticketId || '—'}
              </Typography.Text>
            </div>
            <Typography.Paragraph className="!mb-0 !mt-1 !text-sm line-clamp-1">
              {summary}
            </Typography.Paragraph>
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-600"
            aria-label="展开详情"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(true)
            }}
          >
            <RightOutlined className="text-[10px]" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-lg border border-ink-100 px-3 py-3 hover:border-brand-200 hover:bg-brand-50/20"
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleActivate()
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
        {summary}
      </Typography.Paragraph>
      {painPoint && hasCustomerRequest && (
        <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 !text-xs line-clamp-2">
          <span className="font-medium">痛点：</span>
          {painPoint}
        </Typography.Paragraph>
      )}
      {optimizationPreview && (
        <Typography.Paragraph className="!mb-0 !mt-1 !text-xs !text-brand-700 line-clamp-2">
          <span className="font-medium text-ink-500">建议：</span>
          {optimizationPreview}
        </Typography.Paragraph>
      )}
      <Typography.Text type="secondary" className="mt-2 block text-[10px]">
        {fb.ticketId || '—'} · {fb.product || '—'}
        {fb.productSpec && fb.productSpec !== fb.product ? ` / ${fb.productSpec}` : ''} ·{' '}
        {fb.createdAt || '—'}
      </Typography.Text>
      {compact && (
        <button
          type="button"
          className="mt-1 text-[10px] text-ink-400 hover:text-ink-600"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(false)
          }}
        >
          收起
        </button>
      )}
    </div>
  )
}
