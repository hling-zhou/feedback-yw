import { useMemo } from 'react'
import { Checkbox, DatePicker, Segmented, Select, Space, Typography } from 'antd'
import dayjs from 'dayjs'
import InsightMonthPicker from './InsightMonthPicker.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { DEFAULT_TENANT_ID, SCHEMA_VERSION } from '../domain/constants.js'
import { PERIOD_GRANULARITIES, PERIOD_GRANULARITY_LABELS } from '../domain/enums.js'
import {
  buildPeriodSpec,
  currentPeriodSpec,
  defaultMonthPeriodSpec,
  formatPeriodSubtitle,
  insightPeriodFromSpec,
  resolveInsightPeriod,
  selectionFromPeriod,
  shiftYearMonth,
} from '../domain/insightPeriod.js'

const GRANULARITY_OPTIONS = PERIOD_GRANULARITIES.map((g) => ({
  value: g,
  label: PERIOD_GRANULARITY_LABELS[g],
}))

const QUARTER_OPTIONS = [1, 2, 3, 4].map((q) => ({ value: q, label: `Q${q}` }))

function defaultCustomRange() {
  const spec = currentPeriodSpec('custom')
  return { fromMonth: spec.customFromMonth, toMonth: spec.customToMonth }
}

/**
 * 洞察周期：按月 / 按季度 / 按年 / 自定义起止月（自动匹配数据时间）
 * @param {{
 *   showHint?: boolean
 *   compact?: boolean
 *   className?: string
 *   value?: string | null
 *   onChange?: (insightPeriodId: string | null, period: import('../domain/insightPeriod.js').InsightPeriod | null) => void
 *   allowEmpty?: boolean
 * }} [props]
 */
export default function InsightPeriodPicker({
  showHint = true,
  compact = false,
  className = '',
  value,
  onChange,
  allowEmpty = false,
}) {
  const controlled = typeof onChange === 'function'
  const { currentPeriod, periodsLoading, selectInsightPeriod, feedbacks, periods } = useInsights()

  const activePeriod = useMemo(() => {
    if (!controlled) return currentPeriod
    if (!value) return null
    const fromList = periods.find((p) => p.id === value)
    return resolveInsightPeriod(value, fromList ?? undefined)
  }, [controlled, value, currentPeriod, periods])

  const selection = useMemo(() => {
    const fromPeriod = selectionFromPeriod(activePeriod)
    if (fromPeriod) return fromPeriod
    const spec = defaultMonthPeriodSpec(feedbacks)
    return {
      granularity: spec.granularity,
      year: spec.anchorYear,
      month: spec.anchorMonth,
      quarter: spec.anchorQuarter,
      fromMonth: spec.customFromMonth,
      toMonth: spec.customToMonth,
    }
  }, [activePeriod, feedbacks])

  const granularity = selection?.granularity ?? 'month'
  const year = selection?.year ?? dayjs().year()
  const customDefaults = defaultCustomRange()
  const fromMonth = selection?.fromMonth ?? customDefaults.fromMonth
  const toMonth = selection?.toMonth ?? customDefaults.toMonth

  const applySelection = (next) => {
    const g = next.granularity ?? granularity
    if (g === 'custom') {
      const from = next.fromMonth ?? fromMonth
      const to = next.toMonth ?? toMonth
      let spec
      try {
        spec = buildPeriodSpec({
          granularity: 'custom',
          fromMonth: from,
          toMonth: to,
        })
      } catch {
        return
      }
      if (controlled) {
        const period = insightPeriodFromSpec(spec, SCHEMA_VERSION, DEFAULT_TENANT_ID)
        onChange(period.id, period)
        return
      }
      selectInsightPeriod(spec)
      return
    }

    const y = next.year ?? year
    const spec = buildPeriodSpec({
      granularity: g,
      year: y,
      month: next.month ?? selection?.month ?? dayjs().month() + 1,
      quarter: next.quarter ?? selection?.quarter ?? Math.ceil((dayjs().month() + 1) / 3),
    })
    if (controlled) {
      const period = insightPeriodFromSpec(spec, SCHEMA_VERSION, DEFAULT_TENANT_ID)
      onChange(period.id, period)
      return
    }
    selectInsightPeriod(spec)
  }

  const periodEnabled = !allowEmpty || !!value

  return (
    <div className={[compact ? '' : 'space-y-2', className].filter(Boolean).join(' ')}>
      {allowEmpty && controlled && (
        <Checkbox
          checked={periodEnabled}
          onChange={(e) => {
            if (!e.target.checked) {
              onChange(null, null)
              return
            }
            applySelection({
              granularity: selection?.granularity ?? 'month',
              year: selection?.year ?? dayjs().year(),
              month: selection?.month ?? dayjs().month() + 1,
              quarter: selection?.quarter ?? Math.ceil((dayjs().month() + 1) / 3),
            })
          }}
        >
          指定洞察周期
        </Checkbox>
      )}
      {periodEnabled && (
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
              if (g === 'custom') {
                const defaults = defaultCustomRange()
                applySelection({
                  granularity: 'custom',
                  fromMonth: selection?.fromMonth ?? defaults.fromMonth,
                  toMonth: selection?.toMonth ?? defaults.toMonth,
                })
                return
              }
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

        {granularity === 'custom' && (
          <div>
            {!compact && (
              <Typography.Text strong className="mb-1 block text-xs">
                起止月份
              </Typography.Text>
            )}
            <Space wrap size="small">
              <InsightMonthPicker
                disabled={periodsLoading}
                value={fromMonth}
                onChange={(monthValue) => {
                  const nextTo = toMonth && monthValue > toMonth ? monthValue : toMonth
                  applySelection({
                    granularity: 'custom',
                    fromMonth: monthValue,
                    toMonth: nextTo || monthValue,
                  })
                }}
              />
              <Typography.Text type="secondary">至</Typography.Text>
              <InsightMonthPicker
                disabled={periodsLoading}
                value={toMonth}
                onChange={(monthValue) => {
                  const nextFrom =
                    fromMonth && monthValue < fromMonth ? monthValue : fromMonth
                  applySelection({
                    granularity: 'custom',
                    fromMonth: nextFrom || shiftYearMonth(monthValue, -2) || monthValue,
                    toMonth: monthValue,
                  })
                }}
              />
            </Space>
          </div>
        )}
      </Space>
      )}

      {showHint && activePeriod && periodEnabled && (
        <Typography.Text type="secondary" className="block text-xs">
          {formatPeriodSubtitle(activePeriod)} · 按数据月份筛选
        </Typography.Text>
      )}
    </div>
  )
}
