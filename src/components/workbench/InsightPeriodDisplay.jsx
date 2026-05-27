import { Spin, Tag, Typography } from 'antd'
import { useInsights } from '../../context/InsightsContext.jsx'
import { PERIOD_GRANULARITY_LABELS } from '../../domain/enums.js'
import { formatPeriodSubtitle } from '../../domain/insightPeriod.js'
import { usePeriodScope } from '../../hooks/usePeriodScope.js'

/** 二级页只读展示工作台已选洞察周期（不可在此修改） */
export default function InsightPeriodDisplay() {
  const { periodsLoading } = useInsights()
  const { period: currentPeriod, periodCount } = usePeriodScope()

  if (periodsLoading) {
    return (
      <div className="flex min-w-[200px] items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-3">
        <Spin size="small" />
        <Typography.Text type="secondary" className="text-xs">
          加载洞察周期…
        </Typography.Text>
      </div>
    )
  }

  if (!currentPeriod) {
    return (
      <div className="min-w-[220px] rounded-lg border border-dashed border-ink-200 bg-ink-50 px-4 py-3">
        <Typography.Text type="secondary" className="text-xs">
          未选择洞察周期，请返回工作台选择
        </Typography.Text>
      </div>
    )
  }

  const granularityLabel = currentPeriod.granularity
    ? PERIOD_GRANULARITY_LABELS[currentPeriod.granularity]
    : null

  return (
    <div className="min-w-[220px] rounded-lg border border-ink-200 bg-white px-4 py-3">
      <Typography.Text type="secondary" className="block text-xs">
        洞察周期
      </Typography.Text>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {granularityLabel ? <Tag>{granularityLabel}</Tag> : null}
        <Typography.Text strong>{currentPeriod.label}</Typography.Text>
      </div>
      <Typography.Text type="secondary" className="mt-0.5 block text-xs" data-testid="period-count-display">
        {formatPeriodSubtitle(currentPeriod)} · 周期内 {periodCount} 条
      </Typography.Text>
      <Typography.Text type="secondary" className="block text-[10px]">
        按数据月份筛选 · 仅查看，请在工作台修改
      </Typography.Text>
    </div>
  )
}
