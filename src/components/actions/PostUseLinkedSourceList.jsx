import { useMemo } from 'react'
import { Tag, Typography } from 'antd'

/**
 * 举措详情抽屉内的「关联溯源/回访」纯展示列表（11-27 需求）。
 * 用后即评举措的关联反馈是产品部溯源（post_use_jira_items）与省代表回访
 * （post_use_visit_records_v1）记录，与投诉/咨询工单的 linkedTicketIds 是两条数据链——
 * 数据由宿主 ActionItemDrawer 单次 fetch（与列表单元格 PostUseLinkedFeedbackCell
 * 同源接口 /api/post-use-actions/linked/:actionId）后传入，同源判定纪律。
 *
 * 每条展示：客户名 · 产品 · 月份 · 客户反馈 + 处理侧结论——
 * 溯源条目 = 回溯结果（progress）；回访条目 = 回访结果（visitResult）与内部评估
 * （internalEvaluationDetail）。为空时如实显示 —。
 *
 * @param {Object} props
 * @param {Array<Record<string, unknown>>} [props.traces]
 * @param {Array<Record<string, unknown>>} [props.visits]
 */

/** @param {Record<string, unknown> | null | undefined} trace */
function traceConclusion(trace) {
  return String(trace?.progress || '').trim()
}

/** @param {Record<string, unknown> | null | undefined} visit */
function visitConclusion(visit) {
  const evaluation = String(
    visit?.internalEvaluationDetail || visit?.internalConclusion || '',
  ).trim()
  const result = String(visit?.visitResult || '').trim()
  if (evaluation && result && evaluation !== result) return `${result}；${evaluation}`
  return evaluation || result
}

export default function PostUseLinkedSourceList({ traces = [], visits = [] }) {
  const rows = useMemo(
    () => [
      ...traces.map((item) => ({
        key: `trace:${item.id}`,
        linkType: '产品部溯源',
        customer: String(item.customerName || '').trim(),
        product: String(item.productName || '').trim(),
        month: String(item.importMonth || '').trim(),
        feedback: String(item.customerFeedback || '').trim(),
        conclusionLabel: '回溯结果',
        conclusion: traceConclusion(item),
      })),
      ...visits.map((item) => ({
        key: `visit:${item.id}`,
        linkType: '省代表回访',
        customer: String(item.customerName || item.groupName || '').trim(),
        product: String(item.productName || '').trim(),
        month: String(item.importMonth || item.visitMonth || '').trim(),
        feedback: String(item.userFeedbackText || item.feedbackSummary || '').trim(),
        conclusionLabel: '回访结果/内部评估',
        conclusion: visitConclusion(item),
      })),
    ],
    [traces, visits],
  )

  if (!traces.length && !visits.length) {
    return <Typography.Text type="secondary">暂无关联溯源或回访</Typography.Text>
  }

  return (
    <div className="space-y-2">
      <Typography.Text type="secondary" className="block text-xs">
        共 {traces.length} 条溯源、{visits.length} 条回访
      </Typography.Text>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="rounded-md border border-ink-100 p-2">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Tag
                  color={row.linkType === '产品部溯源' ? 'blue' : 'green'}
                  className="!m-0 !text-[10px]"
                >
                  {row.linkType}
                </Tag>
                <Typography.Text className="text-xs font-medium text-ink-800">
                  {row.customer || '—'}
                </Typography.Text>
                {row.product ? (
                  <Typography.Text type="secondary" className="text-[11px]">
                    {row.product}
                  </Typography.Text>
                ) : null}
              </div>
              <Typography.Text type="secondary" className="shrink-0 text-[10px]">
                {row.month || ''}
              </Typography.Text>
            </div>
            {row.feedback ? (
              <Typography.Paragraph
                className="!mb-0 !mt-1 text-[13px] text-ink-700"
                ellipsis={{ rows: 2, tooltip: row.feedback }}
              >
                【客户反馈】{row.feedback}
              </Typography.Paragraph>
            ) : null}
            <Typography.Text type="secondary" className="mt-1 block text-[11px]">
              {row.conclusionLabel}：
              <Typography.Text className="break-words text-ink-700">
                {row.conclusion || '—'}
              </Typography.Text>
            </Typography.Text>
          </div>
        ))}
      </div>
    </div>
  )
}
