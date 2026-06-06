import { useMemo } from 'react'
import { Alert, Card, Table, Tooltip, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { resolvePreviousInsightPeriod } from '../../domain/insightPeriod.js'
import { filterRecordsForScope } from '../../snapshots/recordScope.js'
import {
  buildWanTouByProducts,
  buildWanTouSummary,
  computeWanTouPeriodDelta,
  formatWanTouPeriodDelta,
  formatWanTouRatio,
  wanTouComparisonPeriodLabel,
} from '../../lib/wanTouRatio.js'

/**
 * @param {Object} props
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null} props.period
 * @param {string} [props.productName]
 * @param {string | null} [props.productKey]
 * @param {{ name: string; count?: number }[]} [props.productList] 全部产品时按产品分列展示
 * @param {import('../../lib/types.js').FeedbackRecord[]} props.records 当前周期、当前来源工单
 * @param {import('../../lib/types.js').FeedbackRecord[]} [props.allRecords] 全库工单（用于计算上周期）
 * @param {import('../../storage/orderVolumeStore.js').OrderVolumeRow[]} props.orderVolumes
 * @param {'compact' | 'full'} [props.variant] full 时展示分月明细表
 */
export default function WanTouRatioPanel({
  period,
  productName,
  productKey,
  productList,
  records,
  allRecords,
  orderVolumes,
  variant = 'full',
}) {
  const multiProduct = !productName && Boolean(productList?.length)
  const catalogRecords = allRecords ?? records

  const multiRows = useMemo(() => {
    if (!multiProduct) return []
    return buildWanTouByProducts({
      period,
      records,
      orderVolumes,
      productList,
    })
  }, [multiProduct, period, records, orderVolumes, productList])

  const summary = useMemo(
    () =>
      buildWanTouSummary({
        period,
        productKey,
        productName,
        records,
        orderVolumes,
      }),
    [period, productKey, productName, records, orderVolumes],
  )

  const previousPeriod = useMemo(() => resolvePreviousInsightPeriod(period), [period])

  const previousSummary = useMemo(() => {
    if (!previousPeriod || !productKey) return null
    const prevRecords = filterRecordsForScope(
      catalogRecords,
      previousPeriod,
      'complaint_ticket',
    )
    return buildWanTouSummary({
      period: previousPeriod,
      productKey,
      productName,
      records: prevRecords,
      orderVolumes,
    })
  }, [previousPeriod, productKey, productName, catalogRecords, orderVolumes])

  if (multiProduct) {
    return (
      <Card
        size="small"
        styles={{ body: { padding: '12px 16px' } }}
        title={
          <span className="text-sm font-medium text-ink-700">
            万投比
            <Tooltip title="投诉工单数 ÷ 产品订单数 × 10000；年/季粒度为周期内各月月万投比算术平均">
              <QuestionCircleOutlined className="ml-1.5 text-ink-400" />
            </Tooltip>
          </span>
        }
        extra={
          <Typography.Text type="secondary" className="text-xs">
            全部产品 · {period?.label || '当前周期'}
          </Typography.Text>
        }
      >
        <div data-pdf-chart="source-wan-tou">
          <Table
            size="small"
            pagination={false}
            rowKey="productName"
            dataSource={multiRows}
            columns={[
              { title: '产品', dataIndex: 'productName', ellipsis: true },
              {
                title: '万投比',
                dataIndex: 'displayRatio',
                width: 100,
                render: (v) => formatWanTouRatio(v),
              },
              { title: '投诉工单', dataIndex: 'totalComplaints', width: 90 },
              {
                title: '粒度',
                dataIndex: 'granularityLabel',
                width: 180,
                ellipsis: true,
              },
              {
                title: '订单维护',
                width: 100,
                render: (_, row) =>
                  row.missingOrderMonths?.length ? (
                    <Typography.Text type="warning" className="text-xs">
                      缺 {row.missingOrderMonths.length} 月
                    </Typography.Text>
                  ) : row.inCatalog === false ? (
                    <Typography.Text type="warning" className="text-xs">
                      未匹配目录
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="success" className="text-xs">
                      已维护
                    </Typography.Text>
                  ),
              },
            ]}
          />
        </div>
        <Typography.Text type="secondary" className="mt-2 block text-xs">
          分母请在 <Link to="/settings">设置 → 产品月订单数</Link> 中按产品、月份维护。
        </Typography.Text>
      </Card>
    )
  }

  const comparisonLabel = wanTouComparisonPeriodLabel(period?.granularity)
  const periodDelta = computeWanTouPeriodDelta(
    summary.displayRatio,
    previousSummary?.displayRatio,
  )
  const periodDeltaText = formatWanTouPeriodDelta(periodDelta)
  const ordersSum = summary.months.reduce((n, m) => n + (m.orders || 0), 0)

  const deltaTone =
    periodDelta == null
      ? 'secondary'
      : periodDelta > 0
        ? 'danger'
        : periodDelta < 0
          ? 'success'
          : 'secondary'

  return (
    <Card
      size="small"
      styles={{ body: { padding: '12px 16px' } }}
      title={
        <span className="text-sm font-medium text-ink-700">
          万投比
          <Tooltip title="投诉工单数 ÷ 产品订单数 × 10000；年/季粒度为周期内各月月万投比算术平均">
            <QuestionCircleOutlined className="ml-1.5 text-ink-400" />
          </Tooltip>
        </span>
      }
      extra={
        <Typography.Text type="secondary" className="text-xs">
          {summary.granularityLabel}
        </Typography.Text>
      }
    >
      {!productKey && (
        <Alert
          type="warning"
          showIcon
          className="!mb-3"
          title="未匹配到产品目录"
          description={
            <>
              请先在设置中维护「目标产品」目录，使产品名称与目录 Key 一致。
              <Link to="/settings" className="ml-1">
                去设置
              </Link>
            </>
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-3xl font-bold tabular-nums leading-none text-ink-900">
            {formatWanTouRatio(summary.displayRatio)}
          </span>
          <div className="flex flex-col gap-0.5">
            {periodDeltaText != null ? (
              <Typography.Text type={deltaTone} className="text-sm font-medium">
                {periodDelta > 0 ? (
                  <ArrowUpOutlined className="mr-1 text-xs" />
                ) : periodDelta < 0 ? (
                  <ArrowDownOutlined className="mr-1 text-xs" />
                ) : null}
                {comparisonLabel} {periodDeltaText}
                {previousSummary?.displayRatio != null ? (
                  <Typography.Text type="secondary" className="ml-1 text-xs font-normal">
                    （上期 {formatWanTouRatio(previousSummary.displayRatio)}）
                  </Typography.Text>
                ) : null}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" className="text-xs">
                {comparisonLabel}暂无对比
                {previousPeriod?.label ? `（${previousPeriod.label}）` : ''}
              </Typography.Text>
            )}
          </div>
        </div>

        <Typography.Text type="secondary" className="text-xs">
          投诉 {summary.totalComplaints} 单
          {ordersSum > 0 ? ` · 订单 ${ordersSum.toLocaleString()}` : ''}
          {summary.missingOrderMonths.length > 0 ? (
            <>
              {' '}
              ·{' '}
              <Typography.Text type="warning" className="text-xs">
                缺 {summary.missingOrderMonths.length} 月订单数
              </Typography.Text>
              <Link to="/settings" className="ml-1">
                去维护
              </Link>
            </>
          ) : null}
        </Typography.Text>
      </div>

      {variant === 'full' && summary.months.length > 1 && (
        <Table
          className="page-section-sm"
          size="small"
          pagination={false}
          rowKey="month"
          dataSource={summary.months}
          columns={[
            { title: '月份', dataIndex: 'month', width: 100 },
            { title: '投诉工单', dataIndex: 'complaints', width: 90 },
            {
              title: '订单数',
              dataIndex: 'orders',
              width: 100,
              render: (v) => (v != null && v > 0 ? v.toLocaleString() : '—'),
            },
            {
              title: '月万投比',
              dataIndex: 'ratio',
              render: (v) => formatWanTouRatio(v),
            },
          ]}
        />
      )}
    </Card>
  )
}
