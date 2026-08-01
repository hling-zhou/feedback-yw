import { useMemo, useState } from 'react'
import { Card, Collapse, Select, Space, Typography } from 'antd'
import TrendChart from '../charts/TrendChart.jsx'
import { monthlyTrend } from '../../lib/analytics.js'
import { resolveTrendMonthWindow } from '../../lib/workbenchTrendWindow.js'

const DIMENSION_OPTIONS = [
  { value: 'requestScene', label: '请求场景' },
  { value: 'problemType', label: '问题类型' },
  { value: 'journeyL1', label: '一级旅程' },
  { value: 'journeyL2', label: '二级旅程' },
]

/**
 * @param {import('../../lib/types.js').FeedbackRecord} fb
 * @param {'requestScene' | 'problemType' | 'journeyL1' | 'journeyL2'} field
 */
function recordDimValue(fb, field) {
  if (field === 'requestScene') return fb.requestScene?.trim() || '未分类'
  if (field === 'problemType') return fb.problemType?.trim() || '未分类'
  if (field === 'journeyL1') return fb.journeyL1?.trim() || '未识别环节'
  return fb.journeyL2?.trim() || '未识别子环节'
}

/**
 * @param {import('../../lib/types.js').FeedbackRecord[]} records
 * @param {'requestScene' | 'problemType' | 'journeyL1' | 'journeyL2'} field
 * @param {string} [journeyL1]
 */
function collectValueOptions(records, field, journeyL1) {
  const map = new Map()
  for (const fb of records) {
    if (field === 'journeyL2' && journeyL1 && recordDimValue(fb, 'journeyL1') !== journeyL1) continue
    const value = recordDimValue(fb, field)
    map.set(value, (map.get(value) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({
      value,
      label: `${value} (${count})`,
    }))
}

/**
 * 展开收起：按特性类型看数量趋势（趋势月窗规则与工单量趋势一致）。
 *
 * @param {Object} props
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null} props.period
 * @param {import('../../lib/types.js').FeedbackRecord[]} props.trendRecords 趋势月窗 + 产品等筛选后的记录
 * @param {import('../../lib/types.js').FeedbackRecord[]} [props.periodRecords] 周期内记录（用于选项计数，默认同 trendRecords）
 */
export default function DimensionQuantityTrendPanel({
  period,
  trendRecords,
  periodRecords,
}) {
  const optionSource = periodRecords?.length ? periodRecords : trendRecords
  const [dimension, setDimension] = useState(
    /** @type {'requestScene' | 'problemType' | 'journeyL1' | 'journeyL2'} */ ('requestScene'),
  )
  const [journeyL1ForL2, setJourneyL1ForL2] = useState('')
  const [selectedValue, setSelectedValue] = useState('')

  const window = useMemo(() => resolveTrendMonthWindow(period), [period])

  const l1Options = useMemo(
    () => collectValueOptions(optionSource, 'journeyL1'),
    [optionSource],
  )

  const valueOptions = useMemo(() => {
    if (dimension === 'journeyL2') {
      return collectValueOptions(optionSource, 'journeyL2', journeyL1ForL2 || undefined)
    }
    return collectValueOptions(optionSource, dimension)
  }, [optionSource, dimension, journeyL1ForL2])

  const chartData = useMemo(() => {
    if (!selectedValue) return []
    const filtered = trendRecords.filter((fb) => {
      if (dimension === 'journeyL2' && journeyL1ForL2) {
        if (recordDimValue(fb, 'journeyL1') !== journeyL1ForL2) return false
      }
      return recordDimValue(fb, dimension) === selectedValue
    })
    const trend = monthlyTrend(filtered, { basis: 'importMonth', limit: 120 })
    const byDate = new Map(trend.map((row) => [row.date, row]))
    return window.months.map((month) => {
      const row = byDate.get(month)
      return {
        date: month,
        count: row?.count ?? 0,
        negative: row?.negative ?? 0,
      }
    })
  }, [selectedValue, dimension, journeyL1ForL2, trendRecords, window.months])

  return (
    <Collapse
      className="page-section"
      items={[
        {
          key: 'dim-trend',
          label: '按特性类型看数量趋势',
          children: (
            <div className="space-y-3">
              <Space wrap size="middle">
                <div>
                  <Typography.Text type="secondary" className="mb-1 block text-xs">
                    维度
                  </Typography.Text>
                  <Select
                    className="min-w-[140px]"
                    value={dimension}
                    options={DIMENSION_OPTIONS}
                    onChange={(v) => {
                      setDimension(v)
                      setSelectedValue('')
                      if (v !== 'journeyL2') setJourneyL1ForL2('')
                    }}
                  />
                </div>
                {dimension === 'journeyL2' ? (
                  <div>
                    <Typography.Text type="secondary" className="mb-1 block text-xs">
                      一级旅程
                    </Typography.Text>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      className="min-w-[180px]"
                      placeholder="可选，缩小二级范围"
                      value={journeyL1ForL2 || undefined}
                      options={l1Options}
                      onChange={(v) => {
                        setJourneyL1ForL2(v || '')
                        setSelectedValue('')
                      }}
                    />
                  </div>
                ) : null}
                <div>
                  <Typography.Text type="secondary" className="mb-1 block text-xs">
                    取值
                  </Typography.Text>
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    className="min-w-[220px]"
                    placeholder="选择具体类型"
                    value={selectedValue || undefined}
                    options={valueOptions}
                    onChange={(v) => setSelectedValue(v || '')}
                  />
                </div>
              </Space>
              <Typography.Text type="secondary" className="block text-xs">
                趋势窗 {window.startMonth}～{window.endMonth}
              </Typography.Text>
              {selectedValue ? (
                <Card size="small" title={`${DIMENSION_OPTIONS.find((d) => d.value === dimension)?.label || ''} · ${selectedValue}`}>
                  <div className="rounded-lg bg-white p-2">
                    <TrendChart
                      variant="line"
                      data={chartData}
                      areas={[
                        { dataKey: 'count', name: '工单数', stroke: '#4F46E5' },
                        { dataKey: 'negative', name: '负向', stroke: '#EF4444' },
                      ]}
                    />
                  </div>
                </Card>
              ) : (
                <Typography.Text type="secondary" className="text-sm">
                  选择维度与取值后，可查看该类型在趋势窗内的数量变化。
                </Typography.Text>
              )}
            </div>
          ),
        },
      ]}
    />
  )
}
