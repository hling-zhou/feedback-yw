import { Link } from 'react-router-dom'
import { Button, Card, Empty, Tag, Typography } from 'antd'
import SimpleList from './ui/SimpleList.jsx'
import { topCommonOptimizations } from '../lib/productAnalytics.js'

/**
 * @param {{ items: import('../lib/types.js').FeedbackRecord[]; journeyL1?: string; journeyL2?: string; onClose?: () => void }}
 */
export default function ProductDrillDown({ items, journeyL1, journeyL2, onClose }) {
  const solutions = topCommonOptimizations(items, journeyL1, journeyL2)

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <Typography.Title level={5} className="!mb-0">
            问题清单
            {journeyL1 && (
              <Typography.Text type="secondary" className="ml-2 font-normal">
                {journeyL1}
                {journeyL2 ? ` / ${journeyL2}` : ''}
              </Typography.Text>
            )}
          </Typography.Title>
          <Typography.Text type="secondary" className="mt-1 block text-xs">
            共 {items.length} 条，点击行可在反馈库查看详情
          </Typography.Text>
        </div>
        {onClose && (
          <Button type="link" size="small" onClick={onClose}>
            清除筛选
          </Button>
        )}
      </div>

      {solutions.length > 0 && (
        <div className="mt-4 rounded-lg bg-ink-50 p-3">
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

      <div className="mt-4 max-h-[360px] overflow-y-auto">
        {items.length === 0 ? (
          <Empty description="暂无问题清单" />
        ) : (
          <SimpleList
            dataSource={items.slice(0, 50)}
            renderItem={(fb) => (
              <div
                key={fb.id}
                className="rounded-lg border border-ink-100 px-3 py-3"
              >
                <div className="flex flex-wrap gap-1.5">
                  <Tag>{fb.problemType}</Tag>
                  {fb.resourcePool && <Tag>{fb.resourcePool}</Tag>}
                </div>
                <Typography.Paragraph className="!mb-0 !mt-2 font-medium line-clamp-2">
                  {fb.problemSummary}
                </Typography.Paragraph>
                {fb.solutionSummary && (
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 !text-xs line-clamp-2">
                    <span className="font-medium">方案：</span>
                    {fb.solutionSummary}
                  </Typography.Paragraph>
                )}
                {fb.rootCause && (
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 !text-xs line-clamp-1">
                    <span className="font-medium">根因：</span>
                    {fb.rootCause}
                  </Typography.Paragraph>
                )}
                <Typography.Text type="secondary" className="mt-2 block text-[10px]">
                  {fb.ticketId} · {fb.createdAt}
                </Typography.Text>
              </div>
            )}
          />
        )}
        {items.length > 50 && (
          <Typography.Text type="secondary" className="block text-center text-xs">
            仅展示前 50 条，完整列表请至反馈库
          </Typography.Text>
        )}
      </div>

      <Link to="/feedbacks" className="mt-3 inline-block">
        <Button type="link" className="!px-0">
          打开反馈库
        </Button>
      </Link>
    </Card>
  )
}
