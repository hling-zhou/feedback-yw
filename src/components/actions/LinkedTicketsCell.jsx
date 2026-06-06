import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button, Popover, Space, Typography, message } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { buildFeedbacksUrl } from '../../lib/feedbackFilters.js'
import {
  groupLinkedTicketIdsByMonth,
  UNKNOWN_LINKED_FEEDBACK_MONTH,
} from '../../lib/actionItemLinkedFeedback.js'

/**
 * @param {Object} props
 * @param {string[]} props.ticketIds
 * @param {Map<string, import('../../lib/types.js').FeedbackRecord>} [props.feedbackByTicketId]
 * @param {string} [props.title]
 */
export default function LinkedTicketsCell({
  ticketIds,
  feedbackByTicketId,
  title = '关联反馈',
}) {
  const ids = ticketIds || []
  const groups = useMemo(
    () => groupLinkedTicketIdsByMonth(ids, feedbackByTicketId),
    [ids, feedbackByTicketId],
  )

  if (!ids.length) return <Typography.Text type="secondary">—</Typography.Text>

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(ids.join('\n'))
      message.success('已复制工单号')
    } catch {
      message.error('复制失败')
    }
  }

  const copyGroup = async (groupTicketIds) => {
    try {
      await navigator.clipboard.writeText(groupTicketIds.join('\n'))
      message.success('已复制该月工单号')
    } catch {
      message.error('复制失败')
    }
  }

  const content = (
    <div className="min-w-[14rem] max-w-[22rem] max-h-56 overflow-y-auto">
      <Typography.Text type="secondary" className="mb-2 block text-xs">
        共 {ids.length} 条 · 按数据月份
      </Typography.Text>
      <Space direction="vertical" size={10} className="w-full">
        {groups.map((group) => (
          <div key={group.month}>
            <div className="mb-1 flex items-center justify-between gap-2">
              {group.month !== UNKNOWN_LINKED_FEEDBACK_MONTH ? (
                <Link
                  to={buildFeedbacksUrl({ month: group.month })}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  {group.label} · {group.ticketIds.length} 条
                </Link>
              ) : (
                <span className="text-xs font-medium text-ink-700">
                  {group.label} · {group.ticketIds.length} 条
                </span>
              )}
              <Button
                type="link"
                size="small"
                className="!h-auto !px-0 !text-[10px]"
                onClick={() => void copyGroup(group.ticketIds)}
              >
                复制
              </Button>
            </div>
            <Space direction="vertical" size={2} className="w-full">
              {group.ticketIds.map((ticketId) => (
                <Typography.Text key={ticketId} className="text-xs">
                  <Link
                    to={buildFeedbacksUrl({ ticketId })}
                    className="text-ink-800 hover:text-brand-600"
                  >
                    {ticketId}
                  </Link>
                </Typography.Text>
              ))}
            </Space>
          </div>
        ))}
        <Button type="link" size="small" icon={<CopyOutlined />} onClick={copyAll} className="!px-0">
          复制全部
        </Button>
      </Space>
    </div>
  )

  return (
    <Popover content={content} title={title} trigger="hover">
      <Button type="link" size="small" className="!px-0">
        {ids.length} 个工单
      </Button>
    </Popover>
  )
}
