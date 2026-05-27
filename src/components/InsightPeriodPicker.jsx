import { useMemo } from 'react'
import { DatePicker, Segmented, Select, Space, Typography } from 'antd'
import dayjs from 'dayjs'
import InsightMonthPicker from './InsightMonthPicker.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { PERIOD_GRANULARITIES, PERIOD_GRANULARITY_LABELS } from '../domain/enums.js'
import {
  buildPeriodSpec,
  defaultMonthPeriodSpec,
  formatPeriodSubtitle,
  selectionFromPeriod,
} from '../domain/insightPeriod.js'

const GRANULARITY_OPTIONS = PERIOD_GRANULARITIES.map((g) => ({
  value: g,
  label: PERIOD_GRANULARITY_LABELS[g],
}))

const QUARTER_OPTIONS = [1, 2, 3, 4].map((q) => ({ value: q, label: `Q${q}` }))

/**
 * 洞察周期：按月 / 按季度 / 按年直接选择（自动匹配数据时间，无需新建周期）
 * @param {{ showHint?: boolean; compact?: boolean; className?: string }} [props]
 */
export default function InsightPeriodPicker({
  showHint = true,
  compact = false,
  className = '',
}) {
  const { currentPeriod, periodsLoading, selectInsightPeriod, feedbacks } = useInsights()

  const selection = useMemo(() => {
    const fromPeriod = selectionFromPeriod(currentPeriod)
    if (fromPeriod) return fromPeriod
    const spec = defaultMonthPeriodSpec(feedbacks)
    return {
      granularity: spec.granularity,
      year: spec.anchorYear,
      month: spec.anchorMonth,
      quarter: spec.anchorQuarter,
    }
  }, [currentPeriod, feedbacks])

  const granularity = selection?.granularity ?? 'month'
  const year = selection?.year ?? dayjs().year()

  const applySelection = (next) => {
    const g = next.granularity ?? granularity
    const y = next.year ?? year
    const spec = buildPeriodSpec({
      granularity: g,
      year: y,
      month: next.month ?? selection?.month ?? dayjs().month() + 1,
      quarter: next.quarter ?? selection?.quarter ?? Math.ceil((dayjs().month() + 1) / 3),
    })
    selectInsightPeriod(spec)
  }

  return (
    <div className={[compact ? '' : 'space-y-2', className].filter(Boolean).join(' ')}>
      <Space wrap align={compact ? 'center' : 'start'} size="middle">
        <div>
          {!compact && (
            <Typography.Text strong className="mb-1 block text-xs">
              周期粒度
            </Typography.Text>
          )}
          <Segmented
            disabled={periodsLoading}
            value={granularity}
            options={GRANULARITY_OPTIONS}
            onChange={(g) => {
              applySelection({
                granularity: g,
                year: selection?.year ?? dayjs().year(),
                month: selection?.month ?? dayjs().month() + 1,
                quarter: selection?.quarter ?? Math.ceil((dayjs().month() + 1) / 3),
              })
            }}
          />
        </div>

        {granularity === 'month' && (
          <div>
            {!compact && (
              <Typography.Text strong className="mb-1 block text-xs">
                选择月份
              </Typography.Text>
            )}
            <InsightMonthPicker
              disabled={periodsLoading}
              value={`${year}-${String(selection?.month ?? 1).padStart(2, '0')}`}
              onChange={(monthValue) => {
                const [y, m] = monthValue.split('-').map(Number)
                applySelection({
                  granularity: 'month',
                  year: y,
                  month: m,
                })
              }}
            />
          </div>
        )}

        {granularity === 'quarter' && (
          <div>
            {!compact && (
              <Typography.Text strong className="mb-1 block text-xs">
                选择季度
              </Typography.Text>
            )}
            <Space>
              <DatePicker
                picker="year"
                disabled={periodsLoading}
                value={dayjs(`${year}-01-01`)}
                onChange={(d) => {
                  if (!d) return
                  applySelection({
                    granularity: 'quarter',
                    year: d.year(),
                    quarter: selection?.quarter ?? 1,
                  })
                }}
              />
              <Select
                className="min-w-[88px]"
                disabled={periodsLoading}
                value={selection?.quarter ?? 1}
                options={QUARTER_OPTIONS}
                onChange={(q) =>
                  applySelection({ granularity: 'quarter', year, quarter: q })
                }
              />
            </Space>
          </div>
        )}

        {granularity === 'year' && (
          <div>
            {!compact && (
              <Typography.Text strong className="mb-1 block text-xs">
                选择年份
              </Typography.Text>
            )}
            <DatePicker
              picker="year"
              disabled={periodsLoading}
              value={dayjs(`${year}-01-01`)}
              onChange={(d) => {
                if (!d) return
                applySelection({ granularity: 'year', year: d.year() })
              }}
            />
          </div>
        )}
      </Space>

      {showHint && currentPeriod && (
        <Typography.Text type="secondary" className="block text-xs">
          {formatPeriodSubtitle(currentPeriod)} · 按数据月份筛选
        </Typography.Text>
      )}
    </div>
  )
}
