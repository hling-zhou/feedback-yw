import { Link } from 'react-router-dom'
import { Alert, Button, Card, Empty, Space, Typography } from 'antd'
import { countBySourceInScope } from '../../hooks/usePeriodScope.js'
import { recordSourceType } from '../../snapshots/recordScope.js'
import { useInsights } from '../../context/InsightsContext.jsx'
import { buildImportUrl } from '../../lib/importRoute.js'
import RebuildInsightsButton from './RebuildInsightsButton.jsx'

/**
 * @param {Object} props
 * @param {import('../../domain/enums.js').DataSourceType} props.sourceType
 * @param {string} props.sourceLabel
 * @param {import('../../lib/types.js').FeedbackRecord[]} props.feedbacks
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null} props.currentPeriod
 * @param {() => void | Promise<void>} props.onRebuild
 * @param {boolean} [props.rebuilding]
 * @param {boolean} [props.rebuildDisabled]
 */
export default function WorkbenchSourceEmpty({
  sourceType,
  sourceLabel,
  feedbacks,
  currentPeriod,
  onRebuild,
  rebuilding,
  rebuildDisabled,
}) {
  const { importMonthSummary } = useInsights()
  const { totalInDb: totalInCache, inPeriod } = countBySourceInScope(feedbacks, currentPeriod, sourceType)
  // 跨月提示需全库口径：优先用月份聚合（缓存可能仅含已加载周期），无聚合时回退缓存扫描
  const sourceRows = importMonthSummary?.bySource?.filter((r) => r.dataSourceType === sourceType) ?? null
  const totalInDb = sourceRows ? sourceRows.reduce((sum, r) => sum + r.count, 0) : totalInCache
  const months = sourceRows
    ? [...new Set(sourceRows.map((r) => r.importMonth).filter(Boolean))].sort()
    : [
        ...new Set(
          feedbacks
            .filter((fb) => recordSourceType(fb) === sourceType)
            .map((fb) => fb.importMonth)
            .filter(Boolean),
        ),
      ].sort()

  return (
    <Card>
      <Empty description={`当前周期内暂无「${sourceLabel}」快照数据`}>
        <Space orientation="vertical" size="middle" className="mt-2">
          {totalInDb > 0 && inPeriod === 0 && (
            <Alert
              type="info"
              showIcon
              title={`反馈库中有 ${totalInDb} 条${sourceLabel}，但不在当前洞察周期`}
              description={
                <>
                  请将顶部周期切换为数据月份（如 {months.slice(-3).join('、') || '导入时选择的月份'}
                  ），再点击「生成 / 刷新洞察」。
                </>
              }
            />
          )}
          {totalInDb > 0 && inPeriod > 0 && (
            <Alert
              type="warning"
              showIcon
              title={`本周期有 ${inPeriod} 条${sourceLabel}，但快照未生成`}
              description="请点击下方按钮生成洞察快照后即可查看图表与分析。"
            />
          )}
          <Space wrap>
            <RebuildInsightsButton
              loading={rebuilding}
              disabled={rebuildDisabled}
              onClick={() => onRebuild()}
            />
            <Link to={`/feedbacks?source=${sourceType}${months[0] ? `&month=${months[months.length - 1]}` : ''}`}>
              <Button>在反馈库查看</Button>
            </Link>
            <Link to={buildImportUrl({ source: sourceType })}>
              <Button>去导入</Button>
            </Link>
          </Space>
        </Space>
      </Empty>
      {totalInDb > 0 && (
        <Typography.Text type="secondary" className="mt-4 block text-center text-xs">
          已导入月份：{months.join('、') || '—'} · 当前周期：{currentPeriod?.label || '—'}
        </Typography.Text>
      )}
    </Card>
  )
}
