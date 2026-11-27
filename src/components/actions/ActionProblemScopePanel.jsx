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
 * 2026-11-27 起接收**预构建 scope**（调用方 = ActionItemDrawer 分区5 唯一消费点）：
 * 工单举措传 buildActionProblemScope 产物，用后即评举措传 buildPostUseActionProblemScope
 * 产物——两类举措共用本面板的锚点行/趋势图/ReductionDetail 展示形态；
 * unitLabel/areaName/emptyText 按举措来源参数化（用后即评记录非"单"、无负向线）。
 *
 * @param {Object} props
 * @param {ReturnType<typeof buildActionProblemScope>} [props.scope] 预构建聚合产物（优先）
 * @param {ActionItem} [props.action] 兼容旧调用：scope 未传时现场构建（工单侧既有行为）
 * @param {Map<string, FeedbackRecord>} [props.feedbackByTicketId]
 * @param {Map<string, string>} [props.productNameByKey]
 * @param {'单' | '条'} [props.unitLabel] 计数单位（工单=单；溯源/回访记录=条）
 * @param {string} [props.areaName] 趋势线名称（工单数 / 反馈条数）
 * @param {string} [props.emptyText] 空态文案
 * @param {boolean} [props.showNegative] 是否画负向第二条线（工单侧 true；post_use 无该维度）
 */
export default function ActionProblemScopePanel({
  scope,
  action,
  feedbackByTicketId,
  productNameByKey,
  unitLabel = '单',
  areaName = '工单数',
  emptyText,
  showNegative = true,
}) {
  const builtScope = useMemo(
    () => (scope ?? (action ? buildActionProblemScope(action, feedbackByTicketId, productNameByKey) : null)),
    [scope, action, feedbackByTicketId, productNameByKey],
  )
  const countPredicate = scope
    ? (p) => Number(p.monthlyTrend?.length) > 0 || Number(p.recordCount) > 0
    : (p) => p.ticketCount > 0

  if (!builtScope?.problems.length || !builtScope.problems.some(countPredicate)) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={emptyText || '暂无关联工单，无法做效果验证'}
        className="!my-4"
      />
    )
  }

  const items = builtScope.problems.map((problem) => {
    // post_use face 与工单 face 字段差异在此归一（呈现层适配，不反向污染领域层）：
    // 计数 = ticketCount（工单）| recordCount（溯源/回访）；副标题 = 旅程（工单）| 来源 Tag（post_use）
    const count = scope ? Number(problem.recordCount) || 0 : problem.ticketCount
    const subtitle = scope
      ? String(problem.sourceKindLabel ?? '')
      : `${problem.journeyL1 ?? ''}${problem.journeyL2 && problem.journeyL2 !== problem.journeyL1 ? ` / ${problem.journeyL2}` : ''}`
    const summary = reductionSummary(problem.reduction)
    const title = (
      <Space size={6} wrap>
        <Typography.Text strong className="!text-sm">
          {problem.productName}
        </Typography.Text>
        {subtitle ? (
          <Typography.Text type="secondary" className="!text-xs">
            {subtitle}
          </Typography.Text>
        ) : null}
        <Tag className="!m-0 !text-xs">{count} {unitLabel}</Tag>
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
          {(problem.painPointSample || problem.feedbackSample) ? (
            <Typography.Paragraph type="secondary" className="!mb-0 !text-[13px]" ellipsis={{ rows: 2, tooltip: problem.painPointSample || problem.feedbackSample }}>
              {problem.painPointSample || problem.feedbackSample}
            </Typography.Paragraph>
          ) : null}
          <div className="rounded-lg bg-white p-2">
            <TrendChart
              variant="line"
              xType="time"
              height={200}
              data={problem.monthlyTrend}
              areas={showNegative
                ? [
                  { dataKey: 'count', name: areaName, stroke: '#4F46E5' },
                  { dataKey: 'negative', name: '负向', stroke: '#EF4444' },
                ]
                : [{ dataKey: 'count', name: areaName, stroke: '#4F46E5' }]}
              referenceLine={
                builtScope.anchorDate
                  ? { x: builtScope.anchorDate, label: `实施 ${builtScope.anchorDate}`, stroke: '#F59E0B' }
                  : null
              }
            />
          </div>
          <ReductionDetail reduction={problem.reduction} anchorMonth={builtScope.anchorMonth} unitLabel={unitLabel} />
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
        锚点（实施）：{builtScope.anchorDate || '—'}
      </Typography.Text>
      <Collapse size="small" items={items} />
    </div>
  )
}

/**
 * @param {{ reduction: any; anchorMonth: string; unitLabel?: '单' | '条' }} props
 */
function ReductionDetail({ reduction, anchorMonth, unitLabel = '单' }) {
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
        锚点前月均 0 {unitLabel}（基线为 0），无法计算变化
      </Typography.Text>
    )
  }
  const sign = reduction.changePct > 0 ? '↑' : '↓'
  return (
    <Typography.Text className="!text-xs">
      锚点前 {reduction.beforeMonths.length} 月（共 {reduction.beforeCount} {unitLabel}，月均{' '}
      <span className="font-medium">{reduction.beforeAvg}</span>）→ 锚点后 {reduction.afterMonths.length} 月（共{' '}
      {reduction.afterCount} {unitLabel}，月均 <span className="font-medium">{reduction.afterAvg}</span>），{' '}
      <Typography.Text type={reduction.changePct < 0 ? 'success' : 'danger'} strong>
        {sign}{Math.abs(reduction.changePct)}%
      </Typography.Text>
    </Typography.Text>
  )
}
