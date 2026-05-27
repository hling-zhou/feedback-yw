import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Card, Col, Row, Statistic, Table, Typography } from 'antd'
import ThemeBarChart from '../charts/ThemeBarChart.jsx'
import { useInsights } from '../../context/InsightsContext.jsx'
import { isStubPipeline } from '../../analysis/registry.js'
import { resolveRecordsByIds } from '../../snapshots/recordScope.js'
import { aggregateRatingByProduct, summarizeRatings } from '../../lib/ratingAnalytics.js'

/**
 * 用后即评工作台：仅「全部产品」维度（与工单 Tab 的分产品呈现区分）。
 *
 * @param {Object} props
 * @param {import('../../domain/snapshot.js').InsightSnapshot} props.snapshot
 * @param {string} props.sourceLabel
 */
export default function PostUseRatingDashboardView({ snapshot, sourceLabel }) {
  const { feedbacks } = useInsights()
  const items = useMemo(
    () => resolveRecordsByIds(feedbacks, snapshot.recordIds),
    [feedbacks, snapshot.recordIds],
  )

  const summary = useMemo(() => summarizeRatings(items), [items])
  const byProduct = useMemo(() => aggregateRatingByProduct(items), [items])

  const scoreChartData = useMemo(
    () =>
      byProduct
        .filter((p) => p.avgScore != null)
        .map((p) => ({
          label: p.name,
          count: Math.round(p.avgScore * 10),
          negative: p.lowScoreCount,
        })),
    [byProduct],
  )

  const stub = isStubPipeline('post_use_rating')

  if (!items.length) {
    return (
      <Card>
        <Typography.Text type="secondary">当前周期内暂无「{sourceLabel}」数据，请先导入。</Typography.Text>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {stub && (
        <Alert
          type="info"
          showIcon
          title="专项指标预览"
          description="当前为导入占位 Pipeline，下图基于已入库明细按产品聚合；完整 KPI/季年加权将在用后即评 Pipeline 上线后对齐需求文档。"
        />
      )}

      <Typography.Text type="secondary" className="block text-sm">
        本 Tab 为<strong>全部产品</strong>维度展示（18 云网产品一览）；投诉/咨询工单 Tab 为分产品查看旅程与打标。
      </Typography.Text>

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="周期内条数" value={summary.recordCount} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="有评分条数"
              value={summary.scoredCount}
              suffix={summary.recordCount ? `/ ${summary.recordCount}` : ''}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="整体均分" value={summary.avgScore ?? '—'} precision={summary.avgScore != null ? 2 : 0} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="9 分以下条数" value={summary.below9Count} />
          </Card>
        </Col>
      </Row>

      <Card title="各产品评分（周期内）">
        <div data-pdf-chart="yhjp-product-scores" className="rounded-lg bg-white p-2">
          <ThemeBarChart data={scoreChartData} />
        </div>
        <Typography.Text type="secondary" className="mt-2 block text-xs">
          条形长度为均分×10 便于展示；完整指标见下表。
        </Typography.Text>
      </Card>

      <Card
        title="产品评分明细"
        extra={
          <Link to="/feedbacks?source=post_use_rating" className="text-sm">
            反馈库
          </Link>
        }
      >
        <Table
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true }}
          rowKey="productKey"
          dataSource={byProduct}
          columns={[
            { title: '产品', dataIndex: 'name', ellipsis: true },
            { title: '样本量', dataIndex: 'count', width: 88 },
            {
              title: '均分',
              dataIndex: 'avgScore',
              width: 88,
              render: (v) => (v != null ? v.toFixed(2) : '—'),
            },
            { title: '9分以下', dataIndex: 'lowScoreCount', width: 96 },
          ]}
        />
      </Card>
    </div>
  )
}
