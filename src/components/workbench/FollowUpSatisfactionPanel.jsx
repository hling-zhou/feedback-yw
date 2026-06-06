import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Select, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import ThemeBarChart from '../charts/ThemeBarChart.jsx'
import KeywordWordCloud from '../charts/KeywordWordCloud.jsx'
import FollowUpTenPointRateChart from '../charts/FollowUpTenPointRateChart.jsx'
import FollowUpScoreDistributionChart from '../charts/FollowUpScoreDistributionChart.jsx'
import { useInsights } from '../../context/InsightsContext.jsx'
import { buildFollowUpDrillDownUrl, drillDownFieldParam } from '../../lib/feedbackFilters.js'
import {
  exportScoreDistributionXlsx,
  exportTenPointRateTrendXlsx,
} from '../../lib/followUpSatisfactionExport.js'
import {
  buildFollowUpSatisfactionMetrics,
  buildTenPointRateTrendChart,
  extractFollowUpTicketRecords,
  productNameFromFollowUpRecord,
  productKeyFromFollowUpRecord,
} from '../../lib/followUpSatisfactionAnalytics.js'

/**
 * 用后即评 Tab · 回访满意度分析（投诉/咨询工单 enrichment）。
 *
 * @param {Object} props
 * @param {import('../../lib/types.js').FeedbackRecord[]} props.ticketRecords 周期内投诉/咨询工单
 */
export default function FollowUpSatisfactionPanel({ ticketRecords }) {
  const { currentPeriod } = useInsights()
  const [productKey, setProductKey] = useState('all')

  const followUpTickets = useMemo(
    () => extractFollowUpTicketRecords(ticketRecords),
    [ticketRecords],
  )

  const metrics = useMemo(
    () =>
      buildFollowUpSatisfactionMetrics(ticketRecords, {
        productKey: productKey === 'all' ? undefined : productKey,
      }),
    [ticketRecords, productKey],
  )

  const trend = useMemo(
    () => buildTenPointRateTrendChart(ticketRecords, productKey),
    [ticketRecords, productKey],
  )

  const selectedProductName = useMemo(() => {
    if (productKey === 'all') return ''
    const fromList = metrics.products.find((p) => p.productKey === productKey)
    if (fromList?.productName) return fromList.productName
    const rec = ticketRecords.find((r) => productKeyFromFollowUpRecord(r) === productKey)
    return rec ? productNameFromFollowUpRecord(rec) : ''
  }, [metrics.products, productKey, ticketRecords])

  const drillDownBase = useMemo(
    () => ({ productName: selectedProductName || undefined }),
    [selectedProductName],
  )

  const requestSceneChart = useMemo(
    () =>
      metrics.nonTenRequestScenes.map((row) => ({
        label: row.name,
        count: row.count,
        negative: row.count,
      })),
    [metrics.nonTenRequestScenes],
  )

  const problemTypeChart = useMemo(
    () =>
      metrics.nonTenProblemTypes.map((row) => ({
        label: row.name,
        count: row.count,
        negative: row.count,
      })),
    [metrics.nonTenProblemTypes],
  )

  const reasonWordCloud = useMemo(
    () => metrics.dissatisfiedReasonWords || [],
    [metrics.dissatisfiedReasonWords],
  )

  const productOptions = useMemo(
    () => [
      { value: 'all', label: '全部产品' },
      ...metrics.products.map((p) => ({
        value: p.productKey,
        label: `${p.productName}（${p.scoredCount}）`,
      })),
    ],
    [metrics.products],
  )

  const exportOptions = useMemo(
    () => ({
      productKey: productKey === 'all' ? undefined : productKey,
      productName: selectedProductName || '全部产品',
      periodLabel: currentPeriod?.label || '当前周期',
    }),
    [productKey, selectedProductName, currentPeriod?.label],
  )

  if (!followUpTickets.length) {
    return (
      <Card title="回访满意度">
        <Typography.Text type="secondary">
          当前周期内暂无回访满意度数据。请先在
          {' '}
          <Link to="/import?source=post_use_rating&subType=satisfaction_callback">导入页</Link>
          {' '}
          上传满意度回访记录并完成工单补全。
        </Typography.Text>
      </Card>
    )
  }

  const unresolvedRatePct =
    metrics.unresolved.unresolvedRate != null
      ? Math.round(metrics.unresolved.unresolvedRate * 1000) / 10
      : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Typography.Title level={5} className="!mb-0">
          回访满意度
        </Typography.Title>
        <Select
          className="min-w-[12rem]"
          value={productKey}
          options={productOptions}
          onChange={setProductKey}
          aria-label="回访满意度产品筛选"
        />
      </div>

      <Typography.Text type="secondary" className="block text-xs">
        基于周期内投诉/咨询工单的回访补全数据；有效回访 {metrics.scoredCount} 条
        {selectedProductName ? ` · ${selectedProductName}` : ''}
        {' · '}
        <Link to={buildFollowUpDrillDownUrl({ ...drillDownBase, followUp: 'has' })}>
          查看工单
        </Link>
      </Typography.Text>

      <Card
        title="10 分满意率 · 月度趋势"
        extra={
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => exportTenPointRateTrendXlsx(ticketRecords, exportOptions)}
          >
            导出 Excel
          </Button>
        }
      >
        <div data-pdf-chart="followup-ten-rate-trend" className="rounded-lg bg-white p-2">
          <FollowUpTenPointRateChart data={trend.chartData} lines={trend.lines} />
        </div>
      </Card>

      <Card
        title="非 10 分 · 得分分布"
        extra={
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() =>
              exportScoreDistributionXlsx(metrics.scoreDistributionByProduct, exportOptions)
            }
          >
            导出 Excel
          </Button>
        }
      >
        <div data-pdf-chart="followup-score-distribution" className="rounded-lg bg-white p-2">
          <FollowUpScoreDistributionChart rows={metrics.scoreDistributionByProduct} />
        </div>
      </Card>

      <div
        data-pdf-chart="followup-unresolved"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-ink-100 bg-white px-4 py-3"
      >
        <span className="shrink-0 text-sm font-medium text-ink-800">未解决占比</span>
        <Typography.Text type="secondary" className="shrink-0 text-xs">
          全部有效回访
        </Typography.Text>
        <div
          className="relative h-2.5 min-w-[6rem] flex-1 overflow-hidden rounded-full border border-ink-200 bg-white"
          role="progressbar"
          aria-valuenow={unresolvedRatePct ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="未解决占比"
        >
          <div
            className="h-full rounded-full bg-rose-500 transition-[width]"
            style={{ width: `${unresolvedRatePct ?? 0}%` }}
          />
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-600">
          {unresolvedRatePct != null ? `${unresolvedRatePct}%` : '—'}
        </span>
        {metrics.unresolved.totalScored ? (
          <>
            <Typography.Text type="secondary" className="shrink-0 text-xs tabular-nums">
              {metrics.unresolved.unresolvedCount} / {metrics.unresolved.totalScored} 条
            </Typography.Text>
            <Link
              className="shrink-0 text-xs font-medium"
              to={buildFollowUpDrillDownUrl({
                ...drillDownBase,
                followUp: 'has',
                followUpResolved: 'unresolved',
              })}
            >
              查看未解决
            </Link>
          </>
        ) : null}
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Card title="非 10 分 · 请求场景">
          <div data-pdf-chart="followup-request-scenes" className="rounded-lg bg-white p-2">
            <ThemeBarChart
              data={requestSceneChart}
              showNegativePct={false}
              buildFeedbacksHref={(label) =>
                buildFollowUpDrillDownUrl({
                  ...drillDownBase,
                  requestScene: drillDownFieldParam(label),
                })
              }
            />
          </div>
        </Card>
        <Card title="非 10 分 · 问题类型">
          <div data-pdf-chart="followup-problem-types" className="rounded-lg bg-white p-2">
            <ThemeBarChart
              data={problemTypeChart}
              showNegativePct={false}
              buildFeedbacksHref={(label) =>
                buildFollowUpDrillDownUrl({
                  ...drillDownBase,
                  problemType: drillDownFieldParam(label),
                })
              }
            />
          </div>
        </Card>
      </div>

      <Card title="非 10 分 · 不满意原因">
        <Typography.Text type="secondary" className="mb-2 block text-xs">
          汇总非 10 分工单中填写的不满意原因原文；已自动过滤「无」「暂无」等占位值
        </Typography.Text>
        <div data-pdf-chart="followup-dissatisfied-reasons" className="rounded-lg bg-white p-2">
          <KeywordWordCloud
            words={reasonWordCloud}
            ariaLabel="不满意原因词云"
            emptyDescription="暂无不满意原因文本"
          />
        </div>
      </Card>
    </div>
  )
}
