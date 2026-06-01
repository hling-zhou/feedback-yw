import { useMemo, useState } from 'react'
import { Card, Table, Tabs, Typography } from 'antd'
import {
  buildSentimentJourneyProblemCrossTab,
  rankUrgentNegativeJourneys,
  SENTIMENT_LABELS,
  SENTIMENT_ORDER,
} from '../lib/sentimentExperienceAnalytics.js'

/**
 * @param {{
 *   items: import('../lib/types.js').FeedbackRecord[];
 *   className?: string;
 *   crossTabLimit?: number;
 *   urgentJourneyLimit?: number;
 * }}
 */
export default function SentimentExperiencePanel({
  items,
  className,
  crossTabLimit = 40,
  urgentJourneyLimit = 8,
}) {
  const urgentJourneys = useMemo(
    () => rankUrgentNegativeJourneys(items, { limit: urgentJourneyLimit }),
    [items, urgentJourneyLimit],
  )
  const crossTab = useMemo(
    () => buildSentimentJourneyProblemCrossTab(items, { limit: crossTabLimit }),
    [items, crossTabLimit],
  )

  const [activeTab, setActiveTab] = useState('urgent')

  const sentimentColumns = SENTIMENT_ORDER.map((key) => ({
    title: SENTIMENT_LABELS[key],
    dataIndex: ['sentiments', key],
    width: 72,
    align: 'center',
    render: (v) => (v ? v : '—'),
  }))

  const tabItems = useMemo(
    () => [
      {
        key: 'urgent',
        label: `高加急 + 负面旅程 Top ${urgentJourneyLimit}`,
        children:
          urgentJourneys.length === 0 ? (
            <Typography.Text type="secondary" className="text-xs">
              当前筛选范围内暂无加急且负面的旅程工单。
            </Typography.Text>
          ) : (
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={urgentJourneys}
              columns={[
                {
                  title: '用户旅程',
                  dataIndex: 'journeyLabel',
                  ellipsis: true,
                },
                {
                  title: '加急且负面',
                  dataIndex: 'urgentNegativeCount',
                  width: 96,
                  align: 'center',
                  render: (v, row) => (
                    <span>
                      {v}
                      <Typography.Text type="secondary" className="ml-1 text-[10px]">
                        ({row.urgentNegativePct}%)
                      </Typography.Text>
                    </span>
                  ),
                },
                {
                  title: '负面',
                  dataIndex: 'negativeCount',
                  width: 72,
                  align: 'center',
                },
                {
                  title: '加急',
                  dataIndex: 'urgentCount',
                  width: 64,
                  align: 'center',
                },
                {
                  title: '合计',
                  dataIndex: 'total',
                  width: 64,
                  align: 'center',
                },
              ]}
            />
          ),
      },
      {
        key: 'crossTab',
        label: '情绪 × 旅程 × 问题类型',
        children:
          crossTab.length === 0 ? (
            <Typography.Text type="secondary" className="text-xs">
              暂无数据
            </Typography.Text>
          ) : (
            <Table
              rowKey="key"
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
              scroll={{ x: 900 }}
              dataSource={crossTab}
              columns={[
                {
                  title: '用户旅程',
                  dataIndex: 'journeyLabel',
                  width: 180,
                  fixed: 'left',
                  ellipsis: true,
                },
                {
                  title: '问题类型',
                  dataIndex: 'problemType',
                  width: 120,
                  ellipsis: true,
                },
                {
                  title: '合计',
                  dataIndex: 'total',
                  width: 56,
                  align: 'center',
                },
                {
                  title: '加急',
                  dataIndex: 'urgentCount',
                  width: 56,
                  align: 'center',
                },
                {
                  title: '负面',
                  dataIndex: 'negativeCount',
                  width: 56,
                  align: 'center',
                },
                ...sentimentColumns,
              ]}
            />
          ),
      },
    ],
    [crossTab, sentimentColumns, urgentJourneyLimit, urgentJourneys],
  )

  return (
    <Card
      className={className}
      title={<Typography.Text strong>体验断点分析</Typography.Text>}
      extra={
        <Typography.Text type="secondary" className="text-xs">
          {items.length} 条 · 情绪 × 旅程 × 问题类型
        </Typography.Text>
      }
    >
      <Typography.Text type="secondary" className="mb-3 block text-xs">
        「加急」对应焦急/催办类表述；负面情绪含轻度不满、不满与强烈不满。高加急且高负面旅程往往指向流程或服务断点，而非单纯技术故障。
      </Typography.Text>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Card>
  )
}
