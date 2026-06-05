import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card, Col, Row, Select, Statistic, Typography } from 'antd'
import ThemeBarChart from '../charts/ThemeBarChart.jsx'
import FollowUpTenPointRateChart from '../charts/FollowUpTenPointRateChart.jsx'
import FollowUpScoreDistributionChart from '../charts/FollowUpScoreDistributionChart.jsx'
import { buildFollowUpDrillDownUrl, drillDownFieldParam } from '../../lib/feedbackFilters.js'
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
  const navigate = useNavigate()
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

  const reasonChart = useMemo(
    () =>
      metrics.dissatisfiedReasons.map((row) => ({
        label: row.label,
        count: row.count,
        negative: row.count,
        reasonDim: row.reasonDim,
      })),
    [metrics.dissatisfiedReasons],
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

      <Card title="10 分满意率 · 月度趋势">
        <div data-pdf-chart="followup-ten-rate-trend" className="rounded-lg bg-white p-2">
          <FollowUpTenPointRateChart data={trend.chartData} lines={trend.lines} />
        </div>
      </Card>

      <Card title="非 10 分 · 得分分布">
        <div data-pdf-chart="followup-score-distribution" className="rounded-lg bg-white p-2">
          <FollowUpScoreDistributionChart rows={metrics.scoreDistributionByProduct} />
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="未解决回访"
              value={metrics.unresolved.unresolvedCount}
              suffix={
                metrics.unresolved.totalScored
                  ? `/ ${metrics.unresolved.totalScored}`
                  : undefined
              }
            />
            {unresolvedRatePct != null ? (
              <Typography.Text type="secondary" className="mt-1 block text-xs">
                占比 {unresolvedRatePct}%
                {' · '}
                <Link
                  to={buildFollowUpDrillDownUrl({
                    ...drillDownBase,
                    followUp: 'has',
                    followUpResolved: 'unresolved',
                  })}
                >
                  查看
                </Link>
              </Typography.Text>
            ) : null}
          </Card>
        </Col>
      </Row>

      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <Card title="非 10 分 · 请求场景">
          <div data-pdf-chart="followup-request-scenes" className="rounded-lg bg-white p-2">
            <ThemeBarChart
              data={requestSceneChart}
              onBarClick={(label) => {
                navigate(
                  buildFollowUpDrillDownUrl({
                    ...drillDownBase,
                    requestScene: drillDownFieldParam(label),
                  }),
                )
              }}
            />
          </div>
        </Card>
        <Card title="非 10 分 · 问题类型">
          <div data-pdf-chart="followup-problem-types" className="rounded-lg bg-white p-2">
            <ThemeBarChart
              data={problemTypeChart}
              onBarClick={(label) => {
                navigate(
                  buildFollowUpDrillDownUrl({
                    ...drillDownBase,
                    problemType: drillDownFieldParam(label),
                  }),
                )
              }}
            />
          </div>
        </Card>
        <Card title="非 10 分 · 不满意原因">
          <div data-pdf-chart="followup-dissatisfied-reasons" className="rounded-lg bg-white p-2">
            <ThemeBarChart
              data={reasonChart}
              onBarClick={(label) => {
                const row = reasonChart.find((r) => r.label === label)
                if (!row?.reasonDim) return
                navigate(
                  buildFollowUpDrillDownUrl({
                    ...drillDownBase,
                    reasonDim: row.reasonDim,
                  }),
                )
              }}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
