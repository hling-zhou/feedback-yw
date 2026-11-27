import { Space, Tag, Typography } from 'antd'

/**
 * 举措详情抽屉 · 分区3 关联问题：用后即评举措的聚合问题面列表（2026-11-27 需求）。
 * 纯展示组件——数据由 buildPostUseActionProblemScope 产出，宿主 ActionItemDrawer 传入。
 *
 * face 卡片形态与工单侧 sub-section-box 同构（先例抄写）：
 * [产品名] [来源 Tag] [N 条] [细分 Tag] [状态 Tag] + 反馈样例（ellipsis 2 行）+ 月份区间。
 *
 * @param {Object} props
 * @param {Array<Record<string, unknown>>} [props.problems] buildPostUseActionProblemScope 产出的 face 行
 */

/** @param {Record<string, unknown> | null | undefined} row */
function monthRangeLabel(row) {
  const first = String(row?.firstMonth ?? '')
  const last = String(row?.lastMonth ?? '')
  if (!first && !last) return ''
  if (first === last) return first
  return `${first} ~ ${last}`
}

export default function PostUseProblemFaces({ problems = [] }) {
  if (!problems.length) return null
  return (
    <Space direction="vertical" size={6} className="w-full">
      {problems.map((problem) => {
        const range = monthRangeLabel(problem)
        return (
          <div key={String(problem.key)} className="sub-section-box">
            <Space size={6} wrap>
              <Typography.Text strong className="!text-sm">
                {String(problem.productName ?? '') || '未标注产品'}
              </Typography.Text>
              <Tag
                color={problem.sourceKind === 'trace' ? 'blue' : 'green'}
                className="!m-0 !text-xs"
              >
                {String(problem.sourceKindLabel ?? '')}
              </Tag>
              <Tag className="!m-0 !text-xs">{Number(problem.recordCount) || 0} 条</Tag>
              {problem.subTypeLabel ? (
                <Tag className="!m-0 !text-xs">{String(problem.subTypeLabel)}</Tag>
              ) : null}
              {problem.statusLabel ? (
                <Tag className="!m-0 !text-xs">{String(problem.statusLabel)}</Tag>
              ) : null}
            </Space>
            {problem.feedbackSample ? (
              <Typography.Paragraph
                type="secondary"
                className="!mb-0 !mt-1 !text-[13px]"
                ellipsis={{ rows: 2, tooltip: String(problem.feedbackSample) }}
              >
                {String(problem.feedbackSample)}
              </Typography.Paragraph>
            ) : null}
            {range ? (
              <Typography.Text type="secondary" className="mt-1 block text-xs">
                {range}
              </Typography.Text>
            ) : null}
          </div>
        )
      })}
    </Space>
  )
}
