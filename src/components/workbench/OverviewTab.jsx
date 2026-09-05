import { useMemo } from 'react'
import { Alert, Card, Table, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { formatSnapshotGeneratedAt } from '../../domain/snapshot.js'
import { prepareOverviewConclusionsForDisplay } from '../../snapshots/rehydrateOverviewRecommendations.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { buildImportUrl } from '../../lib/importRoute.js'
import { resolvePreviousInsightPeriod } from '../../domain/insightPeriod.js'
import { computeMaxMomGrowthProductForSource } from '../../lib/sourceOverviewMetrics.js'
import TrendChart from '../charts/TrendChart.jsx'
import { buildStackedTrendAreas, monthlyTrendByProduct } from '../../lib/analytics.js'
import { isTicketSource } from '../../lib/importUtils.js'
import {
  buildWanTouByProducts,
} from '../../lib/wanTouRatio.js'
import { buildWanTouProductTableColumns } from './WanTouRatioCells.jsx'
import { filterRecordsForScope } from '../../snapshots/recordScope.js'
import PlanningRecommendationsPanel from './PlanningRecommendationsPanel.jsx'
import RebuildInsightsButton from './RebuildInsightsButton.jsx'
import OverviewJourneyMap from './OverviewJourneyMap.jsx'
import ProductExperienceTrendPanel from './ProductExperienceTrendPanel.jsx'

/**
 * @param {Object} props
 * @param {import('../../domain/snapshot.js').OverviewSnapshot | null} props.snapshot
 * @param {Partial<Record<import('../../domain/enums.js').DataSourceType, import('../../domain/snapshot.js').InsightSnapshot>>} props.sourceSnapshots
 * @param {(source: import('../../domain/enums.js').DataSourceType) => void} [props.onSourceTab]
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null} [props.currentPeriod]
 * @param {import('../../lib/types.js').FeedbackRecord[]} [props.complaintRecords]
 * @param {import('../../storage/orderVolumeStore.js').OrderVolumeRow[]} [props.orderVolumes]
 * @param {import('../../storage/wanTouTargetStore.js').WanTouTargetRow[]} [props.wanTouTargets]
 * @param {() => void} [props.onRebuildSnapshots]
 * @param {boolean} [props.snapshotRebuilding]
 * @param {boolean} [props.rebuildDisabled]
 * @param {import('../../lib/types.js').FeedbackRecord[]} [props.feedbacks]
 * @param {(feedback: import('../../lib/types.js').FeedbackRecord) => void} [props.onOpenFeedback]
 */
export default function OverviewTab({
  snapshot,
  sourceSnapshots,
  onSourceTab,
  currentPeriod,
  complaintRecords = [],
  orderVolumes = [],
  wanTouTargets = [],
  onRebuildSnapshots,
  snapshotRebuilding,
  rebuildDisabled,
  feedbacks = [],
  onOpenFeedback,
}) {
  const { conclusions: displayConclusions, recommendationsPendingRefresh } = useMemo(
    () => prepareOverviewConclusionsForDisplay(snapshot?.conclusions),
    [snapshot?.conclusions],
  )

  if (!snapshot) {
    return (
      <Card>
        <Typography.Text type="secondary">请先生成洞察快照。</Typography.Text>
      </Card>
    )
  }

  const total = snapshot.crossSourceMetrics?.totalRecords ?? 0

  const ticketRecordsForTrend = DATA_SOURCE_TYPES.flatMap((type) =>
    isTicketSource(type) ? filterRecordsForScope(feedbacks, currentPeriod, type) : [],
  )
  const trendByProductFromSnapshot = snapshot.crossSourceMetrics?.monthly_trend_by_product
  const trendByProduct =
    trendByProductFromSnapshot?.data?.length
      ? trendByProductFromSnapshot
      : monthlyTrendByProduct(ticketRecordsForTrend, { basis: 'importMonth', limit: 12 })
  const trendChartAreas = buildStackedTrendAreas(trendByProduct.products || [])

  const wanTouRows = buildWanTouByProducts({
    period: currentPeriod,
    records: complaintRecords,
    orderVolumes,
    wanTouTargets,
    productList: sourceSnapshots.complaint_ticket?.aggregates?.products,
  })

  const previousPeriod = useMemo(
    () => resolvePreviousInsightPeriod(currentPeriod),
    [currentPeriod],
  )

  const sourceRows = useMemo(() => {
    return DATA_SOURCE_TYPES.map((type) => {
      const summary = snapshot.sourceSummaries?.[type] || sourceSnapshots[type]?.summary
      const maxMomGrowthProduct =
        summary?.maxMomGrowthProduct ??
        computeMaxMomGrowthProductForSource(feedbacks, currentPeriod, previousPeriod, type) ??
        null
      return {
        key: type,
        source: DATA_SOURCE_LABELS[type],
        count: summary?.recordCount ?? 0,
        negativePct: summary?.negativePct,
        maxMomGrowthProduct,
        status: sourceSnapshots[type]?.status,
      }
    })
  }, [snapshot.sourceSummaries, sourceSnapshots, feedbacks, currentPeriod, previousPeriod])

  const activeSourceCount = sourceRows.filter((r) => r.count > 0).length
  const generatedAtLabel = formatSnapshotGeneratedAt(snapshot.generatedAt)

  return (
    <div className="space-y-6">
      <Typography.Text type="secondary" className="block text-xs">
        周期内反馈 {total} 条 · 有数据来源 {activeSourceCount}/{DATA_SOURCE_TYPES.length} · 快照{' '}
        {generatedAtLabel}；刷新/生成洞察 可获取最新结果。
      </Typography.Text>

      {recommendationsPendingRefresh && (
        <Alert
          type="warning"
          showIcon
          title="行动建议待刷新"
          description="当前快照未包含行动建议。请点击「生成 / 刷新洞察」后查看各产品 Top 10 建议。"
          action={
            onRebuildSnapshots ? (
              <RebuildInsightsButton
                size="small"
                type="primary"
                loading={Boolean(snapshotRebuilding)}
                disabled={rebuildDisabled}
                onClick={() => onRebuildSnapshots()}
              >
                刷新洞察
              </RebuildInsightsButton>
            ) : null
          }
        />
      )}

      <PlanningRecommendationsPanel
        conclusions={displayConclusions}
        feedbacks={feedbacks}
      />

      <ProductExperienceTrendPanel feedbacks={feedbacks} />

      <OverviewJourneyMap feedbacks={feedbacks} currentPeriod={currentPeriod} />

      {wanTouRows.length > 0 && (
        <Card
          title="各产品万投比（投诉工单）"
          extra={
            <Typography.Text type="secondary" className="text-xs">
              {currentPeriod?.label || '当前周期'} · 月粒度=当月；年粒度=12月月均
            </Typography.Text>
          }
        >
          <div className="rounded-lg bg-white">
          <Table
            size="small"
            pagination={false}
            rowKey="productName"
            scroll={{ x: 760 }}
            dataSource={wanTouRows}
            columns={buildWanTouProductTableColumns()}
          />
          </div>
          <Typography.Text type="secondary" className="mt-2 block text-xs">
            分母与目标值请在 <Link to="/settings">设置</Link> 中维护产品月订单数、万投比目标值。
            {wanTouRows.some((row) => row.missingOrderMonths?.length) ? (
              <>
                {' '}
                部分产品缺月订单数，万投比可能无法对比目标。
              </>
            ) : null}
          </Typography.Text>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="各数据来源概览" className="min-w-0 overflow-hidden">
          <Table
            size="small"
            tableLayout="fixed"
            className="w-full"
            pagination={false}
            dataSource={sourceRows}
            columns={[
              {
                title: '来源',
                dataIndex: 'source',
                width: '15%',
                onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
              },
              {
                title: '条数',
                dataIndex: 'count',
                width: '15%',
                onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
              },
              {
                title: '负面占比',
                width: '15%',
                onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
                render: (_, r) =>
                  r.negativePct != null ? `${r.negativePct}%` : '—',
              },
              {
                title: '环比最大增幅产品',
                dataIndex: 'maxMomGrowthProduct',
                ellipsis: true,
                render: (value) => value || '—',
              },
              {
                title: '快照',
                width: '10%',
                onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
                render: (_, r) => {
                  const st = r.status
                  if (st === 'stale') {
                    return (
                      <Typography.Text type="warning" className="text-xs">
                        待更新
                      </Typography.Text>
                    )
                  }
                  if (st === 'ready') {
                    return (
                      <Typography.Text type="success" className="text-xs">
                        就绪
                      </Typography.Text>
                    )
                  }
                  return '—'
                },
              },
              {
                title: '',
                width: 44,
                onCell: () => ({
                  style: { whiteSpace: 'nowrap', paddingInline: 4 },
                }),
                render: (_, r) =>
                  onSourceTab ? (
                    <a
                      href="#"
                      className="text-xs"
                      onClick={(e) => {
                        e.preventDefault()
                        onSourceTab(r.key)
                      }}
                    >
                      查看
                    </a>
                  ) : null,
              },
            ]}
          />
        </Card>

        {trendByProduct.data?.length > 0 ? (
          <Card title="跨源月度趋势（工单类合计）" className="min-w-0">
            <div className="rounded-lg bg-white p-2">
              <TrendChart
                data={trendByProduct.data}
                areas={trendChartAreas}
                stacked
                height={trendChartAreas.length > 6 ? 260 : 220}
              />
            </div>
            <Typography.Text type="secondary" className="mt-2 block text-xs">
              投诉与咨询工单按月合计，按产品堆叠；用后即评/调研等指标请见各分源 Tab。
            </Typography.Text>
          </Card>
        ) : (
          <Card title="跨源月度趋势（工单类合计）" className="min-w-0">
            <Typography.Text type="secondary" className="text-sm">
              当前周期暂无月度趋势数据。
            </Typography.Text>
          </Card>
        )}
      </div>

      <Card>
        <Typography.Text type="secondary" className="text-xs">
          无数据？<Link to={buildImportUrl()}>去导入</Link>
          {' · '}
          <Link to="/feedbacks">反馈库</Link>
        </Typography.Text>
      </Card>
    </div>
  )
}
