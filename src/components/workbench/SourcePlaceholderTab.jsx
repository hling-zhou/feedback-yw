import { Alert, Card, Statistic, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { isStubPipeline } from '../../analysis/registry.js'

/**
 * @param {Object} props
 * @param {string} props.sourceLabel
 * @param {import('../../domain/enums.js').DataSourceType} [props.dataSourceType]
 * @param {import('../../domain/snapshot.js').InsightSnapshot | null} props.snapshot
 */
export default function SourcePlaceholderTab({ sourceLabel, dataSourceType, snapshot }) {
  const count = snapshot?.summary?.recordCount ?? 0
  const pipelineNotImplemented = dataSourceType ? isStubPipeline(dataSourceType) : true

  return (
    <div className="space-y-4">
      {pipelineNotImplemented && (
        <Alert
          type="warning"
          showIcon
          title="Pipeline 未实现"
          description={
            <>
              「{sourceLabel}」当前仅支持<strong>导入与入库</strong>
              ，尚无专项统计、趋势图与洞察快照能力（与投诉工单工作台不同）。已导入数据可在
              <Link to={dataSourceType ? `/feedbacks?source=${dataSourceType}` : '/feedbacks'}>
                反馈库
              </Link>
              中查看；完整分析能力将在后续版本提供。
            </>
          }
        />
      )}

      <Card>
        <Statistic title={`${sourceLabel}（当前周期）`} value={count} suffix="条" />
        <Typography.Paragraph type="secondary" className="!mb-0 mt-4 text-sm">
          {pipelineNotImplemented
            ? '下方不会展示空图表，避免误以为系统已算出指标。'
            : '该来源的专项统计与洞察图表将在后续版本补充。'}
        </Typography.Paragraph>
        {count > 0 && snapshot?.generatedAt && (
          <Typography.Text type="secondary" className="mt-2 block text-xs">
            最近快照：{snapshot.generatedAt.slice(0, 16).replace('T', ' ')}
            {pipelineNotImplemented ? '（占位快照，无专项指标）' : ''}
          </Typography.Text>
        )}
      </Card>

      <Link to="/import" className="text-brand-600 text-sm">
        导入 {sourceLabel} 数据
      </Link>
    </div>
  )
}
