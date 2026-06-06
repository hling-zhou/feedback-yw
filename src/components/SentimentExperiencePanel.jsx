import { useMemo, useState } from 'react'
import { Card, Segmented, Table, Tabs, Typography } from 'antd'
import HeatmapTableCell, { HeatmapLegend } from './HeatmapTableCell.jsx'
import {
  buildSentimentJourneyProblemCrossTab,
  rankUrgentNegativeJourneys,
  SENTIMENT_LABELS,
  SENTIMENT_ORDER,
} from '../lib/sentimentExperienceAnalytics.js'
import { columnStats, HEAT_RGB } from '../lib/heatmapScale.js'

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
  const [heatmapEnabled, setHeatmapEnabled] = useState(true)

  const urgentJourneyStats = useMemo(
    () => ({
      urgentNegative: columnStats(urgentJourneys, 'urgentNegativeCount'),
      negative: columnStats(urgentJourneys, 'negativeCount'),
      urgent: columnStats(urgentJourneys, 'urgentCount'),
      total: columnStats(urgentJourneys, 'total'),
    }),
    [urgentJourneys],
  )

  const crossTabStats = useMemo(
    () => ({
      total: columnStats(crossTab, 'total'),
      urgent: columnStats(crossTab, 'urgentCount'),
      negative: columnStats(crossTab, 'negativeCount'),
      sentiments: Object.fromEntries(
        SENTIMENT_ORDER.map((key) => [key, columnStats(crossTab, ['sentiments', key])]),
      ),
    }),
    [crossTab],
  )

  const urgentJourneyColumns = useMemo(
    () => [
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
        render: (value, row) => (
          <HeatmapTableCell
            value={value}
            max={urgentJourneyStats.urgentNegative.max}
            rgb={HEAT_RGB.urgentNegative}
            alphaMax={0.55}
            enabled={heatmapEnabled}
          >
            <span>
              {value}
              <Typography.Text type="secondary" className="ml-1 text-[10px]">
                ({row.urgentNegativePct}%)
              </Typography.Text>
            </span>
          </HeatmapTableCell>
        ),
      },
      {
        title: '负面',
        dataIndex: 'negativeCount',
        width: 72,
        align: 'center',
        render: (value) => (
          <HeatmapTableCell
            value={value}
            max={urgentJourneyStats.negative.max}
            rgb={HEAT_RGB.metricNegative}
            alphaMax={0.45}
            enabled={heatmapEnabled}
          />
        ),
      },
      {
        title: '加急',
        dataIndex: 'urgentCount',
        width: 64,
        align: 'center',
        render: (value) => (
          <HeatmapTableCell
            value={value}
            max={urgentJourneyStats.urgent.max}
            rgb={HEAT_RGB.urgent}
            alphaMax={0.4}
            enabled={heatmapEnabled}
          />
        ),
      },
      {
        title: '合计',
        dataIndex: 'total',
        width: 64,
        align: 'center',
        render: (value) => (
          <HeatmapTableCell
            value={value}
            max={urgentJourneyStats.total.max}
            rgb={HEAT_RGB.total}
            alphaMax={0.25}
            enabled={heatmapEnabled}
          />
        ),
      },
    ],
    [heatmapEnabled, urgentJourneyStats],
  )

  const crossTabColumns = useMemo(
    () => [
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
        render: (value) => (
          <HeatmapTableCell
            value={value}
            max={crossTabStats.total.max}
            rgb={HEAT_RGB.total}
            alphaMax={0.3}
            enabled={heatmapEnabled}
          />
        ),
      },
      {
        title: '加急',
        dataIndex: 'urgentCount',
        width: 56,
        align: 'center',
        render: (value) => (
          <HeatmapTableCell
            value={value}
            max={crossTabStats.urgent.max}
            rgb={HEAT_RGB.urgent}
            alphaMax={0.4}
            enabled={heatmapEnabled}
          />
        ),
      },
      {
        title: '负面',
        dataIndex: 'negativeCount',
        width: 56,
        align: 'center',
        render: (value) => (
          <HeatmapTableCell
            value={value}
            max={crossTabStats.negative.max}
            rgb={HEAT_RGB.metricNegative}
            alphaMax={0.45}
            enabled={heatmapEnabled}
          />
        ),
      },
      ...SENTIMENT_ORDER.map((key) => ({
        title: SENTIMENT_LABELS[key],
        dataIndex: ['sentiments', key],
        width: 72,
        align: 'center',
        render: (value) => (
          <HeatmapTableCell
            value={value}
            max={crossTabStats.sentiments[key].max}
            rgb={HEAT_RGB[key] ?? HEAT_RGB.neutral_inquiry}
            alphaMax={0.45}
            enabled={heatmapEnabled}
          />
        ),
      })),
    ],
    [crossTabStats, heatmapEnabled],
  )

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
            <>
              <Table
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={urgentJourneys}
                columns={urgentJourneyColumns}
              />
              {heatmapEnabled ? (
                <HeatmapLegend rgb={HEAT_RGB.urgentNegative} label="断点强度热力" />
              ) : null}
            </>
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
            <>
              <Table
                rowKey="key"
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
                scroll={{ x: 900 }}
                dataSource={crossTab}
                columns={crossTabColumns}
              />
              {heatmapEnabled ? (
                <HeatmapLegend rgb={HEAT_RGB.total} label="规模 / 情绪热力" />
              ) : null}
            </>
          ),
      },
    ],
    [
      crossTab,
      crossTabColumns,
      heatmapEnabled,
      urgentJourneyColumns,
      urgentJourneyLimit,
      urgentJourneys,
    ],
  )

  return (
    <Card
      className={className}
      title={<Typography.Text strong>体验断点分析</Typography.Text>}
      extra={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Segmented
            size="small"
            value={heatmapEnabled ? 'heatmap' : 'plain'}
            onChange={(value) => setHeatmapEnabled(value === 'heatmap')}
            options={[
              { label: '热力', value: 'heatmap' },
              { label: '数值', value: 'plain' },
            ]}
          />
          <Typography.Text type="secondary" className="text-xs">
            {items.length} 条 · 情绪 × 旅程 × 问题类型
          </Typography.Text>
        </div>
      }
    >
      <Typography.Text type="secondary" className="mb-3 block text-xs">
        「加急」对应焦急/催办类表述；负面情绪含轻度不满、不满与强烈不满。高加急且高负面旅程往往指向流程或服务断点，而非单纯技术故障。
      </Typography.Text>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Card>
  )
}
