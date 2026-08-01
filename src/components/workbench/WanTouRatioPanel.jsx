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
import {
  buildWanTouProductTableColumns,
  WanTouRatioWithTargetCell,
} from './WanTouRatioCells.jsx'

/**
 * @param {{ months: import('../../lib/wanTouRatio.js').buildWanTouSummary extends (...args: any) => infer R ? R extends { months: infer M } ? M : never : never }} summary
 */
function MonthlyTargetTable({ summary }) {
  if (!summary.months?.length) return null

  return (
    <Table
      className="page-section-sm"
      size="small"
      pagination={false}
      rowKey="month"
      scroll={{ x: 1200 }}
      dataSource={summary.months}
      columns={[
        { title: '月份', dataIndex: 'month', width: 96, fixed: 'left' },
        { title: '全部投诉', dataIndex: 'complaints', width: 88, align: 'center' },
        {
          title: '万投比',
          width: 148,
          align: 'center',
          render: (_, row) => (
            <WanTouRatioWithTargetCell ratio={row.ratio} evaluation={row.wanTouTargetEval} />
          ),
        },
        {
          title: '客户体验类投诉',
          dataIndex: 'cxComplaints',
          width: 132,
          align: 'center',
        },
        {
          title: '客户体验类万投比',
          width: 168,
          align: 'center',
          render: (_, row) => (
            <WanTouRatioWithTargetCell ratio={row.cxRatio} evaluation={row.cxWanTouTargetEval} />
          ),
        },
        {
          title: '订单数',
          dataIndex: 'orders',
          width: 88,
          align: 'center',
          render: (value) => (value != null && value > 0 ? value.toLocaleString() : '—'),
        },
      ]}
    />
  )
}

/**
 * @param {Object} props
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null} props.period
 * @param {string} [props.productName]
 * @param {string | null} [props.productKey]
 * @param {{ name: string; count?: number }[]} [props.productList]
 * @param {import('../../lib/types.js').FeedbackRecord[]} props.records
 * @param {import('../../lib/types.js').FeedbackRecord[]} [props.allRecords]
 * @param {import('../../storage/orderVolumeStore.js').OrderVolumeRow[]} props.orderVolumes
 * @param {import('../../storage/wanTouTargetStore.js').WanTouTargetRow[]} [props.wanTouTargets]
 * @param {'compact' | 'full'} [props.variant]
 */
export default function WanTouRatioPanel({
  period,
  productName,
  productKey,
  productList,
  records,
  allRecords,
  orderVolumes,
  wanTouTargets = [],
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
      wanTouTargets,
      productList,
    })
  }, [multiProduct, period, records, orderVolumes, wanTouTargets, productList])

  const summary = useMemo(
    () =>
      buildWanTouSummary({
        period,
        productKey,
        productName,
        records,
        orderVolumes,
        wanTouTargets,
      }),
    [period, productKey, productName, records, orderVolumes, wanTouTargets],
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
      wanTouTargets,
    })
  }, [previousPeriod, productKey, productName, catalogRecords, orderVolumes, wanTouTargets])

  if (multiProduct) {
    return (
      <Card
        size="small"
        styles={{ body: { padding: '12px 16px' } }}
        title={
          <span className="text-sm font-medium text-ink-700">
            万投比
            <Tooltip title="投诉工单数 ÷ 产品订单数 × 10000；体验类万投比仅统计投诉原因一级（终判）= 客户体验类">
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
        <div>
          <Table
            size="small"
            pagination={false}
            rowKey="productName"
            scroll={{ x: 760 }}
            dataSource={multiRows}
            columns={buildWanTouProductTableColumns()}
          />
        </div>
        <Typography.Text type="secondary" className="mt-2 block text-xs">
          分母与目标值请在 <Link to="/settings">设置</Link> 中维护产品月订单数、万投比目标值。
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
  const ordersSum = summary.months.reduce((n, month) => n + (month.orders || 0), 0)
  const primaryMonth = summary.months[0]

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
          <Tooltip title="投诉工单数 ÷ 产品订单数 × 10000；体验类万投比仅统计投诉原因一级（终判）= 客户体验类">
            <QuestionCircleOutlined className="ml-1.5 text-ink-400" />
          </Tooltip>
        </span>
      }
      extra={
        <Typography.Text type="secondary" className="text-xs">
          {summary.granularityLabel}
          {summary.annualTargets?.year ? ` · ${summary.annualTargets.year} 年目标` : ''}
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
          {summary.totalCxComplaints > 0 ? ` · 体验类 ${summary.totalCxComplaints} 单` : ''}
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

      {primaryMonth ? (
        <div className="page-section-sm grid gap-2 lg:grid-cols-2">
          <Typography.Text className="text-xs">
            万投比{' '}
            <WanTouRatioWithTargetCell
              ratio={primaryMonth.ratio}
              evaluation={primaryMonth.wanTouTargetEval}
            />
          </Typography.Text>
          <Typography.Text className="text-xs">
            客户体验类万投比{' '}
            <WanTouRatioWithTargetCell
              ratio={primaryMonth.cxRatio}
              evaluation={primaryMonth.cxWanTouTargetEval}
            />
          </Typography.Text>
        </div>
      ) : null}

      {(variant === 'full' || summary.months.length === 1) && summary.months.length >= 1 ? (
        <MonthlyTargetTable summary={summary} />
      ) : null}

      {!summary.annualTargets?.wanTouTarget && !summary.annualTargets?.cxWanTouTarget ? (
        <Typography.Text type="secondary" className="mt-2 block text-xs">
          尚未配置本年度万投比目标值。
          <Link to="/settings" className="ml-1">
            去设置
          </Link>
        </Typography.Text>
      ) : null}
    </Card>
  )
}
