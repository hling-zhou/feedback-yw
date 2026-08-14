import { Link } from 'react-router-dom'
import { Button, Card, Empty, Segmented, Space, Spin, Tag, Typography } from 'antd'
import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { TOPIC_TYPE_LABELS, topicReportStatus } from '../../lib/topicAnalysis/constants.js'

/**
 * @param {{
 *   cards: object[],
 *   reports: object[],
 *   loading?: boolean,
 *   adoptingId?: string | null,
 *   typeFilter: string,
 *   onTypeFilter: (value: string) => void,
 *   onAdopt: (card: object) => void,
 *   llmPolishing?: boolean,
 *   llmPolished?: boolean,
 * }} props
 */
export default function TopicRecommendPanel({
  cards,
  reports,
  loading,
  adoptingId,
  typeFilter,
  onTypeFilter,
  onAdopt,
  llmPolishing,
  llmPolished,
}) {
  const visible = typeFilter === 'all' ? cards : cards.filter((card) => card.type === typeFilter)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Typography.Text type="secondary">
          近 9 个月投诉/咨询/用后即评综合推荐，无需选择周期。
          {llmPolishing ? ' 正在用 AI 精炼理由…' : null}
          {llmPolished && !llmPolishing ? ' 理由已经 AI 精炼。' : null}
        </Typography.Text>
        <Segmented
          size="small"
          value={typeFilter}
          onChange={onTypeFilter}
          options={[{ label: '全部', value: 'all' }, ...Object.entries(TOPIC_TYPE_LABELS).map(([value, label]) => ({ label, value }))]}
        />
      </div>
      {loading ? (
        <Spin />
      ) : visible.length === 0 ? (
        <Empty description="近 9 个月暂无足够信号可推荐。可到「专题报告」新建专题。" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((card) => {
            const existing = reports.find((item) => (
              item.sourceRecommendationId === card.id
              || (card.mergeIds || []).includes(item.sourceRecommendationId)
            ))
            return (
              <Card key={card.id} size="small" title={(
                <Space wrap>
                  <Tag>{card.typeLabel}</Tag>
                  <span>{card.title}</span>
                </Space>
              )}
              >
                {(card.scenarioLabels || []).length ? (
                  <Space wrap size={4} className="mb-2">
                    {card.scenarioLabels.map((label) => (
                      <Tag key={label} color="blue">{label}</Tag>
                    ))}
                  </Space>
                ) : null}
                <p className="text-sm text-ink-800">{card.intro || card.title}</p>
                <p className="mt-2 text-sm"><Typography.Text type="secondary">推荐理由：</Typography.Text>{card.whyNow}</p>
                <p className="mt-2 text-xs text-ink-500">
                  {card.periodLabel || '近9个月'} · {card.sampleSize || 0} 条
                  {Object.entries(card.countsBySource || {}).map(([type, count]) => (
                    ` · ${DATA_SOURCE_LABELS[type] || type} ${count}`
                  )).join('')}
                </p>
                {card.evidenceQuotes?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-600">
                    {card.evidenceQuotes.map((quote) => (
                      <li key={`${quote.ticketId}-${quote.text}`}>
                        {quote.ticketId ? <Link to={quote.href}>{quote.ticketId}</Link> : null}
                        {quote.ticketId ? ' ' : null}
                        {quote.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3">
                  {existing && topicReportStatus(existing) === 'generating' ? (
                    <Button disabled>生成中</Button>
                  ) : existing ? (
                    <Link to={`/topics/${existing.id}`}>
                      <Button>查看报告</Button>
                    </Link>
                  ) : (
                    <Button type="primary" loading={adoptingId === card.id} onClick={() => onAdopt(card)}>
                      纳入分析
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
