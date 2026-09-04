import { useMemo } from 'react'
import { Collapse, Empty, Space, Tag, Typography } from 'antd'
import TrendChart from '../charts/TrendChart.jsx'
import { buildActionProblemScope } from '../../domain/actionProblemScope.js'

/** @typedef {import('../../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * 压降结论文案。
 * @param {{ reduction: any } | null} reduction
 * @returns {{ tone: 'success' | 'danger' | 'warning' | 'secondary'; text: string }}
 */
function reductionSummary(reduction) {
  if (!reduction) return { tone: 'secondary', text: '未设排期，无法对比' }
  if (!reduction.sufficient) return { tone: 'warning', text: '数据不足' }
  if (reduction.changePct === null) return { tone: 'warning', text: '基线为 0' }
  const sign = reduction.changePct > 0 ? '↑' : '↓'
  const pct = Math.abs(reduction.changePct)
  return {
    tone: reduction.changePct < 0 ? 'success' : 'danger',
    text: `${sign}${pct}%`,
  }
}

function toneToColor(tone) {
  if (tone === 'success') return 'green'
  if (tone === 'danger') return 'red'
  if (tone === 'warning') return 'orange'
  return 'default'
}

/**
 * 举措详情里的压降验证面板：每个问题签名一个折叠面板，内含趋势图 + 前后对比。
 *
 * @param {Object} props
 * @param {ActionItem} props.action
 * @param {Map<string, FeedbackRecord>} [props.feedbackByTicketId]
 * @param {Map<string, string>} [props.productNameByKey]
 */
export default function ActionProblemScopePanel({ action, feedbackByTicketId, productNameByKey }) {
  const scope = useMemo(
    () => buildActionProblemScope(action, feedbackByTicketId, productNameByKey),
    [action, feedbackByTicketId, productNameByKey],
  )

  if (!scope.problems.length || !scope.problems.some((p) => p.ticketCount > 0)) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无关联工单，无法做压降验证"
        className="!my-4"
      />
    )
  }

  const items = scope.problems.map((problem) => {
    const summary = reductionSummary(problem.reduction)
    const title = (
      <Space size={6} wrap>
        <Typography.Text strong className="!text-sm">
          {problem.productName}
        </Typography.Text>
        <Typography.Text type="secondary" className="!text-xs">
          {problem.journeyL1}
          {problem.journeyL2 && problem.journeyL2 !== problem.journeyL1 ? ` / ${problem.journeyL2}` : ''}
        </Typography.Text>
        <Tag className="!m-0 !text-xs">{problem.ticketCount} 单</Tag>
        <Tag color={toneToColor(summary.tone)} className="!m-0 !text-xs">
          {summary.text}
        </Tag>
      </Space>
    )

    return {
      key: problem.key,
      label: title,
      children: (
        <div className="space-y-3">
          {(problem.problemTypeLabel || problem.requestSceneLabel) && (
            <Space size={4} wrap>
              {problem.problemTypeLabel ? (
                <Tag className="!m-0 !text-xs">问题类型 · {problem.problemTypeLabel}</Tag>
              ) : null}
              {problem.requestSceneLabel ? (
                <Tag className="!m-0 !text-xs">请求场景 · {problem.requestSceneLabel}</Tag>
              ) : null}
            </Space>
          )}
          {problem.painPointSample ? (
            <Typography.Paragraph type="secondary" className="!mb-0 !text-xs" ellipsis={{ rows: 2, tooltip: problem.painPointSample }}>
              {problem.painPointSample}
            </Typography.Paragraph>
          ) : null}
          <div className="rounded-lg bg-white p-2">
            <TrendChart
              variant="line"
              xType="time"
              height={200}
              data={problem.monthlyTrend}
              areas={[
                { dataKey: 'count', name: '工单数', stroke: '#4F46E5' },
                { dataKey: 'negative', name: '负向', stroke: '#EF4444' },
              ]}
              referenceLine={
                scope.anchorDate
                  ? { x: scope.anchorDate, label: `实施 ${scope.anchorDate}`, stroke: '#F59E0B' }
                  : null
              }
            />
          </div>
          <ReductionDetail reduction={problem.reduction} anchorMonth={scope.anchorMonth} />
          <Typography.Text type="secondary" className="block !text-[11px]">
            关联趋势，非因果
          </Typography.Text>
        </div>
      ),
    }
  })

  return (
    <div className="space-y-2">
      <Typography.Text type="secondary" className="block text-xs">
        锚点（实施）：{scope.anchorDate || '—'}
      </Typography.Text>
      <Collapse size="small" items={items} />
    </div>
  )
}

/**
 * @param {{ reduction: any; anchorMonth: string }} props
 */
function ReductionDetail({ reduction, anchorMonth }) {
  if (!reduction) {
    return (
      <Typography.Text type="secondary" className="!text-xs">
        未设排期，无法做前后对比
      </Typography.Text>
    )
  }
  if (!reduction.sufficient) {
    return (
      <Typography.Text type="warning" className="!text-xs">
        数据不足（需锚点前 ≥2 月、后 ≥1 月）
      </Typography.Text>
    )
  }
  if (reduction.changePct === null) {
    return (
      <Typography.Text type="secondary" className="!text-xs">
        锚点前月均 0 单（基线为 0），无法计算变化
      </Typography.Text>
    )
  }
  const sign = reduction.changePct > 0 ? '↑' : '↓'
  return (
    <Typography.Text className="!text-xs">
      锚点前 {reduction.beforeMonths.length} 月（共 {reduction.beforeCount} 单，月均 {reduction.beforeAvg}）
      {' → '}锚点后 {reduction.afterMonths.length} 月（共 {reduction.afterCount} 单，月均 {reduction.afterAvg}）
      ，
      <Typography.Text type={reduction.changePct < 0 ? 'success' : 'danger'} strong>
        {sign}{Math.abs(reduction.changePct)}%
      </Typography.Text>
    </Typography.Text>
  )
}
