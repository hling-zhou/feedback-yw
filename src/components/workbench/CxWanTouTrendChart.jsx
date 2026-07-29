import { useMemo } from 'react'
import { Card, Typography } from 'antd'
import { Link } from 'react-router-dom'
import TrendChart from '../charts/TrendChart.jsx'
import {
  computeMonthlyWanTou,
  countCustomerExperienceComplaintsInMonth,
  getOrderCountForMonth,
  resolveCatalogKeyFromProductName,
} from '../../lib/wanTouRatio.js'
import { getWanTouTargetForYear } from '../../storage/wanTouTargetStore.js'
import { resolveTrendMonthWindow } from '../../lib/workbenchTrendWindow.js'

/**
 * 投诉 Tab：客户体验类万投比单折线 + 最新年目标基准线。
 *
 * @param {Object} props
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null} props.period
 * @param {string} [props.productName]
 * @param {string | null} [props.productKey]
 * @param {import('../../lib/types.js').FeedbackRecord[]} props.records 趋势月窗内（或更大范围）投诉记录
 * @param {import('../../storage/orderVolumeStore.js').OrderVolumeRow[]} [props.orderVolumes]
 * @param {import('../../storage/wanTouTargetStore.js').WanTouTargetRow[]} [props.wanTouTargets]
 */
export default function CxWanTouTrendChart({
  period,
  productName,
  productKey: productKeyProp,
  records,
  orderVolumes = [],
  wanTouTargets = [],
}) {
  const productKey =
    productKeyProp || (productName ? resolveCatalogKeyFromProductName(productName) : null)
  const window = useMemo(() => resolveTrendMonthWindow(period), [period])

  const chartData = useMemo(() => {
    if (!productKey) {
      return window.months.map((month) => ({ date: month, cxRatio: null }))
    }
    return window.months.map((month) => {
      const cxComplaints = countCustomerExperienceComplaintsInMonth(
        records,
        month,
        productName || undefined,
      )
      const orders = getOrderCountForMonth(orderVolumes, productKey, month)
      return {
        date: month,
        cxRatio: computeMonthlyWanTou(cxComplaints, orders),
      }
    })
  }, [window.months, productKey, productName, records, orderVolumes])

  const baselineTarget = useMemo(() => {
    if (!productKey) return null
    const row = getWanTouTargetForYear(wanTouTargets, productKey, window.baselineYear)
    const target = row?.customerExperienceWanTouTarget
    return target != null && Number.isFinite(target) ? target : null
  }, [productKey, wanTouTargets, window.baselineYear])

  return (
    <Card
      title={<Typography.Text strong>客户体验类万投比趋势</Typography.Text>}
      extra={
        <Typography.Text type="secondary" className="text-xs">
          {window.startMonth}～{window.endMonth}
          {baselineTarget != null ? ` · 基准 ${window.baselineYear}年目标 ${baselineTarget}` : ''}
        </Typography.Text>
      }
    >
      {!productName ? (
        <Typography.Text type="secondary" className="text-sm">
          请先选择具体产品以查看客户体验类万投比趋势与目标基准线。
        </Typography.Text>
      ) : (
        <>
          <div data-pdf-chart="cx-wantou-trend" className="rounded-lg bg-white p-2">
            <TrendChart
              variant="line"
              allowDecimals
              data={chartData}
              height={240}
              areas={[
                {
                  dataKey: 'cxRatio',
                  name: '客户体验类万投比',
                  stroke: '#0D9488',
                },
              ]}
              referenceLine={
                baselineTarget != null
                  ? {
                      y: baselineTarget,
                      label: `目标 ${baselineTarget}`,
                      stroke: '#F59E0B',
                    }
                  : null
              }
            />
          </div>
          {baselineTarget == null ? (
            <Typography.Text type="secondary" className="mt-2 block text-xs">
              未配置 {window.baselineYear} 年客户体验类万投比目标，可在{' '}
              <Link to="/settings">设置</Link> 中维护。
            </Typography.Text>
          ) : null}
        </>
      )}
    </Card>
  )
}
